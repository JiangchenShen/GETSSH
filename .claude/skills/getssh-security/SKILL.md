---
name: getssh-security
description: Protect GETSSH security boundaries when changing backend plugins, MCP, Agent tools, Sentinel redaction/rehydration, SSH/SFTP IPC, or encrypted database code.
---

# GETSSH security boundaries

Read `/Users/shenjiangchen/Desktop/GETSSH-安全审计/GETSSH-AI与插件系统-安全审计与整改方案.md` before changing security-sensitive code. Its `§0.1` overrides conflicting older sections. Recheck source locations with `rg`; recorded line numbers drift.

## Non-negotiable boundaries

- Do not treat names such as `safe`, `sandbox`, `isolated`, or `encrypted` as evidence. Reproduce the current behavior before changing it.
- Node `vm` and `vm2` are not boundaries for adversarial code. Never pass host objects such as `Buffer`, timers, promises, Electron objects, or function references to untrusted code.
- Plugin and MCP boundaries carry structured messages only. The main process binds plugin identity and declared capabilities; the child cannot choose either.
- Any code that exposes decrypted memory to untrusted code, or sends plaintext outside the encrypted/privacy boundary, is P0.
- Check every entry point. GETSSH often has parallel startup, reload, IPC, and bridge paths.
- Keep cloud privacy sanitization at the final egress boundary. `AgentEngine` uses `streamTurnLLM`, and `LlmGateway` sanitizes nested `tool_result` blocks before adapters receive them; do not add a competing MCP-only sanitizer.
- Irreversible redaction may only cover values that must never be restored. Values the model may quote must use reversible Sentinel placeholders.
- AST validation covers syntactic command text, not arbitrary terminal output.

## Chosen plugin route

`isolated-vm` 7.0.1 does not build against Electron 42 / V8 14.8 because `v8::External` now requires `ExternalPointerTypeTag`; upstream and active forks had no fix when checked on 2026-09-07. The implemented route is therefore one OS-confined process per backend plugin with bounded newline-delimited JSON over stdin/stdout. Electron's own executable runs in Node mode behind macOS Seatbelt or the bundled Windows AppContainer launcher. Missing isolation backends fail closed.

Electron `utilityProcess` was an intermediate memory-isolation step, not the final malicious-code boundary: it retains the same user's filesystem, network, and process rights. Do not regress `PluginProcessHost` to a bare `utilityProcess.fork()` or bare `spawn()`. Node's permission model is defense in depth only; Seatbelt/AppContainer is authoritative.

All production backend plugin modes must use `PluginProcessSandbox`. `safe` loads no backend plugin. The direct-main-process `developer` path is explicit, authenticated, and described as fully trusted code.

## Implemented baseline (2026-09-10)

1. `normal` and `strict` backend plugins run one per OS-confined process through `PluginProcessSandbox`; `safe` executes no backend plugin, including reload paths. macOS Seatbelt and Windows AppContainer deny host-private reads, host writes, networking, subprocesses, workers, cross-process signals, and inherited secrets. macOS also denies Apple Events, LaunchServices, pasteboard, scoped-bookmark, and Security/Keychain service lookups. Windows uses a unique package SID, explicit read/write ACL leases, a creation-time Job Object assignment, a child-process policy, and an allowlist of inherited standard handles. Enabling backend execution is authenticated. `developer` remains an explicitly trusted direct-main-process mode.
2. `LlmGateway` is the final cloud egress sanitizer. It covers nested tool inputs/results, uses an irreversible fallback when native Sentinel is unavailable, and uses random per-session placeholder namespaces. Rust rehydration rejects replacements that change the Bash AST shape.
3. SQLCipher key and rekey operations use the driver's Buffer APIs and clear temporary key buffers.
4. Stdio MCP configuration is rebuilt from known fields and launched through macOS Seatbelt or Windows AppContainer. Unsupported platforms and missing isolation backends fail closed. Network and reverse sampling are disabled by default. User files are hidden by default; only the command installation, cwd, random runtime HOME, absolute `permissions.readPaths`, and read/write `permissions.writePaths` are visible. Credential locations cannot be granted. Windows grants the unique AppContainer SID only the declared paths and masks protected credential descendants when a broader cwd was selected. Only a small environment allowlist is inherited, with environment-key checks performed case-insensitively on Windows.
5. MCP protocol policy limits message size, request concurrency, message/byte rate, stderr, definition counts/schema size, tool output, and reverse-sampling input/output. Plugin IPC also has message, byte-rate, host-call, and concurrency bounds. External tool names are deterministically namespaced and duplicate registry entries are rejected, so an MCP server cannot replace a built-in Agent tool. Broken protocol/process paths unregister the server's tools.
6. Local semantic memory uses deterministic on-device feature hashing. Numeric vectors and identifiers are stored in the app-key SQLCipher main database; no plaintext vector sidecar or cloud embedding request exists. Retrieval is workspace-keyed, excludes the active session, scans at most 2,000 recent vectors, marks excerpts as untrusted historical data, and sends them through the final Sentinel egress sanitizer. If the encrypted main database is unavailable, memory fails closed.
7. Semi-agent approvals use a fresh random ID for every command, accept replies only from the originating top-level WebContents, and expire closed. Do not bind multiple command approvals to the stream request ID or accept subframe approval events.
8. Release builds use pnpm 11.2.2 with a frozen lockfile and rebuild `better-sqlite3-multiple-ciphers` plus `node-pty` for the target Electron runtime. Keep the SQLCipher package external in the Electron main bundle and permitted in `allowBuilds`. The optional SSH2 `cpu-features` addon is intentionally listed in `ignoredOptionalDependencies`: its NAN binding does not compile against Electron 42 / V8 14.8, while SSH2 treats it only as an optional cipher-selection optimization. Build and package all eight Rust N-API modules (`getssh-kv`, `getssh-sysprobe`, `getssh-unarchive`, `getssh-vault`, `sftp-stream`, `nexus-core`, `audit-stream`, and `getssh-sentinel`) and the native process tools on a runner whose OS and CPU match the artifact. Do not cross-compile Electron native dependencies. macOS and Windows packages must pass the packaged-startup probe, which loads SQLCipher, PTY, SSH2, every Rust module, and the required native tools, executes a real local PTY command, and completes an SSH loopback handshake.

