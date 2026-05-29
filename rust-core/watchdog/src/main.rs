use std::env;
use std::io::{Read, Write};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

#[cfg(unix)]
use std::os::unix::net::UnixStream;
#[cfg(windows)]
use std::fs::OpenOptions;

#[cfg(unix)]
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

#[cfg(target_os = "linux")]
fn get_api_address(name: &str) -> Option<usize> {
    let cname = std::ffi::CString::new(name).unwrap();
    unsafe {
        let ptr = libc::dlsym(libc::RTLD_DEFAULT, cname.as_ptr());
        if ptr.is_null() { None } else { Some(ptr as usize) }
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

#[cfg(target_os = "linux")]
fn read_remote_memory(pid: u32, addr: usize, size: usize) -> Option<Vec<u8>> {
    let mut buf = vec![0u8; size];
    let local_iov = libc::iovec {
        iov_base: buf.as_mut_ptr() as *mut libc::c_void,
        iov_len: size,
    };
    let remote_iov = libc::iovec {
        iov_base: addr as *mut libc::c_void,
        iov_len: size,
    };

    unsafe {
        let res = libc::process_vm_readv(
            pid as libc::pid_t,
            &local_iov,
            1,
            &remote_iov,
            1,
            0
        );
        if res == size as isize {
            Some(buf)
        } else {
            None
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

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 3 {
        eprintln!("Usage: watchdog <pid> <pipe_path> [exec_path]");
        std::process::exit(1);
    }

    let pid: u32 = args[1].parse().expect("Invalid PID");
    let pipe_path = &args[2];
    let exec_path = if args.len() > 3 { Some(args[3].clone()) } else { None };

    let mut stream = connect_pipe(pipe_path);
    let mut write_stream = stream.try_clone().expect("Failed to clone stream for writing");

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
                    // Connection closed
                    break;
                }
                Ok(n) => {
                    let chunk = String::from_utf8_lossy(&buffer[..n]);
                    leftover.push_str(&chunk);

                    // Guard against runaway buffer growth
                    if leftover.len() > MAX_LEFTOVER {
                        eprintln!("Watchdog: IPC buffer overflow (>64KB without newline). Resetting buffer.");
                        leftover.clear();
                    }

                    while let Some(pos) = leftover.find('\n') {
                        let line = leftover[..pos].trim().to_string();
                        leftover = leftover[pos + 1..].to_string();
                        if !line.is_empty() {
                            let _ = tx_read.send(line);
                        }
                    }
                }
                Err(_) => break,
            }
        }
    });

    #[cfg(not(target_os = "macos"))]
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

    let mut lockdown_mode = false;
    let mut lockdown_timer = 60;
    let mut sleep_mode = false;
    let mut ui_alive = false;
    let mut is_yellow = false;
    // Bug Fix #5: Limit how many times the user can extend the countdown via SAVE-15S.
    // Without this, a compromised Electron process could send SAVE-15S in a loop
    // to prevent Watchdog from ever executing the kill.
    let mut save_extensions_used = 0u32;
    const MAX_SAVE_EXTENSIONS: u32 = 3;

    loop {
        if sleep_mode {
            // Sleep mode: do nothing, just keep the pipe open so it doesn't crash the JS side
            // Can check if pipe disconnects to eventually exit
            match rx.recv_timeout(Duration::from_secs(5)) {
                Ok(_) => {} // Ignore all messages
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    std::process::exit(0);
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {} // Do nothing
            }
        } else if !lockdown_mode {
            match rx.recv_timeout(Duration::from_secs(5)) {
                Ok(msg) => {
                    if msg.starts_with("LOCKDOWN_TRIGGER:") {
                        let mut parts = msg.splitn(3, ':');
                        let _ = parts.next(); // LOCKDOWN_TRIGGER
                        let level = parts.next().unwrap_or("RED");
                        let reason = parts.next().unwrap_or("UNKNOWN").to_string();
                        lockdown_mode = true;
                        ui_alive = true;
                        is_yellow = level == "YELLOW";
                        lockdown_timer = 60;
                        save_extensions_used = 0;
                        let _ = write_stream.write_all(format!("LOCKDOWN_TRIGGER:{}:{}\n", level, reason).as_bytes());
                    } else if msg.starts_with("LOCKDOWN:UI_ALIVE") {
                        lockdown_mode = true;
                        ui_alive = true;
                        lockdown_timer = 60;
                        save_extensions_used = 0;
                    } else if msg == "PING" {
                        // All good
                    } else if msg == "ACTION:SLEEP" || msg == "ACTION:IGNORE" {
                        sleep_mode = true;
                    } else if msg == "ACTION:QUIT" {
                        eprintln!("Watchdog: Graceful shutdown requested. Exiting safely.");
                        std::process::exit(0);
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    // Missed heartbeat
                    eprintln!("Watchdog: 5 seconds timeout. Missing heartbeat from PID {}", pid);
                    
                    // Enter lockdown mode instead of immediate kill
                    lockdown_mode = true;
                    ui_alive = false;
                    is_yellow = false;
                    lockdown_timer = 60;
                    save_extensions_used = 0;

                    // Trigger OS native popup for frozen process (macOS)
                    #[cfg(target_os = "macos")]
                    {
                        let script = format!("display dialog \"GETSSH Core Engine is frozen or unresponsive.\\n\\nInitiating physical memory kill and restarting in Safe Mode in 60 seconds...\" with title \"GETSSH Watchdog Alert\" buttons {{\"I Understand\"}} default button \"I Understand\" giving up after 60 with icon caution");
                        let _ = std::process::Command::new("osascript")
                            .arg("-e")
                            .arg(&script)
                            .spawn();
                    }
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    // Pipe closed unexpectedly
                    eprintln!("Watchdog: Pipe disconnected.");
                    kill_process(pid);
                    std::process::exit(1);
                }
            }
        } else {
            // Lockdown mode: Tick every 1 second
            if ui_alive {
                let _ = write_stream.write_all(format!("TICK:{}\n", lockdown_timer).as_bytes());
            }

            // Check if any override command came in (wait up to 1 second)
            match rx.recv_timeout(Duration::from_secs(1)) {
                Ok(msg) => {
                    if msg == "ACTION:RESTART-SAFE" {
                        // User verified and resolved
                        lockdown_mode = false;
                        let _ = write_stream.write_all(b"RESOLVED\n");
                    } else if msg == "ACTION:IGNORE" || msg == "ACTION:SLEEP" {
                        lockdown_mode = false;
                        sleep_mode = true;
                        let _ = write_stream.write_all(b"RESOLVED\n");
                    } else if msg == "ACTION:CONTINUE" {
                        lockdown_mode = false;
                        let _ = write_stream.write_all(b"RESOLVED\n");
                    } else if msg == "ACTION:SAVE-15S" {
                        // Bug Fix #5: Cap SAVE-15S extensions to prevent infinite countdown reset.
                        if save_extensions_used < MAX_SAVE_EXTENSIONS {
                            lockdown_timer = 15;
                            save_extensions_used += 1;
                            eprintln!("Watchdog: SAVE-15S granted ({}/{} max).", save_extensions_used, MAX_SAVE_EXTENSIONS);
                        } else {
                            eprintln!("Watchdog: SAVE-15S denied — max {} extensions reached. Countdown continues.", MAX_SAVE_EXTENSIONS);
                        }
                    } else if msg == "ACTION:QUIT" {
                        eprintln!("Watchdog: Graceful shutdown requested during lockdown. Exiting safely.");
                        std::process::exit(0);
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    if lockdown_timer > 0 {
                        lockdown_timer -= 1;
                    }
                    if lockdown_timer <= 0 {
                        if is_yellow {
                            // Yellow alerts just stay frozen waiting for user
                        } else {
                            eprintln!("Watchdog: 60s countdown expired. Terminating PID {}", pid);
                            kill_process(pid);
                            
                            // Restart in safe mode if it was a freeze
                            if !ui_alive {
                                if let Some(ref exec) = exec_path {
                                    eprintln!("Watchdog: Restarting {} in safe-mode...", exec);
                                    let _ = std::process::Command::new(exec)
                                        .arg("--safe-mode")
                                        .spawn();
                                }
                            }
                            
                            std::process::exit(1);
                        }
                    }
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    kill_process(pid);
                    std::process::exit(1);
                }
            }
        }
    }
}

// OS Specific stream connection
#[cfg(unix)]
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
