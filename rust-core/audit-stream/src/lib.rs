#![deny(clippy::all)]

#[macro_use]
extern crate napi_derive;

use crossbeam_channel::{bounded, Receiver, SendTimeoutError, Sender, TrySendError};
use flate2::write::GzEncoder;
use flate2::Compression;
use napi::bindgen_prelude::*;
use std::fs::File;
use std::io::Write;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

/// Frames waiting for the writer may hold at most this many payload bytes. The writer gzips on one
/// thread; a server flooding output faster than that used to queue up to 10,240 frames of up to
/// 32 KiB each (about 320 MiB) per session.
const MAX_QUEUED_BYTES: usize = 16 * 1024 * 1024;
const MAX_QUEUED_FRAMES: usize = 1024 * 10;
/// How long end() blocks the JS thread at most, waiting for room in the queue when the writer is
/// stuck on a slow or hung disk.
const CLOSE_TIMEOUT: Duration = Duration::from_secs(2);

pub enum AuditMessage {
  /// `skipped_before`: payload bytes left out just before this frame because the queue was full.
  Data { timestamp: f64, payload: Vec<u8>, skipped_before: usize },
  FlushAndClose { skipped_before: usize },
}

/// NaN, infinities and times that go backwards would make the line invalid JSON or break playback;
/// such frames keep the previous time instead.
fn frame_time(timestamp: f64, last: f64) -> f64 {
  if timestamp.is_finite() && timestamp >= last {
    timestamp
  } else {
    last
  }
}

/// Payload bytes in the queue, and bytes left out since the last frame that got in.
#[derive(Default)]
struct Backlog {
  queued: AtomicUsize,
  skipped: AtomicUsize,
}

/// The JS side of a recording: frames go into a bounded queue, never blocking for long. close()
/// drops the sender, so the writer finishes the file once it has caught up even if the close
/// request itself did not fit.
struct Producer {
  tx: Mutex<Option<Sender<AuditMessage>>>,
  backlog: Arc<Backlog>,
  limit: usize,
}

impl Producer {
  fn push(&self, timestamp: f64, payload: &[u8]) {
    let guard = self.tx.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    // After end(), output is no longer part of the recording.
    let Some(tx) = guard.as_ref() else { return };
    let len = payload.len();
    if self.backlog.queued.fetch_add(len, Ordering::AcqRel) + len > self.limit {
      self.backlog.queued.fetch_sub(len, Ordering::AcqRel);
      self.backlog.skipped.fetch_add(len, Ordering::AcqRel);
      return;
    }
    let skipped_before = self.backlog.skipped.swap(0, Ordering::AcqRel);
    let message = AuditMessage::Data { timestamp, payload: payload.to_vec(), skipped_before };
    if let Err(TrySendError::Full(_) | TrySendError::Disconnected(_)) = tx.try_send(message) {
      self.backlog.queued.fetch_sub(len, Ordering::AcqRel);
      self.backlog.skipped.fetch_add(len + skipped_before, Ordering::AcqRel);
    }
  }

  fn close(&self, timeout: Duration) {
    let Some(tx) = self.tx.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).take() else {
      return;
    };
    let skipped_before = self.backlog.skipped.swap(0, Ordering::AcqRel);
    if let Err(SendTimeoutError::Timeout(_)) = tx.send_timeout(AuditMessage::FlushAndClose { skipped_before }, timeout) {
      // The writer marks these at the end instead.
      self.backlog.skipped.fetch_add(skipped_before, Ordering::AcqRel);
      eprintln!("[audit-stream] The recording writer is behind; it finishes the file once it catches up.");
    }
  }
}

fn gap_line(timestamp: f64, skipped: usize) -> String {
  let note = format!("\r\n[GETSSH: {skipped} bytes of output were not recorded]\r\n");
  format!("[{:.6}, \"o\", {}]\n", timestamp, serde_json::to_string(&note).unwrap_or_default())
}

