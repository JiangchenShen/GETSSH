extern crate napi_build;

/// SQLite3 Multiple Ciphers, built with the same options as better-sqlite3-multiple-ciphers
/// (deps/defines.gypi), so that the files GETSSH already wrote open unchanged.
const SQLITE_DEFINES: &[&str] = &[
  "HAVE_INT16_T=1",
  "HAVE_INT32_T=1",
  "HAVE_INT8_T=1",
  "HAVE_STDINT_H=1",
  "HAVE_UINT16_T=1",
  "HAVE_UINT32_T=1",
  "HAVE_UINT8_T=1",
  "HAVE_USLEEP=1",
  "SQLITE_DEFAULT_CACHE_SIZE=-16000",
  "SQLITE_DEFAULT_FOREIGN_KEYS=1",
  "SQLITE_DEFAULT_MEMSTATUS=0",
  "SQLITE_DEFAULT_WAL_SYNCHRONOUS=1",
  "SQLITE_DQS=0",
  "SQLITE_ENABLE_COLUMN_METADATA",
  "SQLITE_ENABLE_DBSTAT_VTAB",
  "SQLITE_ENABLE_DESERIALIZE",
  "SQLITE_ENABLE_FTS3",
  "SQLITE_ENABLE_FTS3_PARENTHESIS",
  "SQLITE_ENABLE_FTS4",
  "SQLITE_ENABLE_FTS5",
  "SQLITE_ENABLE_GEOPOLY",
  "SQLITE_ENABLE_JSON1",
  "SQLITE_ENABLE_MATH_FUNCTIONS",
  "SQLITE_ENABLE_PERCENTILE",
  "SQLITE_ENABLE_RTREE",
  "SQLITE_ENABLE_STAT4",
  "SQLITE_ENABLE_UPDATE_DELETE_LIMIT",
  "SQLITE_LIKE_DOESNT_MATCH_BLOBS",
  "SQLITE_OMIT_DEPRECATED",
  "SQLITE_OMIT_PROGRESS_CALLBACK",
  "SQLITE_OMIT_SHARED_CACHE",
  "SQLITE_OMIT_TCL_VARIABLE",
  "SQLITE_SOUNDEX",
  "SQLITE_THREADSAFE=2",
  "SQLITE_TRACE_SIZE_LIMIT=32",
  "SQLITE_USER_AUTHENTICATION=0",
  "SQLITE_USE_URI=0",
];

fn main() {
  napi_build::setup();

  let source = "vendor/sqlite3mc/sqlite3.c";
  println!("cargo:rerun-if-changed={source}");
  println!("cargo:rerun-if-changed=vendor/sqlite3mc/sqlite3.h");
  let mut build = cc::Build::new();
  build.file(source).include("vendor/sqlite3mc").warnings(false).opt_level(2);
  for define in SQLITE_DEFINES {
    match define.split_once('=') {
      Some((name, value)) => build.define(name, value),
      None => build.define(define, None),
    };
  }
  build.compile("sqlite3mc");
}
