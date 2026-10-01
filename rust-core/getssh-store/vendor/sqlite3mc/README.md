# SQLite3 Multiple Ciphers (vendored)

| | |
|---|---|
| Project | SQLite3 Multiple Ciphers — https://github.com/utelle/SQLite3MultipleCiphers |
| Version | 2.3.5, based on SQLite 3.53.2 |
| Files | `sqlite3.c`, `sqlite3.h` (the amalgamation) |
| Taken from | `better-sqlite3-multiple-ciphers@12.11.1`, `deps/sqlite3/` (generated there by `deps/update-sqlite3mc.sh` from the upstream release) |
| SHA-256 `sqlite3.c` | `670d8d053176b53a68073b168f8e68fb72db67bdf964a0eb130338e9391198b9` |
| SHA-256 `sqlite3.h` | `8270c30673c9dccb08f0516ae63b64f898a09bc92b76d850cd912b0c1461dbe5` |
| License | SQLite3 Multiple Ciphers: MIT, Copyright (c) 2006-2025 Ulrich Telle. SQLite itself: public domain. Some bundled cipher code carries its own permissive notices inside `sqlite3.c`. |

This is the same engine and the same build options (see `../../build.rs`) that wrote every
existing GETSSH database, so getssh-store opens them without converting anything.

When upgrading: take the amalgamation from an upstream release, update the version and hashes
here, and run `cargo test -p getssh-store` plus the keystore e2e suite against databases written
by the previous version.
