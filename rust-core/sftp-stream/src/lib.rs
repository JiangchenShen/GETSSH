#![deny(clippy::all)]

#[macro_use]
extern crate napi_derive;

use napi::bindgen_prelude::*;
use std::fs::File;
use std::io::{Read, Write};
use tempfile::Builder;

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
    let mut dir_path = None;
    
    let (file, safe_path) = if max_size == 0 && target_local_path.is_some() {
      // Track B: Pure Download Mode
      let path = target_local_path.unwrap();
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
      
      // Use into_path() and hand over cleanup responsibility to JS
      let p = temp_dir.into_path();
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

  #[napi]
  pub fn read_chunk(&mut self, chunk_size: u32) -> Result<Option<Buffer>> {
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
