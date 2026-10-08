mod supervisor;

use std::env;
use std::io::{Read, Write};
use std::process::{Child, Command};
#[cfg(target_os = "macos")]
use std::process::Stdio;
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use supervisor::{Effect, Supervisor, HEARTBEAT_TIMEOUT};
#[cfg(target_os = "macos")]
use supervisor::LOCKDOWN_GRACE;

#[cfg(target_os = "macos")]
use std::os::unix::net::UnixStream;
#[cfg(windows)]
use std::fs::OpenOptions;

#[cfg(target_os = "macos")]
fn kill_process(pid: u32) {
    unsafe {
        libc::kill(pid as libc::pid_t, libc::SIGKILL);
    }
}

#[cfg(windows)]
fn kill_process(pid: u32) {
    unsafe {
        let handle = winapi::um::processthreadsapi::OpenProcess(
            winapi::um::winnt::PROCESS_TERMINATE,
            0,
            pid,
        );
        if !handle.is_null() {
            winapi::um::processthreadsapi::TerminateProcess(handle, 1);
            winapi::um::handleapi::CloseHandle(handle);
        }
    }
}

#[cfg(windows)]
fn get_api_address(name: &str) -> Option<usize> {
    use winapi::um::libloaderapi::{GetModuleHandleA, GetProcAddress};
    use std::ffi::CString;

    let module = if name == "connect" { "ws2_32.dll" } else { "kernel32.dll" };
    let actual_name = if name == "open" { "CreateFileW" } else { name };

    let c_module = CString::new(module).unwrap();
    let c_name = CString::new(actual_name).unwrap();

    unsafe {
        let handle = GetModuleHandleA(c_module.as_ptr());
        if handle.is_null() {
            return None;
        }
        let ptr = GetProcAddress(handle, c_name.as_ptr());
        if ptr.is_null() {
            None
        } else {
            Some(ptr as usize)
        }
    }
}

#[cfg(windows)]
fn read_remote_memory(pid: u32, addr: usize, size: usize) -> Option<Vec<u8>> {
    use winapi::um::processthreadsapi::OpenProcess;
    use winapi::um::memoryapi::ReadProcessMemory;
    use winapi::um::winnt::PROCESS_VM_READ;
    use winapi::um::handleapi::CloseHandle;

    unsafe {
        let handle = OpenProcess(PROCESS_VM_READ, 0, pid);
        if handle.is_null() {
            return None;
        }

        let mut buf = vec![0u8; size];
        let mut bytes_read = 0;
        let success = ReadProcessMemory(
            handle,
            addr as winapi::shared::minwindef::LPCVOID,
            buf.as_mut_ptr() as winapi::shared::minwindef::LPVOID,
            size,
            &mut bytes_read
        );
        CloseHandle(handle);

        if success != 0 && bytes_read == size {
            Some(buf)
        } else {
            None
        }
    }
}

/// Queued by the read thread when the app's end of the socket closes.
const PIPE_CLOSED: &str = "\u{0}PIPE_CLOSED";

/// The socket only closes when the app exits (normally, by crash or by force quit) or closes it on
/// purpose. Either way there is nothing left to supervise: killing the PID later could hit an
/// unrelated process that reused it, and relaunching would restart an app the user just quit.
fn exit_on_pipe_closed(pid: u32) -> ! {
    eprintln!("Watchdog: connection to PID {} closed. Exiting without further action.", pid);
    std::process::exit(0);
}

