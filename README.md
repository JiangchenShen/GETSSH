# GETSSH

English | [中文](README_CN.md)

[![Version](https://img.shields.io/badge/version-3.0.0--preview.2-blueviolet?style=flat-square)](https://github.com/JiangchenShen/GETSSH/releases/tag/v3.0.0-preview.2)
[![Electron](https://img.shields.io/badge/Electron-44-47848F?style=flat-square&logo=electron&logoColor=white)](https://electronjs.org/)
[![Rust](https://img.shields.io/badge/Rust-N--API-CE4A00?style=flat-square&logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue?style=flat-square)](LICENSE)

GETSSH is a free, open-source SSH client for macOS and Windows.

- SSH and Telnet sessions, local terminals and SFTP in one window.
- Servers, passwords and private keys are stored encrypted on your computer.
- When you want it, AI helps troubleshoot, using your own model key.

The current version is the **3.0 Preview 2** (`3.0.0-preview.2`, 2026-10-29), the FUSION edition for macOS and Windows. On Linux, please keep using [2.0](https://github.com/JiangchenShen/GETSSH/releases/tag/v2.0.0_R7K4S); 2.x is maintained on the [`V2`](https://github.com/JiangchenShen/GETSSH/tree/V2) branch.

- Website: <https://getssh.realmcloud.net>
- Release notes for the 3.0 Preview 2: [docs/release-notes/v3.0.0-preview.2.md](docs/release-notes/v3.0.0-preview.2.md). Everything 3.0 offers, and how to upgrade from 2.0, is in the [3.0 preview release notes](docs/release-notes/v3.0.0-preview.md)
- Changelog: [docs/CHANGELOG_EN.md](docs/CHANGELOG_EN.md)
- How 3.0 differs from 2.0: [What changed since 2.0](#what-changed-since-20) below

## Download

From the [GitHub release](https://github.com/JiangchenShen/GETSSH/releases/tag/v3.0.0-preview.2):

| System | Processor | File |
|---|---|---|
| macOS 13 or later | Apple Silicon | `GETSSH-3.0.0-preview.2-arm64.dmg` |
| macOS 13 or later | Intel | `GETSSH-3.0.0-preview.2.dmg` |
| Windows 10 or later | x64 | `GETSSH-Setup-3.0.0-preview.2-x64.exe` |
| Windows 10 or later | ARM64 | `GETSSH-Setup-3.0.0-preview.2-arm64.exe` |

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
- **Workspaces**: create several, each with its own encrypted database. While no master password is set, workspaces other than the main one can each have their own password.
- **Private keys**:
  - import Ed25519, RSA and ECDSA keys in OpenSSH, PEM (PKCS#1, SEC1, PKCS#8) and PuTTY `.ppk` (versions 2 and 3) format;
  - generate a new Ed25519 key;
  - import a key file a server already uses, and optionally move the original to the Trash (the Recycle Bin on Windows).
- **SFTP**: browse and download files next to the SSH session; double-click a file to edit it, and it is uploaded back when you save. There is no direct upload yet.
- **Tidal Engine**: split panes, resize them, focus one, or move a session to its own window.
- **Command Center**: search hosts, common actions and runbooks, or switch to AI. ⌥ + Space or ⌘ + K; on Windows, Alt + Space or Ctrl + Shift + K.
- **Encrypted backups**: export the workspaces you choose to one `.getssh-backup` file; the backup password alone restores it on another computer.
- **AI troubleshooting**:
  - OpenAI, Gemini, Claude, DeepSeek, Zhipu GLM, Kimi, MiniMax, Alibaba Qwen, Ollama (local models) or a custom endpoint;
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
- **Encrypted backups**: a backup password of at least 12 characters, Argon2id to derive the key, AES-256-GCM in chunks.
- **AI requests**: before a request goes to the model service, recognisable sensitive values such as passwords and tokens are replaced with placeholders. Web searches the AI makes carry the placeholders too.
- **Plugins**: in the two Isolated plugin security modes, each backend plugin runs in its own confined process (Seatbelt on macOS, AppContainer on Windows): it can read only its own folder, write one temporary folder, and has no direct network access. A plugin declares the client features it uses, such as reading or writing a terminal, the clipboard, or going online through GETSSH.

**What is not**:
- While GETSSH is unlocked, other programs running under your account may be able to read its memory.
- Without a master password, anyone who can log in to your computer account can open GETSSH.
- A key file a server still reads from disk is only as safe as that disk, and it is not in encrypted backups.
- Replacing sensitive values only covers what can be recognised; it cannot guarantee that no sensitive text reaches the model.
- Host fingerprints, connection history, interface settings (including a Google search API key if you enter one), plugins' own storage and terminal recordings are not in the encrypted databases; they are stored on disk unencrypted.
- Plugin pages, a plugin's own interface, are not confined this way: they run in an iframe of the main window that allows scripts. Their CSP lets them load only their own plugin's files, but it does not cover WebRTC, so a page can still reach external STUN and TURN servers.
- HTTP MCP servers do not run in a confined process; the main process connects to the address you enter.
- In Developer mode, backend plugins run in the main process with the same rights as GETSSH.

## Privacy

GETSSH has no accounts, analytics or telemetry. It goes online only for:
- the SSH and Telnet connections you open;
- checking for a new version: at launch, every 12 hours, and when you click Check in Settings → About, from the GitHub releases API. In 3.0.0-preview the Windows background check does not find new versions, so use the check in Settings → About; 3.0.0-preview.2 fixes this;
- the model service you configure, when you use AI;
- AI web searches (in Approval required and Automatic execution, on by default): queries go to public SearXNG servers (the list comes from searx.space), DuckDuckGo or Bing, or to the Google or SearXNG address you set;
- plugins and MCP servers: a backend plugin, once it declares it, reaches public addresses only through GETSSH; local MCP servers have no network unless you allow it in their settings; HTTP MCP servers connect to the address you enter; plugin pages cannot go online directly, except over WebRTC, which is not blocked yet.

## What changed since 2.0

This compares two release tags: 2.0's `v2.0.0_R7K4S` and the 3.0 preview's `v3.0.0-preview`. Every item was checked against the code at those two tags, not taken from the release notes of the time. 3.0 Preview 2 changes a few of them: plugin pages no longer go online directly, the Windows background update check asks the GitHub API, and Electron is at 44.10.0. The rows concerned say so in brackets.

### The main changes

- **AI**: 2.0 had no AI. 3.0 works with 10 model services using your own key, including local Ollama and a custom endpoint. Four modes decide what the AI may read and do; in Approval required, every command the AI wants to run in a terminal waits for your approval.
- **Encrypted with or without a master password**: each workspace has its own database in the SQLCipher 4 format, with the key held by the Secure Enclave, the Keychain, the TPM or DPAPI. 2.0 without a master password kept servers and passwords in plain text in `profiles.json`.
- **Master password**: now Argon2id (64 MiB, 3 passes), at least 12 characters, not stored, with a recovery code. 2.0 used PBKDF2 and also saved the master password in `profiles.key`, which on macOS opens with a public constant.
- **The interface never holds secrets**: the main process takes the password or private key at connect, hands it to SSH and wipes it. In 2.0 the whole unlocked server list, plain passwords included, sat in the interface.
- **Private keys**: import them (OpenSSH, PEM, PuTTY `.ppk` v2/v3, with passphrases too) or generate Ed25519 keys, stored encrypted in GETSSH. 2.0 saved only a key file path and could not use passphrase-protected keys.
- **Workspaces and backups**: create several workspaces, each with its own encrypted database. Backups are `.getssh-backup` files that the backup password alone restores on another computer; 2.0 could only export the server list.
- **Plugins**: in the two Isolated modes, each backend plugin runs in its own confined process (Seatbelt on macOS, AppContainer on Windows), with no direct network access and no access to your files. 2.0 ran plugins in the main process with Node's `vm`, which does not stop hostile code. The default plugin mode is now Safe.
- **MCP**: a new MCP client; local MCP servers also run in confined processes.
- **Windows and sessions**: a session can move to its own window, and closing a pane ends its session; in 2.0 it stayed connected until you quit.
- **Host keys**: the handshake timer pauses while you confirm a fingerprint, and Strict host key checking can be turned on per server.
- **Systems**: builds for macOS 13 or later and Windows only; there is no Linux build any more.
- **Tests**: 2.0 had no automated tests; the 3.0 preview has 1,317 app unit tests and 289 Rust tests.
- **Not there yet**: jump hosts, port forwarding, an SSH agent, search in the terminal; SFTP has no direct upload.

### The code in numbers

From 2.0 (`v2.0.0_R7K4S`, 2026-06-06) to the 3.0 preview (`v3.0.0-preview`, 2026-10-21) there are 272 commits:

- 518 files changed, with 101,664 lines added and 14,247 deleted. Lockfiles, vendored third-party source and generated files are left out.
- 2.0's main process, interface and Rust modules had 15,632 lines. Of those, 11,656 (75%) were deleted or rewritten for 3.0, and 3,976 (25%) are unchanged.
- 2.0 had no automated tests. The 3.0 preview has 1,317 app unit tests and 289 Rust tests, and the packaged app is started once on each of the four systems and architectures.

| Part | Files 2.0 → 3.0 | Lines 2.0 → 3.0 | Added | Deleted |
|---|---|---|---:|---:|
| Main process (`electron/`) | 17 → 92 | 4,355 → 24,486 | 23,667 | 3,536 |
| Interface (`src/`) | 37 → 126 | 8,923 → 21,783 | 19,414 | 6,554 |
| Rust modules (`rust-core/`) | 35 → 89 | 2,354 → 25,270 | 24,482 | 1,566 |
| Tests | 0 → 98 | 0 → 18,993 | 18,991 | 0 |
| Scripts and build | 4 → 22 | 90 → 4,070 | 4,006 | 26 |
| CI | 1 → 5 | 126 → 479 | 393 | 40 |
| Example plugins | 9 → 3 | 725 → 238 | 0 | 487 |
| Root config and the rest | 14 → 13 | 631 → 874 | 508 | 265 |
| Docs | 14 → 37 | 4,036 → 12,466 | 10,203 | 1,773 |
| **Total** | **131 → 485** | **21,240 → 108,659** | **101,664** | **14,247** |

By language, leaving out blank lines and lines that hold only a comment:

| Language | Files 2.0 → 3.0 | Code lines 2.0 → 3.0 |
|---|---|---|
| TypeScript | 56 → 308 | 10,700 → 52,412 |
| Rust | 16 → 63 | 1,485 → 18,215 |
| JavaScript | 10 → 26 | 691 → 6,353 |
| CSS | 1 → 1 | 90 → 804 |
| Swift | 0 → 1 | 0 → 184 |
| PowerShell | 0 → 1 | 0 → 171 |
| HTML | 3 → 2 | 301 → 134 |

How this is counted:

- Added and deleted lines come from `git diff -M`. Git recognises files that moved (2.0 kept the code at the repository root, 3.0 under `apps/getssh-client/`) and compares them with their old versions. A file less than half similar to its old version counts as deleted plus added.
- Left out:
  - `pnpm-lock.yaml` and `Cargo.lock`;
  - the vendored SQLite3MultipleCiphers source (`rust-core/getssh-store/vendor/`, 382,965 lines);
  - the `index.js` and `index.d.ts` that napi-rs generates;
  - binary files such as images and fonts.
- Without these filters git reports 581 files, 489,699 lines added and 16,937 deleted; the difference is mostly the vendored SQLite source.
- "Lines" above include blank lines and comments. Tests are files named `.test.` or `.spec.`, or under `tests/` or `e2e/`; Rust unit tests inside source files count with the Rust modules.

To count it yourself:

```bash
python3 scripts/code-stats.py v2.0.0_R7K4S v3.0.0-preview
```

### Full comparison

Every difference we could find, by area; open a section to see it. Things that did not change are listed too, to show what is still missing. "—" means that version did not have it.

<details>
<summary><b>Connections, terminal and file transfer</b> (37 items)</summary>

**What you will notice**

| Topic | 2.0 | 3.0 preview |
|---|---|---|
| SSH library and `~/.ssh` files | Node `ssh2` 1.17.0 in the main process, default algorithms; `~/.ssh/config` and `~/.ssh/known_hosts` are not read | Same: `ssh2` 1.17.0, default algorithms; `~/.ssh/config` and `~/.ssh/known_hosts` are still not read |
| SSH authentication | Password, or a key file on disk (once a key is set, no password fallback); no passphrase field; no SSH agent, keyboard-interactive or certificates | Password, a key stored in GETSSH, or a key file on disk, with a passphrase; still no SSH agent, keyboard-interactive or certificates |
| Host key confirmation | SHA256 fingerprints in `known_hosts.json`, keyed by host:port, not OpenSSH known_hosts; a prompt for new or changed keys, and a changed key needs a risk checkbox | Same file and prompt; new per-server Strict Host Key Checking (off by default) rejects a changed key without asking; prompts queue up (1 / N) |
| Host key prompt: timing and answers | Sent to the main window only; ssh2's 20 s handshake timeout kept running during the prompt, so a slow answer dropped the connection | Only the window that asked can answer, and the main process ignores any hostname or fingerprint sent back; the handshake timer pauses, and no answer in 5 min means reject |
| Connect timeouts | Only ssh2's default 20 s handshake timeout; a proxy that accepts and then hangs, or a server that never opens the shell, is never timed out | One 20 s timer covers proxy dialing, handshake and shell opening, each with its own error; the SOCKS dial times out at 20 s; Telnet stays at 10 s |
| Reconnect | Manual only: Enter reconnects, Esc closes the pane; the interface resent the connection config, password included | Still manual, same keys; the main process redials with the config it kept, so the interface sends no password; a dropped session is marked in every window showing it; no auto-reconnect |
| SOCKS5 / HTTP proxy | One global proxy: SOCKS5 (default 127.0.0.1:1080) or HTTP CONNECT; no proxy credentials or per-server proxy; the HTTP reply status was not checked, and bytes after the reply were dropped | Still one global proxy without credentials; an HTTP proxy must reply 200 (407, 403 and 502 give a clear error), and bytes after the reply go on to SSH |
| Jump hosts, forwarding, X11, serial | — | Same: no jump hosts, port or agent forwarding, X11 or serial; the store has a `proxyJump` column, but no form sets it and connecting ignores it |
| Commands after connecting | One Global Initialize Script (Settings → Secure Center), run only for auto-start servers after a confirm; manual connects skip it; nothing per server | Per-server Initial Directory and Post-Connect Script, typed into the shell after a confirm; the global script, now in Connections & Transfer, still runs only on auto-start; workspace Environment Hooks are saved but never run |
| Telnet | Port 23, 10 s connect timeout, terminal type vt100; bytes decoded as Latin-1, so UTF-8 text is garbled; split IAC sequences leak onto the screen; no NAWS or auto-login | Negotiation per RFC 854/1143, each option refused at most 3 times, so no answer loops; UTF-8 decoded across packets, split IAC sequences kept for the next one; still no NAWS or auto-login |
| Local terminal | node-pty 1.1.0; powershell.exe on Windows, elsewhere an allowlisted `$SHELL` or `/bin/bash`; secret-like variables (AWS_, GITHUB_ and others) removed; a Linux build | Same shell choice and variable filter; node-pty is patched so a program that stops reading input no longer pins a CPU core; macOS 13+ and Windows only, no Linux build |
| Terminal output | Output went to the main window only, with the first 800 ms held back; each packet was decoded alone, so UTF-8 characters split across packets became U+FFFD | The main process keeps up to 1,000,000 characters per session and sends them to every window; terminals catch up after remounting, switching workspace or moving windows; split UTF-8 is joined |
| Scrollback | Default 10,000 lines; the input has a 1000 minimum and no maximum, and negative or huge stored values went straight to xterm | Clamped to 1,000–100,000 lines (default 10,000); invalid values fall back to 10,000 |
| Fonts, themes and bell | Font presets Fira Code, Consolas, Menlo; 8 themes plus custom JSON import; bell None, Audible or Visual (default) | Same fonts and themes; per-server Session Theme Override; the visual bell flashes at most once per 200 ms, so `cat` of a binary no longer strobes; font size 8–48, line height 0.8–3 |
| Copy and right-click | Copy on Select (off by default); right-click is Paste (or Copy Selection), the Windows default, or Show Context Menu, the default elsewhere | Same options and defaults; new: the selection is passed to the AI as context, and double-clicking text in the terminal opens the AI Center |
| Search and links in the terminal | — | Same: no search in the terminal, and URLs are not clickable |
| Terminal recording | — | Record terminal output in Data & Logs, off by default: output of new SSH sessions only, no keystrokes; gzipped asciicast v2 (`.cast.gz`), unencrypted; Open folder only, no player |
| Recording limits | — | Local and Telnet sessions are not recorded, but their panes also show REC; header fixed at 80x24; beyond a 16 MiB or 10,240-frame queue, output is dropped and a note line marks the gap |
| SFTP panel | A bottom panel opened from the sidebar for the active SSH pane, starting at `/`; directory listings had no limit | An SFTP button on each SSH pane, also in torn-off windows; a listing stops at 10,000 entries, 8 MB of names or 20 s, with a notice |
| SFTP file operations | New file, new folder, delete (empty folders only), single-file download; uploads only by double-click to edit, then save to sync back; no drag-and-drop, rename, chmod or folder download | Same: the same operations, uploads still only by edit and sync back; no drag-and-drop, rename, chmod, recursive delete or folder download |
| Split panes | Nexus Core: up to 4 panes (enforced only by the interface), alternating directions, width and height ≥200 px to split; Zen Mode zooms one pane; layout not saved | Tidal Engine enforces 4 panes and alternating directions, with a toast on refusal; split right needs width ≥200 px, split down height ≥200 px; tab-bar Split button; Zen Mode kept; layout still not saved |
| Closing a pane | Closing one split pane only removed it from the layout; its SSH, Telnet or local session stayed connected until you quit | Closing or replacing a pane, or closing a torn-off window, disconnects its sessions in the main process |
| Separate windows | One window only; the pane's Tear Off (Native Window) button just moved the pane to a new tab in the same window | The pane's tear-off button, or dragging an all-terminal tab out, opens a native window; Attach to Main Window returns it to its split (if ≤4 panes in total), else as a new tab |
| Session tabs | A plain tab strip titled user@host; no home tab, no dragging or reordering | A permanent Home tab; tabs show the alias if set; tabs belong to their workspace and stay connected while hidden; Settings, AI and other pages open as tabs; still no reordering |
| Home screen and recent hosts | The welcome screen's Quick Access showed the last 4 of up to 10 recent hosts, or the first 4 saved ones | The Home tab has a Quick Connect field, Continue (back to this workspace's last tab) and the first 4 saved hosts; recent hosts are no longer shown or recorded |
| Command Center | Fuzzy search over quick actions, saved hosts and plugins; typing user@host offers Quick Connect; → or ⌘/Ctrl+K opens actions (Execute, Copy IP, Edit Profile, Delete Profile) | Also searches workspace runbooks, MCP prompts (`/name`) and resources (`@name`); an AI mode hands the text to AI; an empty query sorts by how often items were used |
| Runbooks | — | Per-workspace runbooks, stored encrypted and listed in the Command Center; running one types a single line into the active terminal without Enter; flagged high-risk ones need Touch ID / Windows Hello or a password first |
| Where runbooks come from | — | No in-app editor; runbooks only come from a `runbooks.json` left by 3.0 development builds, or are copied from another workspace with Asset Bridge |
| Server list | One flat list; search matches only username@host, not the alias; no folders or tags; Add saved an empty profile at once | Per workspace; nested folders, drag hosts into them, bulk move up to 500; search covers alias, host, username and folder path; new servers stay drafts until saved; still no tags |
| Workspace isolation rules | — | Only Disable SFTP File Transfers takes effect, also in the main process; Block Plaintext Protocols, Strict Host Key Checking and Prevent Data Export are saved but do nothing |

**Under the hood**

| Topic | 2.0 | 3.0 preview |
|---|---|---|
| Credentials during a session | The interface held every server's password; pane configs (also sent to Nexus Core) carried it, and every connect sent it from the interface | Saved servers connect by id; the main process reads secrets from the store and zeroes key and passphrase after the handshake; Tidal Engine and other windows get configs without them; only known windows may connect or write |
| Paste handling | Right-click paste read the clipboard in the interface and wrote it raw, with no bracketed-paste markers or ESC filtering | Both paste paths strip ESC, so pasted text cannot end bracketed paste early and run as commands; right-click paste runs in the main process, and the interface cannot read the clipboard; still no multi-line paste prompt |
| SFTP download checks | Saved to a chosen path or the default download path (under Downloads or Desktop); no cap on what gets written; in-app reads capped at 10 MB by stat | Regular files only, no devices or FIFOs; never writes over a symlink; size capped by stat (16 MiB if 0, 2 GiB if unknown); NUL or leading `..` paths refused; the 10 MB cap also applies while streaming |
| Edit and sync back | Double-click downloads a file (≤5 MB) to a private temp folder and shows it in Finder or Explorer; each save uploads after 500 ms; one sync per path | Same flow and limits; each open gets its own sync, nothing uploads after it stops, syncs end with the session, and names like `..` are refused |
| Terminal rendering | xterm.js 6.0.0 with the canvas renderer by default; WebGL only in High-Contrast Terminal mode | xterm's DOM renderer by default, WebGL still only in that mode; hidden terminals are not refitted, so servers no longer get bogus sizes like 10x6 |
| Connection history | `connection_history.json` keeps the last 500 records (alias, host, port, times, duration), paged in Audit Logs with JSON export; global, unencrypted | Same: same file and limit, now under Data & Logs; still global and unencrypted |
| 2.0's unused libssh2 pool | Nexus Core linked the Rust `ssh2` 0.9.4 crate (libssh2, vendored OpenSSL) with legacy algorithms such as group1-sha1, 3des-cbc and ssh-dss, but nothing called it | Removed; Tidal Engine contains no SSH code |

</details>

<details>
<summary><b>Data storage, keys and backups</b> (37 items)</summary>

**What you will notice**

| Topic | 2.0 | 3.0 preview |
|---|---|---|
| Where data is stored | One server list in Electron's userData folder: `profiles.enc` with a master password, `profiles.json` without; no database | `~/.getssh/`: `main.db` for app-wide data, one `workspace_<id>.db` per workspace, keys in `keyring.json`; directory 0700 and files 0600 on Unix |
| How data on disk is encrypted | The whole server list as JSON, encrypted with AES-256-GCM under a PBKDF2-SHA256 key (100,000 iterations) | Every database is encrypted in the SQLCipher 4 format (SQLite3 Multiple Ciphers 2.3.5), each with its own 32-byte key |
| Without a master password | The list goes to `profiles.json` in plain text, passwords included; “Disable Master Password Encryption” under SafeStorage Encryption turns it back to plain text | No plain-text mode: databases stay encrypted and a device key opens them without a prompt; copies do not open elsewhere, but anyone using this OS account can open them |
| Master password | Optional; 8 characters minimum only in the setup dialog, not when enabled or changed in Settings; PBKDF2-SHA256, 100,000 iterations; also saved to `profiles.key` via safeStorage, though the setup dialog says it is never saved | Optional, at least 12 characters after NFC (at most 1024 bytes); Argon2id (64 MiB, 3 passes) wraps a random app key and the password is not stored; one master password covers every workspace |
| Keys held by the OS | Electron safeStorage only; on macOS it ran on the mock keychain, whose key is a public constant, so anyone with `profiles.key` can open it; DPAPI on Windows | macOS: a Secure Enclave P-256 key, or the login Keychain on Intel Macs without one; Windows: an RSA-2048 TPM key, or DPAPI without a usable TPM; packaged builds no longer use the mock keychain |
| Touch ID / Windows Hello | macOS only; Touch ID is just a UI check, after which the master password goes to the interface in plain text; `profiles.key` opens without it | Unwrapping the key needs the user: a Secure Enclave key that asks for Touch ID or the Mac login password, or a Windows Hello signature; for the master password and own-password workspaces |
| Recovery code | — | 32 Crockford base32 characters (128 random bits plus a 32-bit checksum); only its P-256 public key is stored; it unlocks the app so a new master password can be set |
| What the recovery code opens | — | With a master password, all data; without one, not workspaces with their own password; setting a master password voids the old code and the app makes a new one at once |
| Wrong passwords | No limit beyond the PBKDF2 cost | The first 4 failures are free; then a wait from 1 s, doubling up to 30 s, on top of the Argon2 cost; the count lives in process memory |
| Auto-lock | An interface timer only (Off/5/15/30/60 min, default Off) counting activity in the window; locking leaves decrypted servers and passwords in memory; screen lock and sleep do not trigger it | In the main process: with a master password, 5 idle minutes, screen lock or sleep drops the keys and closes the databases; the interface timer also works; without one, only own-password workspaces lock |
| What the interface can see | Unlocking hands the whole server list, plain passwords included, to the interface, which also keeps the master password and puts passwords in the connect call | The interface gets only has-password / has-passphrase flags; at connect the main process takes the credentials by server id and wipes them; stored private keys never come back; the store answers only the main window's top frame, only while unlocked |
| Viewing a saved password | — (passwords were already in interface memory) | After Touch ID / Windows Hello or the password; the reveal window closes after 5 idle minutes; the secret shows in a system dialog, and a copied secret is cleared from the clipboard after 30 s if it is still there |
| Private key storage | Only the key file path is saved and the file goes to ssh2 as is; there is no passphrase field, so passphrase-protected keys cannot be used | Keys can be stored in the workspace database, key and passphrase sealed, up to 64 KiB each (Settings → Connections & Transfer); key files on disk still work (up to 1 MiB), passphrase saved encrypted |
| Importing private keys | — | OpenSSH, PEM (PKCS#1, SEC1, PKCS#8) and PuTTY `.ppk` v2/v3, encrypted ones included; Ed25519, RSA and ECDSA (P-256/P-384/P-521), no DSA |
| Generating keys | — | Generates Ed25519 keys, stored sealed; the public line can be copied into the server's `~/.ssh/authorized_keys`; a stored private key leaves only inside an encrypted backup |
| Importing a server's key file | — | “Import into GETSSH” in the connection settings switches every server in the workspace using that file; the original stays by default or goes to the Trash, unless 2.0's list exists, a workspace is locked or a server still reads it |
| Workspaces | — (one server list) | Several, each with its own encrypted database and key, locked separately; the main workspace cannot be deleted, but another can become main; deleting removes the database, key and folder; each database logs saves and imports in `audit_logs` |
| Workspace passwords | — | Workspaces other than the main one can have their own password (at least 8 characters, Argon2id), only while no master password is set; setting one replaces them |
| Encrypted backups | Only a `getssh-profiles-v1` JSON export: hosts and usernames in the clear, password and key path encrypted per field with the master password; not available without a master password | A `.getssh-backup` file: backup password of at least 12 characters, Argon2id (64 MiB, 3 passes), AES-256-GCM in 64 KiB chunks; reordered or truncated files do not open |
| What a backup contains | Servers only; no key contents, settings or host fingerprints | The chosen workspaces' databases (under their own keys), AI keys, plugin secrets, MCP tokens, `app-config.json` and `mcp_servers.json`; not host fingerprints, connection history, plugin data, recordings or key files on disk |
| Restoring a backup | Importing the JSON asks for the master password used at export and adds only servers whose `host::username` is new | Replaces the databases and keys, no merge: review its workspaces first; every database must pass an integrity check; the old `~/.getssh` is kept as `~/.getssh-backup-<time>`, and plugin data and other files the backup lacks are copied back; passwords keep working; then a restart |
| JSON host profiles | The `getssh-profiles-v1` export above, with encrypted credentials | Export is now a `getssh-profiles-v2` “Host profile template”: plain JSON without usernames, passwords or key paths; import still takes 2.0's v1 files, up to 8 MiB and 5,000 servers |
| Copying the data folder to another computer | `profiles.enc` opens anywhere with the master password; `profiles.key` is tied to the machine on Windows and opens anywhere on macOS | With a master password, a copy of `~/.getssh` plus the password opens anywhere; without one it does not, unless a recovery code exists; otherwise use an encrypted backup |
| Upgrading from 2.0 | — | On the first unlock, 2.0's servers go into the main workspace once, passwords sealed, duplicates skipped; 2.0's saved master password is used without asking when it works; 2.0's files are left as they are |
| 2.0's master password and other data | — | The 2.0 master password is not carried over, so 3.0 starts without one; plugin data is copied to the main workspace (up to 64 MiB each); init script and proxy settings move into the store and are lost on going back to 2.0 |
| AI keys, plugin secrets and MCP tokens | No AI or MCP; plugins had `safeStorageEncrypt` (mock keychain on macOS, the plain text returned if safeStorage was unavailable) | Sealed with the app key in `main.db`'s `app_secrets` table: AI service keys, plugin secrets, MCP environment variables and headers; `safeStorageEncrypt` is gone; they travel in backups |
| AI chats and local memory | — (no AI) | Chats sit in each workspace database (`ai_sessions`, `ai_messages`), covered by its encryption but not sealed again; local-memory vectors are computed on the device (384 dimensions, no network) and kept in `main.db` |
| What is still unencrypted | Everything but `profiles.enc` and safeStorage blobs: `profiles.json` without a master password, host fingerprints, connection history, ordinary settings, plugin data, key files; on macOS the safeStorage blobs, `profiles.key` included, are as good as plain | `keyring.json` (wrapped keys only, but it shows the workspaces and how each is protected), host fingerprints, connection history, interface settings, plugin data, recordings, key files read by path, 2.0's files |
| Platforms | macOS, Windows and Linux (AppImage), all on safeStorage | Packaged for macOS 13 or later and Windows only; `getssh-keystore` has no Linux backend, so a first run there cannot create its keys |

**Under the hood**

| Topic | 2.0 | 3.0 preview |
|---|---|---|
| Key hierarchy | — (the password-derived key encrypts the file directly) | The app and each workspace have a random 32-byte key, opened via the device key, Touch ID / Windows Hello, a password, the recovery code or, with a master password, the app key |
| `keyring.json` is untrusted | — | Whether a workspace has its own password is sealed under its key, so editing the file cannot loosen protection; Argon2 parameters are accepted only within 8–256 MiB, t 1–8, p 1–4 |
| Database keys and rekeying | — | Each database key is HKDF-SHA256 from its scope key, passed raw (32 bytes) through `sqlite3_key`, skipping SQLCipher's KDF; a closed database is rekeyed on a copy that must pass an integrity check and matching row counts, an open one in place |
| Field sealing inside the databases | — (whole-file encryption only) | Passwords, passphrases, private keys and app secrets are sealed again with AES-256-GCM (`gk1:` prefix), with AAD binding workspace and row, so moved values do not open; copied servers are re-sealed |
| Secrets in memory | The Rust module zeroizes its own buffers, but the decrypted list becomes plain JS objects in the interface and the master password a JS string there | Keys that open other keys stay in Rust (`Zeroizing`); the main process gets credentials as Buffers and wipes them after use; the interface never gets them |
| Key import: conversion and limits | — | PKCS#8 and `.ppk` are converted in the main process to a form ssh2 reads, then sealed; others are kept as they are; the public half is checked; limits: 256 bcrypt rounds, 1,000,000 PBKDF2 iterations, 256 MiB Argon2 |
| Where settings are kept | Ordinary settings in localStorage as plain JSON; init script and proxy as a safeStorage blob (mock keychain on macOS, plain base64 where unavailable) | Ordinary settings still plain in localStorage; init script and proxy address are sealed with the app key in `main.db` and reach the window only after unlock; AI endpoint, provider and model are kept in both places, in clear in localStorage |
| Plugin storage | One plain SQLite file per plugin, `plugin_data/<id>.db`; 5 MiB quota, or 500 MiB / unlimited with a storage permission | Per workspace, in `~/.getssh/workspaces/<id>/plugins/`; still plain SQLite with the same quotas; plugin password settings move into the store when read |

</details>

<details>
<summary><b>AI</b> (47 items)</summary>

**What you will notice**

| Topic | 2.0 | 3.0 preview |
|---|---|---|
| AI troubleshooting | — (no AI features) | Troubleshooting with your own model key; set up in Settings → AI & Integrations: Providers, Default model, Web search, MCP servers |
| AI Center pane | — | Opened from the AI button in the status bar; tabs Chat, History, Prompts, Agent mode; you pick the Target terminal, otherwise AI reads no terminal |
| Floating AI panel | — | Opens on a double-click in a terminal that leaves a selection; draggable, 560 × 620 px, Chat and History, targets the active terminal; labels are always Chinese |
| AI in the Command Center | — (the Command Center was a fuzzy search over actions, hosts and plugins) | The AI toggle switches to AI dispatch and Enter sends; no terminal, saved hosts' alias and address attached; agent modes can open servers but not run terminal commands |
| Enable AI switch | — | On by default; off only blocks sending in the floating panel and AI Center; Command Center AI and the main process ignore it |
| Built-in personas | — | Four built-in personas (Linux, log analysis, Docker, security review) plus your own; the active one replaces the identity line of the system prompt |
| Input bar | — | Floating panel only: pick the model (fuzzy search or a typed ID), reasoning effort and mode, toggle web search, insert the selection as a stderr code block. The AI Center pane has only the search toggle and a plain insert |
| Code blocks to the terminal | — | Code blocks with a language tag in AI Center and floating-panel replies have a send button: it types the code into the target terminal, newlines as spaces, without pressing Enter |
| Model services | — | OpenAI, Gemini, Claude, DeepSeek, Zhipu GLM, Kimi, MiniMax, Alibaba Qwen, Ollama (local), custom endpoint; default Gemini `gemini-3.7-flash`; sent directly, no GETSSH relay |
| Endpoint URL | — | Only Ollama, Custom endpoint, MiniMax (`api.minimax.cn` for mainland accounts) and Qwen (other regions or workspaces) have one; Zhipu and Kimi are fixed to `open.bigmodel.cn` and `api.moonshot.cn` |
| Custom endpoint | — | No adapter of its own: it calls `<endpoint>/responses` (OpenAI Responses API), so a server that only offers Chat Completions will not work |
| Ollama local models | — | Default `http://127.0.0.1:11434`, no key; output capped at 8,192 tokens, no thinking settings; models come from `/api/tags`, which errors if Ollama is not running |
| Model list | — | Fetched live with the stored key (10 s timeout), built-in list on failure; embedding, speech, image and similar models filtered out; any model ID can be typed |
| Reasoning effort | — | Six levels: Off, Low, Medium (default), High, Extra high, Maximum; Settings hides the last two for Gemini; Off disables thinking only where the model allows; thinking shows in a collapsible block |
| Context limit | — | Slider 4K–2M tokens, default 200K; it only trims terminal content to the last limit × 3 characters (600,000 by default) and is not sent as an output limit |
| Four modes | — | Read-only (default) and Context assistant give one reply without tools, Context assistant adds the target terminal; Approval required and Automatic execution run the agent with tools |
| Agent tools | — | `execute_terminal` (with a target terminal), `open_session` (without one), `get_environment_info`, `search_web` (when search is on), plus connected MCP servers' tools; at most 15 turns per run |
| How the agent runs a command | — | Types the command into the target terminal and waits for 800 ms of quiet (15 s max); at a password, [sudo] or yes/no prompt you answer in the terminal (60 s more); the model gets the last 2,000 characters, plus what follows the prompt |
| Command approval | — | In Approval required, each `execute_terminal` command waits on a card; no answer in 5 min, a workspace switch or a lock counts as rejection; after a rejection the model tries another way |
| High-risk warning | — | Commands with `rm -rf`, `chmod 777`, `mkfs`, `dd if=`, curl/wget piped to sh, or writes to /dev/sdX turn the card red and lock approval for 3 s |
| Not asked in Approval required | — | `open_session`, `search_web`, `get_environment_info` and MCP tools run without asking; the prompt tells the model that opening servers needs approval, but nothing asks |
| Agent opening servers | — | Fuzzy-matches a saved server by alias or address and connects; an attached command starts a new request, so Approval required still asks; 8 opens per window per 10 min, 3 with a command |
| Destructive-command block | Only plugin writes to a terminal were checked: `rm -rf /`, `rm -rf /*`, `mkfs`, the fork bomb, `dd` onto /dev/sda and the like, with a yellow lockdown on a match | Same five rules, now matched in linear time, plus a 64 KB command limit; the AI agent's commands pass the same check, in Automatic execution too, with the same yellow lockdown |
| Stop and usage | — | No Stop button: a reply or agent run cannot be cancelled and ends only on finishing (15 turns max), timeout or error; token usage is not shown |
| Earlier turns | — | Each message is sent alone, without the chat's earlier turns; only a single agent run keeps its own tool-call history |
| What a request carries | — | The system prompt holds persona, workspace and target host, mode text, tool and runbook lists, memory excerpts and the target terminal's full scrollback (not in Read-only); the Command Center sends the host list even in Read-only |
| Local memory: index | — | Each chat message becomes a 384-dimension feature-hashing vector on this computer, with no model or network; stored in `main.db` (SQLCipher 4), deleted with its chat |
| Local memory: what is sent | — | In all four modes, up to 6 most similar past messages (4,800 characters in all) go to the model service with the prompt, after placeholder replacement; the current chat is not excluded |
| Replacement: what is recognised | — | IPv4 addresses (except 127.0.0.1 and 0.0.0.0), AWS access keys (AKIA…), PEM private keys, `Authorization: Bearer/Basic` values, values of 4+ characters after keys like `password`, `secret`, `token`, `api_key` |
| Replacement: what is missed | — | IPv6, hostnames and domains, usernames, e-mail addresses, tokens with no key name; the native module also misses JWTs |
| One egress | — | Every model request, Ollama and MCP sampling included, leaves through one gateway that replaces values in prompt, terminal text, system prompt, history, tool results and arguments; on an error it refuses to send |
| Placeholders | — | Format `[GETSSH_<32-hex nonce>_<TYPE>_<n>]`, one placeholder per value; the mapping lives only in memory for that request; replies get real values back before display and execution |
| Check before restoring values | — | `tree-sitter-bash` checks the command keeps its shape; with second-order evaluators (eval, ssh, sh -c, sudo -s…) and in streamed chat text, only values without spaces, quotes or shell symbols return; other placeholders reach the terminal as they are |
| Without the native module | — | A JS fallback writes fixed `[REDACTED_*]` tokens that cannot be restored, so the agent cannot use those values; it also catches JWTs and bare Bearer tokens |
| Replacement status page | — | Settings → Ocean Sentinel → Runtime details shows Native redaction, JS redaction fallback or Sanitization failed, with hits for this run, today and in total; only the counts are stored |
| Web search | — | Only in Approval required and Automatic execution; on by default, runs without approval; turn it off in the input bar or Web search settings; queries keep placeholders, but a call the model writes as &lt;ACTION&gt; text (Ollama's format) may carry real values |
| Search providers | — | Default Hybrid (automatic fallback): public SearXNG (list from searx.space), then DuckDuckGo and Bing web pages; or DuckDuckGo or Bing alone, Google Custom Search, or SearXNG (address optional); up to 10 results |
| Google search key | — | The API key and Search Engine ID sit unencrypted in interface settings (`localStorage`), not the encrypted store; the key is sent in the request URL |
| MCP tools | — | Connected MCP servers' tools (up to 128 each) are offered in both agent modes without approval; arguments get real values back, remote HTTP servers included; output capped at 200,000 characters |
| Chat history | — | Kept per workspace in its SQLCipher database, replies as shown with real values, thinking and command output; the list shows up to 2,000 chats, 200 per page; delete one or Clear all history |
| Model keys | — | One per provider in the `app_secrets` table of `main.db` (SQLCipher 4 plus AES-256-GCM); read only in the main process, saved keys are never shown; Ollama needs none |
| AI data in encrypted backups | — | A `.getssh-backup` carries the model keys and the chosen workspaces' chat history and memory vectors |

**Under the hood**

| Topic | 2.0 | 3.0 preview |
|---|---|---|
| Provider APIs | — | No vendor SDKs: OpenAI Responses, Claude Messages, Gemini Interactions (key only in a header), Chat Completions for DeepSeek, Zhipu and Kimi, MiniMax's Anthropic-compatible API, Qwen's native DashScope protocol |
| Per-model parameters | — | A capability table by provider and model decides the thinking, sampling and `tool_choice` fields; unknown models get only required fields; a 400/422 rejection drops that field and retries once, forgotten on restart |
| Retries, timeouts, concurrency | — | Up to 3 retries at 1/2/4 s plus up to 0.5 s, for 429, 5xx and network errors, never for exhausted quota or after text has streamed; timeouts 300–900 s; 4–50 concurrent per provider, Ollama unlimited |
| Provider-side data | — | OpenAI and Gemini requests send `store:false`; no user or session ID is sent; no provider-side web search is turned on, all search goes through GETSSH's own |
| IPC origin checks | — | AI requests are accepted only from the main window's top-level frame; keys come only from the store, never the renderer; approvals only from the requesting window with that request's random UUID |

</details>

<details>
<summary><b>Plugins, MCP and process confinement</b> (48 items)</summary>

**What you will notice**

| Topic | 2.0 | 3.0 preview |
|---|---|---|
| Plugin mode names and location | Settings → General → Plugin Security Sandbox: Safe (No Plugins), Strict (Max Sandbox), Normal (Default), Developer (No Sandbox) | Settings → Ocean Sentinel → Backend Plugin Execution: Safe (Backend Plugins Disabled), Isolated (Strict Compatibility), Isolated (Normal Compatibility), Developer (Fully Trusted Code) |
| Where Strict / Normal plugins run | In the GETSSH main process via Node `vm` (not a security boundary); Strict allows `require` of path and os only, Normal blocks fs, child_process and net | The two Isolated modes behave the same: one child process per plugin, Seatbelt on macOS, AppContainer on Windows; refused on Linux or without the sandbox tool |
| What a plugin process can reach | The same process as GETSSH; only a `require` list blocks modules, and Normal still allows http and https for direct network access | Reads only its own folder (plus system files on macOS) and writes only a temp dir; no direct network access or child processes |
| Developer mode | Plain `require()` in the main process, with the same rights as GETSSH; a warning before switching | Same: plain `require()` in the main process with the same rights as GETSSH; confirmed before switching and listed under Needs attention in Ocean Sentinel |
| Safe mode | Only `--safe-mode` skips backend plugins at launch (a saved Safe mode does not); saving a plugin's settings calls `reloadPlugin()`, which still runs its code in `vm`; UI-only plugins load | Backend plugin code never runs, reloads included; UI-only plugins still load |
| Default mode and load timing | Default Normal; plugins load at launch before unlock, always under Normal rules, so a saved Safe or Strict mode is ignored (except with `--safe-mode`) | Default Safe, also when the main process has no mode yet; plugins load only after the first unlock |
| Changing the plugin mode | Only switching to Safe or Developer asks for Touch ID or the master password, and only if one is set; Safe needs a restart, other modes hot-reload | Any switch to a non-Safe mode is verified in the main process (Touch ID / Windows Hello, else a password) unless no password is set; main window only; plugins reload at once |
| Declarable capabilities | `lifecycle`, `storage:extended`, `storage:unlimited`, `ssh:read`, `ssh:write`, `host:clipboard`, `net:fetch`; no file permission; dialogs and notifications need none | Same: the same set; still no file permission, and paths from `showOpenDialog` are unreadable to the plugin; dialogs and notifications need none |
| Writing to terminals (`ssh:write`) | Writes at once without asking; only regexes for `rm -rf /`, `mkfs`, a fork bomb and `dd` to a disk, which trigger a yellow lockdown | Asks first: Deny / Allow Once / Allow This Run (Always Allow in Developer mode), showing the first 200 chars (50 in Developer mode); over 64 KiB refused; same pattern checks |
| Clipboard (`host:clipboard`) | Reads and writes the system clipboard; each read shows a clipboard warning notification | Same, still with the notice on read; while a secret GETSSH copied is on the clipboard, the plugin reads an empty string; writes ≤1 MiB |
| Plugin network requests (`net:fetch`) | Checks only the first DNS answer against a short private list; the request resolves again and follows redirects unchecked; no size or time limit | Every resolved address must be public, and the request connects to the checked IP; ≤5 redirects, each re-checked; responses ≤1 MiB, 30 s per hop |
| Plugin dialogs and notifications | Message boxes and file dialogs open over the focused window, any number; notifications have no length limit | One dialog per plugin at a time, only over a visible, non-minimised GETSSH window; notification title ≤256 chars, body ≤4096 |
| Plugin secrets | Only `safeStorageEncrypt`: it encrypts but cannot decrypt, and returns plaintext as is when OS encryption is unavailable | `context.secrets` instead: encrypted in getssh-store as `plugin/<name>`, shared by workspaces, included in backups; ≤64 entries, 1 MiB per plugin; fails while locked, removed on uninstall |
| Password-type plugin settings | Plain text in the plugin's storage file like any other setting; the settings window reads the value back | Encrypted per workspace in `plugin/<name>`; the form only learns which are saved, never the value; plain values left from 2.0 move in when read |
| Plugin storage | One unencrypted SQLite file per plugin in `userData/plugin_data/`; every plugin got 5 MiB, whatever storage it declared | One set per workspace in `~/.getssh/workspaces/<id>/plugins/`, still unencrypted; quotas follow the declaration: 5 MiB, 500 MiB or unlimited |
| Importing 2.0 plugin data | — | Once, at first unlock: copies 2.0 `.db` files (with `-wal`) into the main workspace, skipping existing ones, ≤64 MiB each; 2.0 files untouched |
| Install and uninstall | Drop a .zip in Settings → Plugins; after uninstall a restart clears the UI, and plugin storage stays | In Plugin Center, Install local ZIP or drop a file; uninstall stops the process, then deletes the folder and the plugin's secrets; storage stays |
| Plugin marketplace | None; local ZIP only | Same: none; local ZIP only |
| Permission review at install | Lists only storage, `ssh:write`, `ssh:read`, `lifecycle` and `host:clipboard`, never `net:fetch`; the plugin name is rendered as HTML | Plugin Permission Review lists every declared capability; unknown ones, `net:fetch` included, read “Unrecognized capability; verify the source.”; notes the mode decides whether backend code runs |
| Backend plugin API | `ssh.write` is synchronous and `ssh.onData` cannot unsubscribe; `ctx.net` always exists and checks the capability on call | `safeStorageEncrypt` removed, `secrets` added; `ssh.write` is async and `onData` returns an unsubscribe; in Isolated modes `ctx.net` exists only with `net:fetch`, no AbortSignal |
| Backend plugin requirements | Declare `lifecycle`; the main file must contain a non-empty `deactivate` (a text check); `registerSettings()` with at least 1 field | Declare `lifecycle`; export `activate()` and `deactivate()`; `registerSettings()` with 1-256 fields; activate within 8 s; no text check |
| Plugin SDK docs | Built around the `vm` sandbox with Strict / Normal module tables; says UI plugins are “fully prohibited” from the network, which no code enforces | Rewritten as the “GETSSH 3.0 Plugin SDK Guide” (EN and CN): a mode table saying Strict equals Normal, plus capability, limits and migration tables |
| MCP client | — | Managed in Settings → AI & Integrations → MCP servers, Stdio or HTTP / SSE; discovers tools, resources and prompts; independent of the plugin mode; first run adds a disabled “MCP Official Documentation” entry |
| MCP config and tokens | — | Config in `~/.getssh/mcp_servers.json` (0600); env and headers cannot be entered in the UI, and once written there GETSSH moves them into the encrypted `mcp/<id>`, dropped if the command or URL changes outside GETSSH |
| What a local MCP server can reach | — | No user files or network by default; you can add Additional read paths, Read & write paths and Allow network access; credential dirs such as `~/.ssh`, `~/.aws`, `~/.getssh` are always denied; child processes allowed |
| HTTP MCP servers | — | Not sandboxed or address-filtered: the main process calls the URL you enter; one JSON POST per call, no SSE stream parsing or `Mcp-Session-Id`; redirects followed within the same site only |
| MCP tools in the AI | — | Tools are registered for the AI as `mcp_<server>_<tool>_<hash>` and run without per-call approval, even in Approval required; prompts and resources show in Command Center as `/name` and `@name` |
| Reverse AI sampling | — | A per-server toggle (Allow reverse AI sampling), off by default; when on, ≤10 per minute with no per-request prompt; always Gemini `gemini-2.5-flash` with the stored Gemini key, whatever provider you chose |
| GETSSH native MCP server | — | The MCP page copies Claude Desktop and Cursor configs that run `getssh --mcp-server`, but nothing handles that flag; the server code returns canned text |
| Watchdog freeze handling | 5 s without a heartbeat starts a freeze lockdown, then kill and safe-mode relaunch after 60 s; the countdown stalls while messages arrive and recovery does not end it; English-only macOS dialog | Deadline-based: freeze after 5 s without a heartbeat, kill after 60 s and relaunch in safe mode (no relaunch in dev builds); recovery ends the freeze and closes the dialog; dialog in Chinese or English |
| Watchdog under `--safe-mode` | The Watchdog still starts but gets no heartbeat, so GETSSH is killed and relaunched about every 65 s | No Watchdog is started |
| Lockdown actions | Any top-level frame could send actions; the main process checked no identity, and `ignore` turned off the Watchdog for the session | Known windows only; a red lockdown cannot be ended with `continue` or `deactivate-plugin`; `ignore` works only during a lockdown and needs Touch ID or a password, unless none is set |

**Under the hood**

| Topic | 2.0 | 3.0 preview |
|---|---|---|
| macOS plugin sandbox rules | — | `sandbox-exec` on an allow-default base: denies home, userData, temp dirs and /Volumes except the plugin dir, app bundle and temp HOME; no network, pasteboard or Keychain services; only Electron may run |
| Windows plugin sandbox | — | Started by `getssh-sandbox.exe` in a fresh AppContainer with no capabilities (so no network), with read on the plugin dir and read/write on the temp HOME; a Job Object allows 1 process, no children, limited UI; ends when GETSSH exits |
| Plugin process environment and Node permissions | Ran inside GETSSH, with its environment and file access | Inherits only a few variables such as PATH, LANG and TZ; HOME and TMPDIR point to a fresh temp dir (0700, removed after exit); Node runs with `--permission`, writing only there |
| Plugin-to-host protocol | No protocol: the plugin called main-process objects directly | Line-delimited JSON over the child's stdin/stdout with a fixed method list; invalid UTF-8, cycles and nesting over 24 rejected; console output goes to stderr so it cannot forge frames; any violation kills the plugin |
| Protocol limits and timeouts | No limits on call size, rate or time | Messages ≤2 MiB; timeouts of 8 s for activation and 15 s for RPC and host calls; ≤250 host calls/s, 32 at once; ≤500 inbound messages and 16 MiB per second; ≤64 SSH subscriptions, delivery errors never break the session |
| Addresses `net:fetch` blocks | Blocks the names localhost, 127.0.0.1 and 0.0.0.0 plus 10/8, 172.16/12, 192.168/16, 169.254/16, 127/8 and ::1; no IPv6 private, CGNAT or NAT64 checks | Queries DNS directly (not /etc/hosts); blocks IPv4 private, loopback, link-local, CGNAT, documentation, multicast and reserved ranges, IPv6 loopback, ULA, link-local, multicast, 6to4 and documentation, and IPv4 in mapped and NAT64 forms |
| Stopping plugins | Shutdown, reload, lockdowns and network violations all call the plugin's own `deactivate()` in the main process | Reload, uninstall and mode switches run `deactivate()` in the sandbox and kill on timeout; quitting, lockdowns and network violations kill the process and revoke its hooks without running plugin code; MCP servers stop on quit |
| Plugin identity and path checks | Identity is `manifest.name`; paths checked only with `path.resolve` and a prefix test; the folder name is not compared | The name must match `[A-Za-z0-9._:-]{1,128}` (no @ or /) and equal the folder name; the entry file's realpath must stay inside the plugin folder |
| ZIP extraction and install preview | zip 2.4.2: blocks Zip Slip, but no entry or size limits, and link entries are written as plain files; the renderer sends the source dir back; failed previews leave temp dirs | zip 9.0.5: ≤50,000 entries and 512 MiB expanded; symlinks rejected, writes only into an empty real dir; the main process keeps the source dir; failed previews are deleted |
| Plugin pages (iframes) | `getssh-plugin://` pages in a `sandbox=allow-scripts` iframe, no CSP; plugins identified by the ID they claim, so one could take another's panel; no panel, action or RPC limits | The page can go online directly, whatever the plugin declares; Same iframe, still no CSP (from 3.0.0-preview.2 every response carries a CSP: a page loads only its own plugin's files and cannot go online directly); HTML ≤4 MiB; plugin identified by the sending iframe; ≤16 panels, ≤8 sidebar actions, RPC ≤32 in flight, 100/s, 256 KiB |
| Local MCP server sandbox | — | macOS: `sandbox-exec` with rules like the plugins', but child programs such as npx may run; Windows: the same AppContainer launcher, network capabilities only when allowed, ≤64 processes, no .bat/.cmd; refused elsewhere |
| Local MCP launch environment | — | Inherits only PATH, USER, LANG and a few more; refuses `NODE_OPTIONS`, `LD_PRELOAD`, `DYLD_*` and similar; HOME, TMP and XDG_* point to a fresh temp dir; ≤64 read and 64 write paths, absolute and existing |
| MCP protocol limits | — | Protocol 2024-11-05; messages ≤8 MiB, ≤64 requests in flight; more than 500 messages or 32 MiB per second disconnects; ≤128 tools per server; `tools/call` times out at 60 s; output cut at 200,000 chars |
| Unfinished MCP parts | — | The stdio handshake advertises `roots`, yet `roots/list` always gets -32601; the sampling “RASP check” calls a non-existent `SecureCenter.checkSecurityRisk`, so it does nothing |
| Watchdog binary and platforms | Separate `rust-core/watchdog` for Linux, macOS and Windows; on Linux and Windows it compares the first 8 bytes of `connect` and `open` every 5 s; a closed socket looks like a freeze: about 65 s later it kills the PID and relaunches GETSSH in safe mode | The `watchdog` binary of `ocean-sentinel`, macOS and Windows only; the hook check runs on Windows only; when the socket closes it exits without killing anything |
| Tests and CI | No plugin, sandbox, storage or Watchdog tests; only manual test plugins | Unit tests for isolation, the network gateway and the MCP sandbox, plus a real-sandbox smoke test; `security-sandbox.yml` runs on macos-15 arm64 and windows-2022 x64; old test plugins removed |

</details>

<details>
<summary><b>Systems, installers, interface and engineering</b> (31 items)</summary>

**What you will notice**

| Topic | 2.0 | 3.0 preview |
|---|---|---|
| Supported systems | macOS, Windows and Linux, each for x64 and ARM64; no minimum macOS version set | Linux dropped: macOS 13 or later and Windows, each for x64 and ARM64; on any other system the app exits at launch |
| Installers and checksums | DMG, an NSIS installer (choosable folder, installs for all users) and a Linux AppImage; NSIS CRC check off; no checksums | Exactly four: DMGs for Intel and Apple Silicon, `GETSSH-Setup-*.exe` for x64 and ARM64, plus `SHA256SUMS.txt`; installer settings unchanged, CRC check still off |
| Code signing and notarization | macOS not signed at all (`mac.identity: null`), not notarized; Windows not signed | Ad-hoc signature on macOS, still no Apple Developer ID or notarization; Windows still unsigned |
| macOS Keychain | Release builds ran with `--use-mock-keychain`: safeStorage skipped the real Keychain and derived its keys from a public constant | safeStorage keys live in the real Keychain; without a Developer ID, macOS asks for Keychain access again after each update |
| Automatic update check | At launch and every 12 h, notify only; macOS asks the GitHub API, Windows and Linux use electron-updater, but releases carry no `latest.yml` | Same: at launch and every 12 h, notify only; releases still carry no `latest.yml`, so Windows background checks find nothing (from 3.0.0-preview.2 Windows asks the GitHub API too, as macOS does) |
| Manual update check | Check for Updates in Settings → About asks the GitHub API on every system | Same: still the GitHub API, so it finds new versions on Windows too |
| Version comparison | Compares x.y.z only and ignores pre-release labels | Ignores a leading `v` and `_build` labels; a pre-release sorts before its release (`3.0.0-preview` &lt; `3.0.0`) |
| Analytics and telemetry | No analytics, crash reporting or telemetry | Same: no analytics, crash reporting or telemetry |
| When the app goes online | Only the update check goes online by itself; the rest is your doing: SSH hosts and proxies, the About links | New: the model service you configure, when you use AI; AI web search (on by default) to SearXNG, DuckDuckGo, Bing or Google; backend plugins reach public addresses only through GETSSH; plugin pages can go online directly (not from 3.0.0-preview.2) |
| Layout | Sidebar, tab bar, split panes and an empty page; Settings is a floating modal | Adds a workspace rail, a status bar and a Home page; Settings, AI Center, Plugin Center and Workspace Center open as panes, each failing on its own |
| App windows | One window, 1024×768, resizable; system title bar on Windows and Linux; "Tear Off (Native Window)" only opened a new tab | Main window fills the screen's work area, not resizable but can go full screen; frameless on Windows with system caption buttons; torn-off sessions get real, resizable windows |
| Settings tabs | 8 tabs in a floating modal: Appearance, Terminal, Network & SSH, General, Secure Center, Audit Logs, Plugins, About GETSSH | 8 tabs in a pane, in 3 groups: General, Appearance, Terminal, Connections & Transfer, AI & Integrations, Ocean Sentinel, Data & Logs, About |
| Where settings live | Terminal theme and High-Contrast Terminal under Appearance; plugins and profile export/import inside Settings | Terminal theme and High-Contrast Terminal moved to Terminal; plugins in Plugin Center, export and isolation rules in Workspace Center |
| Themes and accent colors | Follow system, light or dark; 4 accent presets plus custom, Cyber Purple by default | Same themes; 5 single accents (adds `#176f60`) plus custom; new Duo-Tone pairs (5 presets), with Neon Blue & Mecha Gray as the default |
| Glass and window material | Glass only in dark mode, opacity 30–100%; vibrancy on macOS, opaque on Windows and Linux | Glass in light and dark, off when the OS reduces transparency, opacity 25–100%; Mica on Windows 11, Acrylic from Windows 10 1809 |
| Terminal color themes | Default plus Dracula, Nord, Gruvbox, Tokyo Night, Catppuccin, Monokai and Solarized; import from `.json`, delete | Same: the same 7, with import and delete |
| Interface languages | English and Simplified Chinese, English by default; the selector is under Appearance | The same two, English by default; selector moved to General; English lacks 132 strings, so about 16 places show Chinese and 3 sidebar tooltips show raw keys |
| Keyboard shortcuts | Command Center on ⌥/Alt + Space, Ctrl + Space and ⌘/Ctrl + K, even inside a terminal, taking Ctrl + K and Ctrl + Space from the shell | Adds Ctrl + Shift + K; inside a terminal, Ctrl + K and Ctrl + Space go to the shell; the global show/hide hotkey is still Control + backtick |
| Accessibility | 8 lines with aria attributes in the whole UI; no dialog semantics or focus styles; ignores reduced motion and transparency | About 165 aria lines, `role="dialog"` on modals, focus traps in several, `role="switch"` toggles; honours reduced motion and transparency; still ignores the OS high-contrast mode |
| About page | Version hardcoded as `2.0.0-R7K4S`; platform could read Linux; 3 legal links: Terms of Service, Privacy Policy, Third-Party Licenses | Heading and version read from `package.json`: "GETSSH 3.0 Preview", "FUSION · Preview Program"; platform macOS or Windows; adds a Font License (MiSans) link |
| Third-party notices | — (packaging even stripped the dependencies' LICENSE files) | Packaging writes `THIRD_PARTY_NOTICES.txt` for bundled JS, `app.asar` packages, Rust crates and fonts, failing if any is missing; macOS adds the Electron and Chromium licenses |

**Under the hood**

| Topic | 2.0 | 3.0 preview |
|---|---|---|
| Electron and frontend toolchain | Electron 42.3.0 (`^42.3.0`), React 19.2.6, Vite 8.0.14, TypeScript 6.0.3; the app sits at the repo root | Electron 44.5.1 (exact pin; 44.10.0 from 3.0.0-preview.2), React 19.3.0, Vite 8.3.3, TypeScript 7.0.2; the app moved to `apps/getssh-client`, pnpm pinned to 11.2.2 |
| npm packages in the installer | Six: electron-updater, framer-motion, fuse.js, immer, node-pty, ssh2 | Only electron-updater, node-pty and ssh2, the rest bundled by Vite; node-pty patched so EAGAIN retries back off (up to 250 ms); js-yaml and 3 others pinned for advisories |
| Rust native modules | Six N-API modules; `nexus-core` pulled in the ssh2 crate with vendored OpenSSL | Nine: `tidal-engine` replaces `nexus-core` without OpenSSL; new `getssh-store`, `ocean-sentinel` and `audit-stream` |
| Renderer clipboard reads | Not restricted; Electron's default allows it | The main process denies the renderer the `clipboard-read` permission |
| Renderer CSP | `connect-src` allows only localhost and `api.github.com` | `connect-src` also allows the OpenAI, Gemini, Anthropic and Azure OpenAI hosts |
| Release workflow | Six jobs, both Mac architectures built on macos-latest; plain `pnpm install`; no type check or tests; write access for the whole workflow | Four jobs, each on a runner of its own architecture; `--frozen-lockfile` and `tsc -b`; only the final release job can write, creating one draft with `SHA256SUMS.txt` |
| Installer checks | — | `check-package.cjs` checks `app.asar` contents and every native file's architecture; the packaged app then starts once in an isolated home and tests PTY, an ssh2 handshake, Rust modules and the store |
| Security test CI | — (only `release.yml`) | `security-sandbox.yml` on PRs and pushes, on macOS arm64 and Windows x64: plugin and MCP confinement, the network gateway, Sentinel, keystore end to end |
| Dependency audits | — | `pnpm audit` and `cargo audit` weekly, on pushes and on PRs; OpenSSF Scorecard; Dependabot for cargo and GitHub Actions only, not npm |
| Automated tests | — (a `test` script, but no test files) | Vitest: 91 test files, 1,317 tests; Rust: 289 tests; the store adds 50 tests and a 293-step conformance check; CI runs the security tests and the package checks |

</details>

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
