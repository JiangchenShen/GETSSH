fn main() {
    #[cfg(feature = "native")]
    {
        napi_build::setup();
        if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
            // Apple's SDK 27 legacy bind layout can emit an unaligned string pool.
            // Chained fixups keep the native addon loadable on macOS 11 and newer.
            println!("cargo:rustc-cdylib-link-arg=-Wl,-fixup_chains");
        }
    }
}