/// The executable to restart in safe mode after a freeze, if any: an empty argument means none
/// (the app passes one in a development build, whose executable is the bare Electron binary).
/// The app starts no watchdog in safe mode, so a freeze there is not restarted again.
fn relaunch_target(args: &[String]) -> Option<String> {
    args.get(3).filter(|path| !path.is_empty()).cloned()
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 3 {
        eprintln!("Usage: watchdog <pid> <pipe_path> [exec_path] [locale]");
        std::process::exit(1);
    }

    // kill(0, ..) signals our own process group and a value above i32::MAX becomes a negative pid_t
    // (kill(-1, ..) signals every process of the user), so only accept a real, foreign PID.
    let pid: u32 = match args[1].parse::<u32>() {
        Ok(p) if p > 1 && p <= i32::MAX as u32 && p != std::process::id() => p,
        _ => {
            eprintln!("Watchdog: refusing invalid target PID '{}'", args[1]);
            std::process::exit(2);
        }
    };
    let pipe_path = &args[2];
    let exec_path = relaunch_target(&args);
    // The app's locale (app.getLocale()), so the freeze dialog speaks the user's language.
    let chinese = args.get(4).is_some_and(|locale| locale.starts_with("zh"));

    let mut stream = connect_pipe(pipe_path);
    let write_stream = stream.try_clone().expect("Failed to clone stream for writing");

    let (tx, rx) = mpsc::channel();
    let tx_read = tx.clone();

    // Read thread
    thread::spawn(move || {
        let mut buffer = [0; 1024];
        let mut leftover = String::new();
        // Bug Fix #3: Cap the leftover buffer to prevent unbounded growth if the
        // remote process sends garbage data without newlines (e.g. after a hook injection).
        // If the buffer exceeds 64 KB without a valid message, it is flushed.
        const MAX_LEFTOVER: usize = 65536;
        loop {
            match stream.read(&mut buffer) {
                Ok(0) => {
                    // Connection closed. The main loop must hear about it explicitly: other senders
                    // (the original `tx`, the Windows scan thread) keep the channel itself open.
                    let _ = tx_read.send(PIPE_CLOSED.to_string());
                    break;
                }
                Ok(n) => {
                    let chunk = String::from_utf8_lossy(&buffer[..n]);
                    leftover.push_str(&chunk);

                    while let Some(pos) = leftover.find('\n') {
                        let line = leftover[..pos].trim().to_string();
                        leftover = leftover[pos + 1..].to_string();
                        if !line.is_empty() {
                            let _ = tx_read.send(line);
                        }
                    }

                    // Guard against runaway buffer growth
                    if leftover.len() > MAX_LEFTOVER {
                        eprintln!("Watchdog: IPC buffer overflow (>64KB without newline). Resetting buffer.");
                        leftover.clear();
                    }
                }
                Err(_) => {
                    let _ = tx_read.send(PIPE_CLOSED.to_string());
                    break;
                }
            }
        }
    });

    #[cfg(windows)]
    {
        let tx_scan = tx.clone();
        let pid_scan = pid;
        thread::spawn(move || {
            let connect_addr = get_api_address("connect").unwrap_or(0);
            let open_addr = get_api_address("open").unwrap_or(0);
            
            let mut local_connect = vec![0; 8];
            let mut local_open = vec![0; 8];
            
            if connect_addr != 0 {
                unsafe { std::ptr::copy_nonoverlapping(connect_addr as *const u8, local_connect.as_mut_ptr(), 8); }
            }
            if open_addr != 0 {
                unsafe { std::ptr::copy_nonoverlapping(open_addr as *const u8, local_open.as_mut_ptr(), 8); }
            }

            loop {
                thread::sleep(Duration::from_secs(5));
                
                if connect_addr != 0 {
                    if let Some(remote_bytes) = read_remote_memory(pid_scan, connect_addr, 8) {
                        if remote_bytes != local_connect {
                            let _ = tx_scan.send("LOCKDOWN_TRIGGER:RED:MEMORY_HOOKED_CONNECT".to_string());
                        }
                    }
                }
                if open_addr != 0 {
                    if let Some(remote_bytes) = read_remote_memory(pid_scan, open_addr, 8) {
                        if remote_bytes != local_open {
                            let _ = tx_scan.send("LOCKDOWN_TRIGGER:RED:MEMORY_HOOKED_OPEN".to_string());
                        }
                    }
                }
            }
        });
    }

    let mut supervisor = Supervisor::new();
    let mut out = Outlet { pid, exec_path, chinese, lines: spawn_writer(write_stream), freeze_dialog: None };

    loop {
        // The deadline is acted on before waiting again, so a late message cannot undo a kill
        // that is already decided, nor delay one.
        let due = supervisor.poll(Instant::now());
        out.apply(due, &supervisor);
        let effects = match rx.recv_timeout(supervisor.wait(Instant::now())) {
            Ok(msg) if msg == PIPE_CLOSED => out.pipe_closed(),
            Ok(msg) => supervisor.on_message(&msg, Instant::now()),
            Err(mpsc::RecvTimeoutError::Timeout) => supervisor.on_silence(Instant::now()),
            Err(mpsc::RecvTimeoutError::Disconnected) => out.pipe_closed(),
        };
        out.apply(effects, &supervisor);
    }
}

