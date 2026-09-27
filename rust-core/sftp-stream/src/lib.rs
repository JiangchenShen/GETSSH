#![deny(clippy::all)]

#[macro_use]
extern crate napi_derive;

use napi::bindgen_prelude::*;
use std::fs::File;
use std::io::{Read, Write};
use tempfile::Builder;

/// Largest single read: the caller allocates this much per call.
const MAX_CHUNK_SIZE: u32 = 1024 * 1024;

#[napi(object)]
pub struct FinishResult {
  pub safe_path: String,
  pub dir_path: Option<String>,
}

#[napi]
pub struct SftpDownloader {
  file: Option<std::fs::File>,
  pub safe_path: String,
  pub dir_path: Option<String>,
  current_size: i64,
  max_size: i64,
}

#[napi]
impl SftpDownloader {
  #[napi(factory)]
  pub fn create(max_size: i64, target_local_path: Option<String>) -> Result<Self> {
    if max_size < 0 {
      return Err(Error::from_reason("max_size must not be negative".to_string()));
    }
    let mut dir_path = None;
    
    let (file, safe_path) = if let (0, Some(path)) = (max_size, target_local_path) {
      // Track B: Pure Download Mode
      // File::create follows links; a link planted under the chosen name would redirect the write.
      if std::fs::symlink_metadata(&path).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err(Error::from_reason("Refusing to download over a symbolic link".to_string()));
      }
      let file = File::create(&path).map_err(|e| Error::from_reason(e.to_string()))?;
      (file, path)
    } else {
      // Track A: Edit Mode (Sandbox)
      let temp_dir = Builder::new()
        .prefix("getssh_secure_")
        .tempdir()
        .map_err(|e| Error::from_reason(e.to_string()))?;
      
      let path = temp_dir.path().join("sftp_temp.tmp");
      let file = File::create(&path).map_err(|e| Error::from_reason(e.to_string()))?;
      
      // Use keep() and hand over cleanup responsibility to JS
      let p = temp_dir.keep();
      dir_path = Some(p.to_string_lossy().to_string());
      
      (file, path.to_string_lossy().to_string())
    };

    Ok(Self {
      file: Some(file),
      safe_path,
      dir_path,
      current_size: 0,
      max_size,
    })
  }

  #[napi]
  pub fn append(&mut self, chunk: Buffer) -> Result<()> {
    self.current_size += chunk.len() as i64;
    if self.max_size > 0 && self.current_size > self.max_size {
      // OOM Prevention Triggered: Force physical file lock release immediately
      self.file.take();
      return Err(Error::from_reason("File size exceeds maximum allowed size (OOM prevention triggered)".to_string()));
    }
    
    if let Some(ref mut file) = self.file {
      file.write_all(chunk.as_ref()).map_err(|e| Error::from_reason(e.to_string()))?;
      Ok(())
    } else {
      Err(Error::from_reason("File is closed".to_string()))
    }
  }

  #[napi]
  pub fn finish(&mut self) -> Result<FinishResult> {
    if let Some(mut file) = self.file.take() {
      file.flush().map_err(|e| Error::from_reason(e.to_string()))?;
    }
    Ok(FinishResult {
      safe_path: self.safe_path.clone(),
      dir_path: self.dir_path.clone(),
    })
  }
}

#[napi]
pub struct SftpUploader {
  file: Option<std::fs::File>,
}

#[napi]
impl SftpUploader {
  #[napi(factory)]
  pub fn open(local_path: String) -> Result<Self> {
    let file = File::open(local_path).map_err(|e| Error::from_reason(e.to_string()))?;
    Ok(Self { file: Some(file) })
  }

  /// Reads up to `chunk_size` bytes (1 byte to 1 MiB); `None` means end of file.
  #[napi]
  pub fn read_chunk(&mut self, chunk_size: u32) -> Result<Option<Buffer>> {
    if chunk_size == 0 || chunk_size > MAX_CHUNK_SIZE {
      return Err(Error::from_reason(format!(
        "chunk_size must be between 1 and {} bytes",
        MAX_CHUNK_SIZE
      )));
    }
    if let Some(ref mut file) = self.file {
      let mut buf = vec![0u8; chunk_size as usize];
      let n = file.read(&mut buf).map_err(|e| Error::from_reason(e.to_string()))?;
      if n == 0 {
        self.file.take();
        return Ok(None);
      }
      buf.truncate(n);
      Ok(Some(buf.into()))
    } else {
      Err(Error::from_reason("File is closed".to_string()))
    }
  }

  #[napi]
  pub fn close(&mut self) -> Result<()> {
    self.file.take();
    Ok(())
  }
}
