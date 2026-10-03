//! What the watchdog decides, separate from the socket, the dialog and the kill, so it can be tested
//! with a fake clock. main.rs feeds it messages and silences and carries out the returned effects.
//!
//! Two kinds of lockdown:
//! - Freeze: the app missed its heartbeat. No UI can answer, so a system dialog warns the user.
//!   A heartbeat ends it (a modal system prompt, such as a Keychain request, blocks the main thread
//!   for as long as it is open). If no heartbeat comes before the deadline, the app is killed and
//!   restarted in safe mode.
//! - Alert: the app or the Windows memory scan reported tampering. The app's own UI shows the
//!   countdown (TICK) and only an explicit action ends it; heartbeats do not. A red alert kills the
//!   app at the deadline, a yellow one waits for the user.
//!
//! The countdown is a deadline, not a count of quiet seconds, so messages that keep arriving during
//! a lockdown cannot hold it back.

use std::time::{Duration, Instant};

pub const HEARTBEAT_TIMEOUT: Duration = Duration::from_secs(5);
pub const LOCKDOWN_GRACE: Duration = Duration::from_secs(60);
pub const SAVE_EXTENSION: Duration = Duration::from_secs(15);
/// A compromised app could otherwise send SAVE-15S forever and never be killed.
pub const MAX_SAVE_EXTENSIONS: u32 = 3;
const IDLE_WAIT: Duration = Duration::from_secs(5);
const TICK_INTERVAL: Duration = Duration::from_secs(1);

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Effect {
    /// A line for the app (main.rs adds the newline).
    Send(String),
    ShowFreezeDialog,
    CloseFreezeDialog,
    /// Kill the app; restart it in safe mode when it froze (an alert means it may be compromised).
    Kill { restart_safe: bool },
    Exit(i32),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Mode {
    Watching,
    Lockdown { deadline: Instant, ui_alive: bool, yellow: bool },
    /// The user chose to ignore the risk: keep the socket open and do nothing else.
    Sleeping,
}

pub struct Supervisor {
    mode: Mode,
    save_extensions_used: u32,
    last_tick: Option<u64>,
}

impl Default for Supervisor {
    fn default() -> Self {
        Self::new()
    }
}

fn whole_seconds_left(deadline: Instant, now: Instant) -> u64 {
    let left = deadline.saturating_duration_since(now);
    left.as_secs() + u64::from(left.subsec_nanos() > 0)
}

impl Supervisor {
    pub fn new() -> Self {
        Supervisor { mode: Mode::Watching, save_extensions_used: 0, last_tick: None }
    }

    pub fn is_watching(&self) -> bool {
        self.mode == Mode::Watching
    }

    pub fn is_frozen(&self) -> bool {
        matches!(self.mode, Mode::Lockdown { ui_alive: false, .. })
    }

    /// How long main.rs may wait for the next message before calling `on_silence` / `poll`.
    pub fn wait(&self, now: Instant) -> Duration {
        match self.mode {
            Mode::Watching => HEARTBEAT_TIMEOUT,
            Mode::Lockdown { deadline, .. } => deadline.saturating_duration_since(now).clamp(Duration::from_millis(10), TICK_INTERVAL),
            Mode::Sleeping => IDLE_WAIT,
        }
    }

    fn enter_lockdown(&mut self, now: Instant, ui_alive: bool, yellow: bool) {
        self.mode = Mode::Lockdown { deadline: now + LOCKDOWN_GRACE, ui_alive, yellow };
        self.save_extensions_used = 0;
        self.last_tick = None;
    }

    /// Ends a lockdown on the app's request and tells the app.
    fn resolve(&mut self, next: Mode) -> Vec<Effect> {
        let was_frozen = self.is_frozen();
        self.mode = next;
        let mut effects = vec![Effect::Send("RESOLVED".into())];
        if was_frozen {
            effects.push(Effect::CloseFreezeDialog);
        }
        effects
    }

    /// Countdown ticks for the app's UI and the action at the deadline. Call every loop turn.
    pub fn poll(&mut self, now: Instant) -> Vec<Effect> {
        let Mode::Lockdown { deadline, ui_alive, yellow } = self.mode else {
            return Vec::new();
        };
        let mut effects = Vec::new();
        let left = whole_seconds_left(deadline, now);
        if ui_alive && self.last_tick != Some(left) {
            self.last_tick = Some(left);
            effects.push(Effect::Send(format!("TICK:{left}")));
        }
        if now >= deadline && !yellow {
            if !ui_alive {
                effects.push(Effect::CloseFreezeDialog);
            }
            effects.push(Effect::Kill { restart_safe: !ui_alive });
            effects.push(Effect::Exit(1));
        }
        effects
    }

    /// Nothing arrived within `wait`: in watching mode that is a missed heartbeat.
    pub fn on_silence(&mut self, now: Instant) -> Vec<Effect> {
        if self.mode != Mode::Watching {
            return Vec::new();
        }
        self.enter_lockdown(now, false, false);
        vec![Effect::ShowFreezeDialog]
    }

    pub fn on_message(&mut self, msg: &str, now: Instant) -> Vec<Effect> {
        if msg == "ACTION:QUIT" {
            let mut effects = Vec::new();
            if self.is_frozen() {
                effects.push(Effect::CloseFreezeDialog);
            }
            effects.push(Effect::Exit(0));
            return effects;
        }
        match self.mode {
            Mode::Sleeping => Vec::new(),
            Mode::Watching => {
                if let Some(rest) = msg.strip_prefix("LOCKDOWN_TRIGGER:") {
                    let mut parts = rest.splitn(2, ':');
                    let level = parts.next().filter(|l| !l.is_empty()).unwrap_or("RED");
                    let reason = parts.next().unwrap_or("UNKNOWN");
                    self.enter_lockdown(now, true, level == "YELLOW");
                    vec![Effect::Send(format!("LOCKDOWN_TRIGGER:{level}:{reason}"))]
                } else if msg.starts_with("LOCKDOWN:UI_ALIVE") {
                    self.enter_lockdown(now, true, false);
                    Vec::new()
                } else if msg == "ACTION:SLEEP" || msg == "ACTION:IGNORE" {
                    self.mode = Mode::Sleeping;
                    Vec::new()
                } else {
                    // PING and anything else: the app is alive.
                    Vec::new()
                }
            }
            Mode::Lockdown { ui_alive, .. } => match msg {
                // The main thread runs again: it was stalled, not hung.
                "PING" if !ui_alive => {
                    self.mode = Mode::Watching;
                    vec![Effect::CloseFreezeDialog]
                }
                "ACTION:RESTART-SAFE" | "ACTION:CONTINUE" => self.resolve(Mode::Watching),
                "ACTION:IGNORE" | "ACTION:SLEEP" => self.resolve(Mode::Sleeping),
                "ACTION:SAVE-15S" => {
                    if self.save_extensions_used < MAX_SAVE_EXTENSIONS {
                        self.save_extensions_used += 1;
                        if let Mode::Lockdown { deadline, .. } = &mut self.mode {
                            *deadline = now + SAVE_EXTENSION;
                        }
                        eprintln!("Watchdog: SAVE-15S granted ({}/{MAX_SAVE_EXTENSIONS}).", self.save_extensions_used);
                    } else {
                        eprintln!("Watchdog: SAVE-15S denied, the {MAX_SAVE_EXTENSIONS} extensions are used up.");
                    }
                    Vec::new()
                }
                _ => Vec::new(),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kills(effects: &[Effect]) -> Option<bool> {
        effects.iter().find_map(|e| match e {
            Effect::Kill { restart_safe } => Some(*restart_safe),
            _ => None,
        })
    }

    #[test]
    fn a_missed_heartbeat_shows_the_dialog_and_a_heartbeat_ends_it() {
        let t0 = Instant::now();
        let mut s = Supervisor::new();
        assert!(s.on_message("PING", t0).is_empty());
        assert_eq!(s.on_silence(t0 + HEARTBEAT_TIMEOUT), vec![Effect::ShowFreezeDialog]);
        assert!(s.is_frozen());
        // The Keychain prompt was answered after 20 s: the main thread pings again.
        assert_eq!(s.on_message("PING", t0 + Duration::from_secs(25)), vec![Effect::CloseFreezeDialog]);
        assert!(s.is_watching(), "it watches again instead of staying in lockdown");
        assert_eq!(s.on_silence(t0 + Duration::from_secs(40)), vec![Effect::ShowFreezeDialog], "a later freeze is still caught");
    }

    #[test]
    fn a_real_freeze_is_killed_and_restarted_in_safe_mode_at_the_deadline() {
        let t0 = Instant::now();
        let mut s = Supervisor::new();
        s.on_silence(t0);
        assert_eq!(kills(&s.poll(t0 + Duration::from_secs(59))), None);
        let effects = s.poll(t0 + LOCKDOWN_GRACE);
        assert_eq!(kills(&effects), Some(true));
        assert!(effects.contains(&Effect::CloseFreezeDialog));
        assert_eq!(effects.last(), Some(&Effect::Exit(1)));
    }

    #[test]
    fn messages_during_an_alert_do_not_hold_the_countdown_back() {
        let t0 = Instant::now();
        let mut s = Supervisor::new();
        s.on_message("LOCKDOWN_TRIGGER:RED:MEMORY_HOOKED_CONNECT", t0);
        // A message every half second, as the old code's 1 s receive window never saw silence.
        for i in 1..=130 {
            let now = t0 + Duration::from_millis(500 * i);
            assert!(s.on_message("PING", now).is_empty(), "heartbeats do not end an alert");
            let effects = s.poll(now);
            if now >= t0 + LOCKDOWN_GRACE {
                assert_eq!(kills(&effects), Some(false), "a compromised app is not restarted");
                return;
            }
            assert_eq!(kills(&effects), None);
        }
        panic!("the deadline passed without a kill");
    }

    #[test]
    fn the_alert_echoes_its_level_and_ticks_once_a_second() {
        let t0 = Instant::now();
        let mut s = Supervisor::new();
        assert_eq!(s.on_message("LOCKDOWN_TRIGGER:YELLOW:risky command", t0), vec![Effect::Send("LOCKDOWN_TRIGGER:YELLOW:risky command".into())]);
        assert_eq!(s.poll(t0), vec![Effect::Send("TICK:60".into())]);
        assert!(s.poll(t0 + Duration::from_millis(300)).is_empty(), "no second tick within the same second");
        assert_eq!(s.poll(t0 + Duration::from_millis(1100)), vec![Effect::Send("TICK:59".into())]);
        assert_eq!(s.poll(t0 + LOCKDOWN_GRACE), vec![Effect::Send("TICK:0".into())], "a yellow alert waits for the user");
    }

    #[test]
    fn save_15s_moves_the_deadline_at_most_three_times() {
        let t0 = Instant::now();
        let mut s = Supervisor::new();
        s.on_message("LOCKDOWN_TRIGGER:RED:x", t0);
        let mut now = t0 + Duration::from_secs(50);
        for _ in 0..MAX_SAVE_EXTENSIONS {
            s.on_message("ACTION:SAVE-15S", now);
            assert_eq!(kills(&s.poll(now + Duration::from_secs(14))), None);
            now += Duration::from_secs(14);
        }
        s.on_message("ACTION:SAVE-15S", now);
        assert_eq!(kills(&s.poll(now + Duration::from_secs(1))), Some(false), "the fourth request is refused");
    }

    #[test]
    fn the_apps_actions_end_a_lockdown() {
        let t0 = Instant::now();
        let mut s = Supervisor::new();
        s.on_silence(t0);
        assert_eq!(s.on_message("ACTION:CONTINUE", t0), vec![Effect::Send("RESOLVED".into()), Effect::CloseFreezeDialog]);
        assert!(s.is_watching());

        s.on_message("LOCKDOWN_TRIGGER:RED:x", t0);
        assert_eq!(s.on_message("ACTION:IGNORE", t0), vec![Effect::Send("RESOLVED".into())]);
        assert!(s.on_silence(t0 + Duration::from_secs(600)).is_empty(), "ignored: no more freeze checks");
        assert!(s.poll(t0 + Duration::from_secs(600)).is_empty());
        assert_eq!(s.on_message("ACTION:QUIT", t0), vec![Effect::Exit(0)]);
    }

    #[test]
    fn wait_never_overshoots_the_deadline() {
        let t0 = Instant::now();
        let mut s = Supervisor::new();
        assert_eq!(s.wait(t0), HEARTBEAT_TIMEOUT);
        s.on_silence(t0);
        assert_eq!(s.wait(t0), TICK_INTERVAL);
        assert_eq!(s.wait(t0 + Duration::from_millis(59_700)), Duration::from_millis(300));
        assert_eq!(s.wait(t0 + Duration::from_secs(61)), Duration::from_millis(10));
    }
}