/// Writes the lines for the app on a thread of its own. On Windows the pipe handle is synchronous
/// and shared with the read thread, so a write waits until the app writes something; done on the
/// supervisor loop, it held back the kill at an alert's deadline for as long as the app (perhaps
/// the compromised process) stayed silent.
fn spawn_writer<W: Write + Send + 'static>(mut stream: W) -> mpsc::Sender<String> {
    let (tx, rx) = mpsc::channel::<String>();
    thread::spawn(move || {
        for line in rx {
            if stream.write_all(format!("{line}\n").as_bytes()).is_err() {
                break;
            }
        }
    });
    tx
}

/// Carries out what the supervisor decided: messages to the app, the dialog, the kill.
struct Outlet {
    pid: u32,
    exec_path: Option<String>,
    chinese: bool,
    lines: mpsc::Sender<String>,
    freeze_dialog: Option<Child>,
}

impl Outlet {
    fn pipe_closed(&mut self) -> ! {
        close_dialog(&mut self.freeze_dialog);
        exit_on_pipe_closed(self.pid);
    }

    fn apply(&mut self, effects: Vec<Effect>, supervisor: &Supervisor) {
        let pid = self.pid;
        for effect in effects {
            match effect {
                Effect::Send(line) => {
                    let _ = self.lines.send(line);
                }
                Effect::ShowFreezeDialog => {
                    eprintln!("Watchdog: no heartbeat from PID {pid} for {} s.", HEARTBEAT_TIMEOUT.as_secs());
                    close_dialog(&mut self.freeze_dialog);
                    self.freeze_dialog = show_freeze_dialog(self.chinese);
                }
                Effect::CloseFreezeDialog => {
                    if supervisor.is_watching() {
                        eprintln!("Watchdog: PID {pid} responds again.");
                    }
                    close_dialog(&mut self.freeze_dialog);
                }
                Effect::Kill { restart_safe } => {
                    eprintln!("Watchdog: deadline passed. Terminating PID {pid}.");
                    kill_process(pid);
                    if restart_safe {
                        if let Some(exec) = &self.exec_path {
                            eprintln!("Watchdog: restarting {exec} in safe mode.");
                            let _ = Command::new(exec).arg("--safe-mode").spawn();
                        }
                    }
                }
                Effect::Exit(code) => {
                    if code == 0 {
                        eprintln!("Watchdog: shutdown requested. Exiting.");
                    }
                    std::process::exit(code);
                }
            }
        }
    }
}

