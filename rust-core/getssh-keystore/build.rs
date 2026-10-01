extern crate napi_build;

use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
  napi_build::setup();
  if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
    build_swift_shim();
  }
}

fn xcrun(args: &[&str]) -> String {
  let output = Command::new("xcrun")
    .args(args)
    .output()
    .unwrap_or_else(|e| panic!("xcrun {args:?} failed to start: {e}"));
  assert!(output.status.success(), "xcrun {args:?} failed: {}", String::from_utf8_lossy(&output.stderr));
  String::from_utf8(output.stdout).expect("xcrun output is UTF-8").trim().to_string()
}

/// Compiles src/device/macos_shim.swift (CryptoKit Secure Enclave, LocalAuthentication, Keychain)
/// into a static library and links it with the Swift runtime that macOS 12+ ships in /usr/lib/swift.
fn build_swift_shim() {
  let source = "src/device/macos_shim.swift";
  println!("cargo:rerun-if-changed={source}");
  println!("cargo:rerun-if-env-changed=MACOSX_DEPLOYMENT_TARGET");

  let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR"));
  let arch = match env::var("CARGO_CFG_TARGET_ARCH").expect("target arch").as_str() {
    "aarch64" => "arm64",
    "x86_64" => "x86_64",
    other => panic!("unsupported macOS architecture {other}"),
  };
  let deployment = env::var("MACOSX_DEPLOYMENT_TARGET").unwrap_or_else(|_| "12.0".to_string());
  let sdk = xcrun(&["--sdk", "macosx", "--show-sdk-path"]);
  let swiftc = xcrun(&["--sdk", "macosx", "-f", "swiftc"]);
  let library = out_dir.join("libgetssh_keystore_shim.a");

  let status = Command::new(&swiftc)
    .args([
      "-parse-as-library",
      "-emit-library",
      "-static",
      "-O",
      "-whole-module-optimization",
      "-module-name",
      "GetsshKeystoreShim",
      "-target",
      &format!("{arch}-apple-macos{deployment}"),
      "-sdk",
      &sdk,
      source,
      "-o",
    ])
    .arg(&library)
    .status()
    .expect("swiftc failed to start");
  assert!(status.success(), "swiftc failed to build {source}");

  println!("cargo:rustc-link-search=native={}", out_dir.display());
  println!("cargo:rustc-link-lib=static=getssh_keystore_shim");
  for framework in ["CryptoKit", "LocalAuthentication", "Security", "Foundation"] {
    println!("cargo:rustc-link-lib=framework={framework}");
  }
  // Link against the SDK's Swift runtime stubs (and the toolchain's back-deployment libraries);
  // at run time the runtime comes from /usr/lib/swift.
  println!("cargo:rustc-link-search=native={sdk}/usr/lib/swift");
  let toolchain_lib = Path::new(&swiftc).parent().and_then(Path::parent).map(|p| p.join("lib/swift/macosx"));
  if let Some(toolchain_lib) = toolchain_lib.filter(|p| p.is_dir()) {
    println!("cargo:rustc-link-search=native={}", toolchain_lib.display());
  }
  println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
}
