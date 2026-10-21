# GETSSH

English | [中文](README_CN.md)

[![Version](https://img.shields.io/badge/version-3.0.0--preview-blueviolet?style=flat-square)](https://github.com/JiangchenShen/GETSSH/releases/tag/v3.0.0-preview)
[![Electron](https://img.shields.io/badge/Electron-44-47848F?style=flat-square&logo=electron&logoColor=white)](https://electronjs.org/)
[![Rust](https://img.shields.io/badge/Rust-N--API-CE4A00?style=flat-square&logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue?style=flat-square)](LICENSE)

GETSSH is a free, open-source SSH client for macOS and Windows.

- SSH and Telnet sessions, local terminals and SFTP in one window.
- Servers, passwords and private keys are stored encrypted on your computer.
- When you want it, AI helps troubleshoot, using your own model key.

The current version is the **3.0 preview** (`3.0.0-preview`, 2026-10-21), the FUSION edition for macOS and Windows. On Linux, please keep using [2.0](https://github.com/JiangchenShen/GETSSH/releases/tag/v2.0.0_R7K4S); 2.x is maintained on the [`V2`](https://github.com/JiangchenShen/GETSSH/tree/V2) branch.

- Website: <https://getssh.realmcloud.net>
- Release notes for the 3.0 preview: [docs/release-notes/v3.0.0-preview.md](docs/release-notes/v3.0.0-preview.md)
- Changelog: [docs/CHANGELOG_EN.md](docs/CHANGELOG_EN.md)

## Download

From the [GitHub release](https://github.com/JiangchenShen/GETSSH/releases/tag/v3.0.0-preview):

| System | Processor | File |
|---|---|---|
| macOS 13 or later | Apple Silicon | `GETSSH-3.0.0-preview-arm64.dmg` |
| macOS 13 or later | Intel | `GETSSH-3.0.0-preview.dmg` |
| Windows 10 or later | x64 | `GETSSH-Setup-3.0.0-preview-x64.exe` |
| Windows 10 or later | ARM64 | `GETSSH-Setup-3.0.0-preview-arm64.exe` |

`SHA256SUMS.txt` lists the SHA-256 of these files.

The app is not signed with an Apple Developer ID, and the Windows installer is not signed. On first launch:
- macOS 13 and 14: in Applications, right-click GETSSH and choose Open.
- macOS 15 and later: open GETSSH once; after the message that the developer cannot be verified, open System Settings → Privacy & Security and click Open Anyway near the bottom.
- Windows: when SmartScreen appears, click More info, then Run anyway.

Upgrading from 2.0, the first launch imports the 2.0 servers and plugin data; the 2.0 files are neither changed nor deleted. The release notes have the details.

## Features

- **Connections**:
  - SSH with a password, a key file on disk, or a key stored in GETSSH;
  - Telnet and local terminals;
  - a host's fingerprint is confirmed on first connect, and a changed fingerprint is flagged;
  - connections can go through a SOCKS5 or HTTP proxy.
- **Workspaces**: create several, each with its own encrypted database. Workspaces other than the main one can each have their own password.
- **Private keys**:
  - import Ed25519, RSA and ECDSA keys in OpenSSH, PEM (PKCS#1, SEC1, PKCS#8) and PuTTY `.ppk` (versions 2 and 3) format;
  - generate a new Ed25519 key;
  - import a key file a server already uses, and optionally move the original to the Trash (the Recycle Bin on Windows).
- **SFTP**: browse and transfer files next to the SSH session.
- **Tidal Engine**: split panes, resize them, focus one, or move a session to its own window.
- **Command Center**: search hosts and common actions. ⌥ + Space or ⌘ + K; on Windows, Alt + Space or Ctrl + Shift + K.
- **Encrypted backups**: export the workspaces you choose to one `.getssh-backup` file; the export password alone restores it on another computer.
- **AI troubleshooting**:
  - OpenAI, Gemini, Claude, DeepSeek, Zhipu GLM, Kimi, Ollama (local models) or a custom endpoint;
  - four modes: Read-only, Context assistant, Approval required, Automatic execution;
  - the mode decides whether each command waits for your approval;
  - in Approval required and Automatic execution, the AI can search the web; this is on by default and can be turned off in AI settings.
- **Plugins and MCP**: backend plugins and local MCP servers run in OS-confined processes. See the [SDK guide](https://getssh.realmcloud.net/en/sdk) for plugin development; an example plugin is in [`plugins/`](plugins).

## How your data is protected

**What is covered**:
- **Data on disk**: one database per workspace, in the SQLCipher 4 format, each with its own key. Passwords, private keys and passphrases are encrypted once more inside it with AES-256-GCM.
- **The interface never holds secrets**: they are opened only in the main process and handed to SSH when you connect.
- **Master password**: optional, at least 12 characters, processed with Argon2id (64 MiB, 3 passes), not stored.
  - With a master password, it protects what is in the encrypted databases (servers, passwords, private keys, AI sessions and AI service keys), and the data plus the master password can be restored on any computer.
  - Setting one creates a recovery code, shown only once.
- **Without a master password**: this computer keeps the keys, in the Secure Enclave or the login Keychain on macOS and the TPM or DPAPI on Windows. Copied database files do not open elsewhere, and the data opens only on this computer.
- **Touch ID / Windows Hello** can replace typing a password; whether they are on does not affect moving the data.
- **Encrypted backups**: an export password of at least 12 characters, Argon2id to derive the key, AES-256-GCM in chunks.
- **AI requests**: before a request goes to the model service, recognisable sensitive values such as passwords and tokens are replaced with placeholders. Web searches the AI makes carry the placeholders too.
- **Plugins**: in the two Isolated plugin security modes, each backend plugin runs in its own confined process (Seatbelt on macOS, AppContainer on Windows) and declares the files, network and client features it uses.

**What is not**:
- While GETSSH is unlocked, other programs running under your account may be able to read its memory.
- Without a master password, anyone who can log in to your computer account can open GETSSH.
- A key file a server still reads from disk is only as safe as that disk, and it is not in encrypted backups.
- Replacing sensitive values only covers what can be recognised; it cannot guarantee that no sensitive text reaches the model.
- Host fingerprints, connection history, recent hosts, interface settings (including a Google search API key if you enter one), plugins' own storage and terminal recordings are not in the encrypted databases; they are stored on disk unencrypted.
- In Developer mode, backend plugins run in the main process with the same rights as GETSSH.

## Privacy

GETSSH has no accounts, analytics or telemetry. It goes online only for:
- the SSH and Telnet connections you open;
- checking for a new version: at launch, every 12 hours, and when you click Check in Settings → About; macOS asks the GitHub releases API, Windows reads the release files on GitHub;
- the model service you configure, when you use AI;
- AI web searches (in Approval required and Automatic execution, on by default): queries go to public SearXNG servers (the list comes from searx.space), DuckDuckGo or Bing, or to the Google or SearXNG address you set;
- plugins and MCP servers, within the network access you allow.

## Building from source

You need:
- Node.js 24;
- pnpm 11.2.2 (`corepack enable` installs the version in `packageManager`);
- Rust stable (via `rustup`);
- on macOS 13 or later, the Xcode command line tools: the store compiles a Swift shim;
- on Windows 10 or later, Python 3 and the Visual Studio 2022 Build Tools with "Desktop development with C++" plus the "MSVC Spectre-mitigated libs" component (and the ARM64 build tools on an ARM64 PC): installing rebuilds node-pty with node-gyp.

```bash
git clone https://github.com/JiangchenShen/GETSSH.git
cd GETSSH
pnpm install --frozen-lockfile

# Rust native modules. RUST_TARGET is this machine's: aarch64-apple-darwin, x86_64-apple-darwin,
# x86_64-pc-windows-msvc or aarch64-pc-windows-msvc
RUST_TARGET=aarch64-apple-darwin node scripts/build-native.js
pnpm --filter getssh build:native-tools   # watchdog, and getssh-sandbox on Windows

pnpm dev
```

These are bash commands. In Windows PowerShell, set the variable like this: `$env:RUST_TARGET='x86_64-pc-windows-msvc'; node scripts/build-native.js`.

**Note**: the development build uses your real data directory, `~/.getssh`. For interface work you can run `GETSSH_FAKE_STORE=1 pnpm dev` (PowerShell: `$env:GETSSH_FAKE_STORE='1'; pnpm dev`): the encrypted store stays in memory, but `app-config.json`, plugin data and MCP settings under `~/.getssh` are still written.

Tests:

```bash
pnpm --filter getssh test                        # app unit tests (vitest)
cargo test --workspace --exclude ocean-sentinel  # Rust modules
```

On Windows, add `-- --skip made_up_tpm_key_names_are_lost_keys` to cargo test: that test hands modified data to the real TPM, and `scripts/windows-verify.ps1` skips it by default too.

`apps/getssh-client/package.json` has further suites, such as plugin isolation, the MCP sandbox and the encrypted store end to end; they need the built native modules.

Installers are built by [`.github/workflows/release.yml`](.github/workflows/release.yml):
- each of the four systems and architectures on a runner of its own kind, with no cross-compiled native modules;
- each package has the architecture of every native file checked and the packaged app started once;
- a `v*` tag creates a draft release.

## Repository layout

| Path | Contents |
|---|---|
| `apps/getssh-client/electron` | Main process and preload: connections, the store interface, process confinement for plugins and MCP |
| `apps/getssh-client/src` | Interface (React) |
| `rust-core/getssh-store` | Data layer: SQLCipher databases, servers and private keys, encrypted backups |
| `rust-core/getssh-keystore` | Key hierarchy, master password, recovery code and device keys; compiled into getssh-store |
| `rust-core/ocean-sentinel` | Sensitive-value replacement, the Watchdog, and the sandbox launcher on Windows |
| other modules in `rust-core/` | Plugin storage (getssh-kv), system monitoring (getssh-sysprobe), plugin extraction (getssh-unarchive), the 2.x encryption format (getssh-vault), SFTP transfers (sftp-stream), layout (tidal-engine), audit logs (audit-stream) |
| `docs` | Design documents, mostly in Chinese. `GETSSH_STORE_DESIGN_CN.md` covers the data layer; `PLUGIN_SDK_INTERNAL.md` the plugin API |

## License

Copyright © 2026 Jiangchen Shen. Licensed under the [Apache License 2.0](LICENSE).

The installers include `THIRD_PARTY_NOTICES.txt` with the third-party software used and their licenses; see [docs/legal/THIRD_PARTY_LICENSES.md](docs/legal/THIRD_PARTY_LICENSES.md). The MiSans font license is on the [website](https://getssh.realmcloud.net/en/legal/licenses#misans).