/// The warning shown while the app does not respond. It closes by itself once the app responds.
#[cfg(target_os = "macos")]
fn show_freeze_dialog(chinese: bool) -> Option<Child> {
    let (title, text, button) = if chinese {
        (
            "GETSSH 没有响应",
            "GETSSH 已经 5 秒没有响应。\\n\\n如果 60 秒内仍未恢复，GETSSH 会被强制退出，并以安全模式重新打开。恢复后这个提示会自动关闭。",
            "好",
        )
    } else {
        (
            "GETSSH is not responding",
            "GETSSH has not responded for 5 seconds.\\n\\nIf it does not recover within 60 seconds, it will be force-quit and reopened in safe mode. This message closes by itself once GETSSH responds.",
            "OK",
        )
    };
    let script = format!(
        "display dialog \"{text}\" with title \"{title}\" buttons {{\"{button}\"}} default button \"{button}\" giving up after {} with icon caution",
        LOCKDOWN_GRACE.as_secs()
    );
    let mut child = Command::new("osascript").stdin(Stdio::piped()).spawn().ok()?;
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(script.as_bytes());
    }
    Some(child)
}

#[cfg(not(target_os = "macos"))]
fn show_freeze_dialog(_chinese: bool) -> Option<Child> {
    None
}

fn close_dialog(dialog: &mut Option<Child>) {
    if let Some(mut child) = dialog.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

// OS Specific stream connection
#[cfg(target_os = "macos")]
fn connect_pipe(path: &str) -> std::os::unix::net::UnixStream {
    // Retry logic in case the server takes a moment to bind
    for _ in 0..50 {
        if let Ok(stream) = UnixStream::connect(path) {
            return stream;
        }
        thread::sleep(Duration::from_millis(100));
    }
    eprintln!("Failed to connect to unix socket");
    std::process::exit(1);
}

#[cfg(windows)]
fn connect_pipe(path: &str) -> std::fs::File {
    for _ in 0..50 {
        if let Ok(file) = OpenOptions::new().read(true).write(true).open(path) {
            return file;
        }
        thread::sleep(Duration::from_millis(100));
    }
    eprintln!("Failed to connect to named pipe");
    std::process::exit(1);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A pipe whose writes never finish, like a Windows pipe while the app stays silent.
    struct StuckPipe(mpsc::Receiver<()>);

    impl Write for StuckPipe {
        fn write(&mut self, _buf: &[u8]) -> std::io::Result<usize> {
            let _ = self.0.recv();
            Ok(0)
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn a_stuck_pipe_does_not_hold_back_the_supervisor() {
        let (_release, wait) = mpsc::channel();
        let mut out = Outlet { pid: 0, exec_path: None, chinese: false, lines: spawn_writer(StuckPipe(wait)), freeze_dialog: None };
        let started = Instant::now();
        for tick in (1..=60).rev() {
            out.apply(vec![Effect::Send(format!("TICK:{tick}"))], &Supervisor::new());
        }
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn lines_reach_the_app_in_order() {
        #[derive(Clone, Default)]
        struct Shared(std::sync::Arc<std::sync::Mutex<Vec<u8>>>);
        impl Write for Shared {
            fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
                self.0.lock().unwrap().extend_from_slice(buf);
                Ok(buf.len())
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        let pipe = Shared::default();
        let lines = spawn_writer(pipe.clone());
        for line in ["LOCKDOWN_TRIGGER:RED:x", "TICK:60", "RESOLVED"] {
            lines.send(line.to_string()).unwrap();
        }
        drop(lines);
        let deadline = Instant::now() + Duration::from_secs(5);
        while pipe.0.lock().unwrap().len() < 38 && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(String::from_utf8(pipe.0.lock().unwrap().clone()).unwrap(), "LOCKDOWN_TRIGGER:RED:x\nTICK:60\nRESOLVED\n");
    }

    #[test]
    fn an_empty_or_missing_executable_means_no_restart() {
        let args: Vec<String> = ["watchdog", "123", "/tmp/p.sock", "/Applications/GETSSH.app/Contents/MacOS/GETSSH", "en-US"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert_eq!(relaunch_target(&args).as_deref(), Some("/Applications/GETSSH.app/Contents/MacOS/GETSSH"));
        assert_eq!(relaunch_target(&args[..3]), None);
        let mut empty = args.clone();
        empty[3].clear();
        assert_eq!(relaunch_target(&empty), None);
    }
}
