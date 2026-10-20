# Third-Party Licenses

**Last updated:** October 15, 2026

GETSSH is licensed under the Apache License 2.0 ([LICENSE](../../LICENSE)). It includes software written by others, each part under its own license.

## Where the notices are

Every GETSSH package carries the full list, with each copyright notice and license text:

| File | What it covers | macOS | Windows |
|---|---|---|---|
| `THIRD_PARTY_NOTICES.txt` | Everything below except Electron and Chromium | `GETSSH.app/Contents/Resources/` | `resources\` in the install folder |
| `LICENSE.electron.txt` | Electron | `GETSSH.app/Contents/Resources/` | the install folder |
| `LICENSES.chromium.html` | Chromium and the libraries it includes, among them FFmpeg (LGPL 2.1) | `GETSSH.app/Contents/Resources/` | the install folder |

`THIRD_PARTY_NOTICES.txt` is generated for each build by `apps/getssh-client/scripts/third-party-notices.cjs`, which electron-builder runs before packing. It lists:

1. **JavaScript bundled into the app** (the window, the main process and the preload script), taken from the license files Vite writes during the build (`build.license`).
2. **Node.js packages shipped in `app.asar`**: the dependencies in `apps/getssh-client/package.json` and everything they depend on, with each package's own license files.
3. **Rust crates linked into the native modules and tools** in `rust-core/` (including `watchdog` and `getssh-sandbox`), from `cargo metadata`, with the license files in each crate.
4. **Fonts** in `apps/getssh-client/src/assets/fonts`:
   - MiSans, © Beijing Xiaomi Mobile Software Co., Ltd., used under Xiaomi's MiSans font license. The full text is on the website (<https://getssh.realmcloud.net/en/legal/licenses#misans>), and Settings → About links to it;
   - Reddit Sans, © Reddit, Inc., under the SIL Open Font License 1.1 (full text in `RedditSans-OFL.txt`).

To see the list for the current checkout, run `vite build` and then `node scripts/third-party-notices.cjs` in `apps/getssh-client`. The result is `dist/THIRD_PARTY_NOTICES.txt`.

## FFmpeg

Electron's media support uses FFmpeg, built as a separate library (`libffmpeg`) under the LGPL 2.1. Its source is part of the Chromium sources: <https://chromium.googlesource.com/chromium/third_party/ffmpeg>.

## Reporting an omission

If a component or a license is missing or wrong, open an issue in the GETSSH repository.
