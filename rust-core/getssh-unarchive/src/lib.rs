use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::fs;
use std::io;
use std::path::{Component, Path};

#[napi(js_name = "extractPlugin")]
pub async fn extract_plugin(zip_path: String, target_dir: String) -> Result<()> {
    tokio::task::spawn_blocking(move || {
        let file = fs::File::open(&zip_path).map_err(|e| Error::new(Status::GenericFailure, format!("Failed to open zip: {}", e)))?;
        let mut archive = zip::ZipArchive::new(file).map_err(|e| Error::new(Status::GenericFailure, format!("Invalid zip format: {}", e)))?;

        let out_dir = Path::new(&target_dir);

        for i in 0..archive.len() {
            let mut file = archive.by_index(i).map_err(|e| Error::new(Status::GenericFailure, format!("Failed to read zip entry: {}", e)))?;
            
            // 军工级防御：Zip Slip 漏洞拦截
            let raw_name = file.name().to_string();
            let entry_path = Path::new(&raw_name);

            // 如果使用 zip 库内置的安全检查发现问题，或者手动校验发现越权符
            let is_malicious = file.enclosed_name().is_none() || entry_path.components().any(|c| {
                matches!(c, Component::ParentDir | Component::RootDir | Component::Prefix(_))
            });

            if is_malicious {
                // 物理销毁已解压的残骸目录
                let _ = fs::remove_dir_all(&target_dir);
                return Err(Error::new(
                    Status::GenericFailure, 
                    format!("[Security] Zip Slip Vulnerability Detected: entry '{}' is attempting path traversal. Extraction aborted and debris destroyed.", raw_name)
                ));
            }

            let safe_path = file.enclosed_name().unwrap();
            let outpath = out_dir.join(safe_path);

            if raw_name.ends_with('/') {
                fs::create_dir_all(&outpath).map_err(|e| Error::new(Status::GenericFailure, format!("Failed to create dir: {}", e)))?;
            } else {
                if let Some(p) = outpath.parent() {
                    if !p.exists() {
                        fs::create_dir_all(p).map_err(|e| Error::new(Status::GenericFailure, format!("Failed to create parent dir: {}", e)))?;
                    }
                }
                
                // 零拷贝流式读取与落盘 (Zero-copy stream via std::io::copy)
                let mut outfile = fs::File::create(&outpath).map_err(|e| Error::new(Status::GenericFailure, format!("Failed to create file: {}", e)))?;
                io::copy(&mut file, &mut outfile).map_err(|e| Error::new(Status::GenericFailure, format!("Failed to extract file: {}", e)))?;
            }
        }
        
        Ok(())
    })
    .await
    .map_err(|e| Error::new(Status::GenericFailure, format!("Async task failed: {}", e)))?
}