/// Writes the asciicast v2 lines for the messages in `rx` to `out`, until a close request or until
/// every sender is gone (the stream was dropped without end()).
fn write_recording<W: Write>(rx: Receiver<AuditMessage>, backlog: &Backlog, out: &mut W, header_json: &str) {
  let _ = writeln!(out, "{}", header_json);
  let mut buffer = Vec::with_capacity(4096);
  let mut last_timestamp = 0.0_f64;
  for msg in rx {
    match msg {
      AuditMessage::Data { timestamp, payload, skipped_before } => {
        backlog.queued.fetch_sub(payload.len(), Ordering::AcqRel);
        last_timestamp = frame_time(timestamp, last_timestamp);
        if skipped_before > 0 {
          buffer.extend_from_slice(gap_line(last_timestamp, skipped_before).as_bytes());
        }
        let payload_str = String::from_utf8_lossy(&payload);
        // Serialize safely using serde_json to handle quotes and escapes
        if let Ok(json_str) = serde_json::to_string(&payload_str) {
          let json_array = format!("[{:.6}, \"o\", {}]\n", last_timestamp, json_str);
          buffer.extend_from_slice(json_array.as_bytes());
        }
        // Flush if buffer reaches 4KB
        if buffer.len() >= 4096 {
          let _ = out.write_all(&buffer);
          buffer.clear();
        }
      }
      AuditMessage::FlushAndClose { skipped_before } => {
        if skipped_before > 0 {
          buffer.extend_from_slice(gap_line(last_timestamp, skipped_before).as_bytes());
        }
        break;
      }
    }
  }
  // Left out after the last frame, when the close request itself did not fit in the queue.
  let skipped = backlog.skipped.swap(0, Ordering::AcqRel);
  if skipped > 0 {
    buffer.extend_from_slice(gap_line(last_timestamp, skipped).as_bytes());
  }
  if !buffer.is_empty() {
    let _ = out.write_all(&buffer);
  }
}

#[napi]
pub struct AuditStream {
  producer: Producer,
}

#[napi]
impl AuditStream {
  #[napi(constructor)]
  pub fn new(output_path: String, header_json: String) -> Result<Self> {
    let (tx, rx) = bounded::<AuditMessage>(MAX_QUEUED_FRAMES);
    let backlog = Arc::new(Backlog::default());
    let writer_backlog = backlog.clone();

    thread::spawn(move || {
      // Ensure directory exists
      if let Some(parent) = std::path::Path::new(&output_path).parent() {
        let _ = std::fs::create_dir_all(parent);
      }

      if let Ok(file) = File::create(&output_path) {
        let mut encoder = GzEncoder::new(file, Compression::default());
        write_recording(rx, &writer_backlog, &mut encoder, &header_json);
        let _ = encoder.finish();
      }
    });

    Ok(Self { producer: Producer { tx: Mutex::new(Some(tx)), backlog, limit: MAX_QUEUED_BYTES } })
  }

  #[napi]
  pub fn write_frame(&self, timestamp: f64, data: Buffer) {
    // Never blocks: a frame that does not fit is left out and marked in the recording.
    self.producer.push(timestamp, data.as_ref());
  }