macOS still depends on deprecated `/usr/bin/sandbox-exec`; Windows requires the bundled `getssh-sandbox.exe` and Windows 10 / Windows Server 2016 or newer for creation-time Job Object assignment. Any missing backend or launcher fails closed. HTTP MCP does not spawn a local process and is outside this child-process sandbox.

For Windows ACLs, never deny `GENERIC_WRITE` on a read-only file grant: Windows maps `SYNCHRONIZE` into both generic read and generic write, so that deny also breaks reads. Deny only concrete mutation rights, grant file read/execute rights, keep the package SID unique per launch, and preserve the host-side cleanup journal until every temporary ACE has been revoked.

While implementing plugin networking, do not preserve the old `dns.lookup()` followed by an independently resolving `net.fetch()`: that is DNS-rebinding TOCTOU. Bind the validated address to the actual connection and revalidate every redirect.

## Verification

Run:

```bash
# First verify a clean checkout can install without relying on existing node_modules.
pnpm install --frozen-lockfile

cd apps/getssh-client
pnpm exec tsc -b tsconfig.json --force --pretty false
pnpm exec vite build
npm run test:plugin-isolation
npm run test:plugin-network
npm run test:plugin-sandbox
npm run test:database-encryption
npm run test:local-memory
npm run test:sentinel
npm run test:mcp-sandbox

cd ../../rust-core/getssh-sentinel
cargo test

cd ../..
cargo test -p getssh-process-sandbox
cargo clippy -p getssh-process-sandbox --all-targets -- -D warnings
# Run on Windows, or with the Windows Rust standard library installed:
cargo clippy -p getssh-process-sandbox --target x86_64-pc-windows-msvc --all-targets -- -D warnings
```

On native macOS and Windows release runners, build all Rust N-API modules and process tools, package with `electron-builder --dir`, then run `npm run test:packaged-startup` from `apps/getssh-client`. A successful compile on another operating system does not replace this packaged runtime check. `pnpm ignored-builds` must report no silently blocked lifecycle builds, and a clean dependency tree must not contain `cpu-features`.

For Sentinel changes, run assertions against the real Rust `.node` module. For plugin isolation, verify that its PID differs from the main process; undeclared host reads/writes, direct networking, subprocesses, workers, parent signals, and privileged Electron APIs fail; unknown RPC methods are rejected; and crashing one plugin does not terminate the main process. The macOS MCP test invokes Seatbelt and Electron smoke tests launch Electron, so they must run outside an already nested sandbox. `.github/workflows/security-sandbox.yml` must run the real MCP and plugin confinement probes on macOS and Windows; a platform plan test or foreign-target compile does not replace that runtime evidence.

The worktree may contain unrelated user changes. Inspect targeted diffs and preserve them.
