#![deny(clippy::all)]

#[macro_use]
extern crate napi_derive;

use crossbeam_channel::{bounded, Sender};
use flate2::write::GzEncoder;
use flate2::Compression;
use napi::bindgen_prelude::*;
use std::fs::File;
use std::io::Write;
use std::thread;

pub enum AuditMessage {
  Data { timestamp: f64, payload: Vec<u8> },
  FlushAndClose,
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

#[napi]
pub struct AuditStream {
  tx: Sender<AuditMessage>,
}

#[napi]
impl AuditStream {
  #[napi(constructor)]
  pub fn new(output_path: String, header_json: String) -> Result<Self> {
    // 10k frame Ring Buffer Capacity
    let (tx, rx) = bounded::<AuditMessage>(1024 * 10);

    thread::spawn(move || {
      // Ensure directory exists
      if let Some(parent) = std::path::Path::new(&output_path).parent() {
        let _ = std::fs::create_dir_all(parent);
      }

      if let Ok(file) = File::create(&output_path) {
        let mut encoder = GzEncoder::new(file, Compression::default());

        // Asciinema v2 header
        let _ = writeln!(encoder, "{}", header_json);

        let mut buffer = Vec::with_capacity(4096);
        let mut last_timestamp = 0.0_f64;

        for msg in rx {
          match msg {
            AuditMessage::Data { timestamp, payload } => {
              last_timestamp = frame_time(timestamp, last_timestamp);
              let payload_str = String::from_utf8_lossy(&payload);
              // Serialize safely using serde_json to handle quotes and escapes
              if let Ok(json_str) = serde_json::to_string(&payload_str) {
                let json_array = format!("[{:.6}, \"o\", {}]\n", last_timestamp, json_str);
                buffer.extend_from_slice(json_array.as_bytes());

                // Flush if buffer reaches 4KB
                if buffer.len() >= 4096 {
                  let _ = encoder.write_all(&buffer);
                  buffer.clear();
                }
              }
            }
            AuditMessage::FlushAndClose => {
              if !buffer.is_empty() {
                let _ = encoder.write_all(&buffer);
              }
              let _ = encoder.finish();
              break;
            }
          }
        }
      }
    });

    Ok(Self { tx })
  }

  #[napi]
  pub fn write_frame(&self, timestamp: f64, data: Buffer) {
    // Non-blocking try_send (drop if ring buffer is totally overwhelmed to prevent Node.js OOM)
    let _ = self.tx.try_send(AuditMessage::Data {
      timestamp,
      payload: data.as_ref().to_vec(),
    });
  }

  #[napi]
  pub fn end(&self) {
    let _ = self.tx.send(AuditMessage::FlushAndClose);
  }
}

#[cfg(test)]
mod tests {
  use super::*;

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
}