  /// Blocks for at most 2 seconds; the file is finished either way once the writer catches up.
  #[napi]
  pub fn end(&self) {
    self.producer.close(CLOSE_TIMEOUT);
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::time::Instant;

  #[test]
  fn frame_time_is_finite_and_monotonic() {
    assert_eq!(frame_time(1.5, 0.0), 1.5);
    assert_eq!(frame_time(f64::NAN, 1.5), 1.5);
    assert_eq!(frame_time(f64::INFINITY, 1.5), 1.5);
    assert_eq!(frame_time(f64::NEG_INFINITY, 1.5), 1.5);
    assert_eq!(frame_time(-5.5, 1.5), 1.5);
    assert_eq!(frame_time(0.5, 1.5), 1.5);
    let line = format!("[{:.6}, \"o\", {}]", frame_time(f64::NAN, 0.0), serde_json::to_string("x").unwrap());
    assert!(serde_json::from_str::<serde_json::Value>(&line).is_ok(), "{}", line);
  }

  fn producer(limit: usize, frames: usize) -> (Producer, Receiver<AuditMessage>, Arc<Backlog>) {
    let (tx, rx) = bounded(frames);
    let backlog = Arc::new(Backlog::default());
    (Producer { tx: Mutex::new(Some(tx)), backlog: backlog.clone(), limit }, rx, backlog)
  }

  fn texts(rx: Receiver<AuditMessage>, backlog: &Backlog) -> Vec<String> {
    let mut out = Vec::new();
    write_recording(rx, backlog, &mut out, "{\"version\":2}");
    String::from_utf8(out)
      .unwrap()
      .lines()
      .skip(1)
      .map(|line| serde_json::from_str::<serde_json::Value>(line).unwrap()[2].as_str().unwrap().to_string())
      .collect()
  }

  #[test]
  fn a_full_queue_leaves_frames_out_and_the_recording_says_where() {
    // A writer that has fallen behind: 10 bytes of room.
    let (p, rx, backlog) = producer(10, 100);
    p.push(1.0, b"12345678");
    p.push(2.0, b"lost-1");
    p.push(3.0, b"lost-22");
    assert_eq!(backlog.queued.load(Ordering::Acquire), 8, "only what fit is queued");
    // The writer takes the first frame; the next one fits again.
    let Ok(AuditMessage::Data { payload, .. }) = rx.recv() else { panic!("the first frame") };
    assert_eq!(payload, b"12345678");
    backlog.queued.fetch_sub(payload.len(), Ordering::AcqRel);
    p.push(4.0, b"after");
    p.close(Duration::from_millis(10));
    assert_eq!(texts(rx, &backlog), ["\r\n[GETSSH: 13 bytes of output were not recorded]\r\n", "after"]);
    assert_eq!(backlog.queued.load(Ordering::Acquire), 0);
  }

  #[test]
  fn frames_left_out_at_the_end_are_marked_too() {
    let (p, rx, backlog) = producer(4, 100);
    p.push(1.0, b"abcd");
    p.push(2.0, b"efgh");
    p.close(Duration::from_millis(10));
    assert_eq!(texts(rx, &backlog), ["abcd", "\r\n[GETSSH: 4 bytes of output were not recorded]\r\n"]);
  }

  #[test]
  fn a_full_frame_queue_counts_as_left_out() {
    let (p, rx, backlog) = producer(1 << 20, 1);
    p.push(1.0, b"in");
    p.push(2.0, b"out");
    assert_eq!(backlog.queued.load(Ordering::Acquire), 2);
    assert_eq!(backlog.skipped.load(Ordering::Acquire), 3);
    drop(p);
    assert_eq!(texts(rx, &backlog), ["in", "\r\n[GETSSH: 3 bytes of output were not recorded]\r\n"]);
  }

  #[test]
  fn end_does_not_wait_for_a_stuck_writer() {
    // One slot, already taken, and nobody reading: a writer stuck on a hung disk.
    let (p, _rx, _backlog) = producer(1 << 20, 1);
    p.push(1.0, b"x");
    let started = Instant::now();
    p.close(Duration::from_millis(200));
    assert!(started.elapsed() < Duration::from_secs(2));
  }

  #[test]
  fn a_close_that_did_not_fit_still_lets_the_writer_finish_and_mark_the_gap() {
    // The writer is behind: one frame queued, the queue full, and more output left out.
    let (p, rx, backlog) = producer(4, 1);
    p.push(1.0, b"abcd");
    p.push(2.0, b"efgh");
    p.close(Duration::from_millis(10));
    p.push(3.0, b"after end");
    // The writer catches up later; it must end on its own (no close request, no sender left).
    let (done_tx, done_rx) = std::sync::mpsc::channel();
    let backlog_for_writer = backlog.clone();
    thread::spawn(move || {
      let _ = done_tx.send(texts(rx, &backlog_for_writer));
    });
    let written = done_rx.recv_timeout(Duration::from_secs(5)).expect("the writer finished");
    assert_eq!(written, ["abcd", "\r\n[GETSSH: 4 bytes of output were not recorded]\r\n"]);
  }

  #[test]
  fn a_stream_dropped_without_end_still_writes_what_it_got() {
    let (p, rx, backlog) = producer(1 << 20, 100);
    p.push(1.0, b"kept");
    drop(p);
    assert_eq!(texts(rx, &backlog), ["kept"]);
  }
}
