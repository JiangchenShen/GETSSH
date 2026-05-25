# GETSSH Critical Security Vulnerabilities & Patches

This document outlines the 6 **CRITICAL** security vulnerabilities discovered during a deep code audit and their respective remediation strategies. If exploited, these vulnerabilities could lead to data exfiltration, system takeover, or application crashes.

## [C-01] Local File Inclusion (LFI) via `getssh-plugin://` Path Traversal
- **Vulnerability**: The custom protocol handler failed to sanitize file paths, allowing `../` traversal. An attacker exploiting an XSS vector could use `fetch('getssh-plugin://../../../../../../Users/xxx/.ssh/id_rsa')` to silently steal arbitrary local files, including SSH private keys.
- **Fix**: Implemented strict path boundary validation using `startsWith()` to immediately reject any traversal outside the designated plugin directory.

## [C-02] Node.js Privilege Escalation via Unsandboxed Plugins
- **Vulnerability**: Third-party plugins were loaded directly into the Electron Main Process via `require()`, granting them unrestricted access to powerful Node.js APIs like `fs` and `child_process`. This essentially handed over full host OS privileges to untrusted code.
- **Fix**: Architected a Runtime Application Self-Protection (RASP) layer using deep `Proxy` interceptions and `Object.freeze` to strictly sandbox plugins, blocking unauthorized API calls and prototype pollution.

## [C-03] Master Password Leak via `safeStorageDecrypt` Exposure
- **Vulnerability**: The `safeStorageDecrypt` API was accidentally exposed to the Plugin SDK. A malicious plugin could simply read the OS-encrypted `profiles.key` from disk, pass it to this function, and instantly receive the plaintext Master Password.
- **Fix**: Revoked and completely removed this decryption capability from the Plugin IPC layer.

## [C-04] Windows OS Biometric Authentication Bypass
- **Vulnerability**: In Windows, Electron's `safeStorage` relies on DPAPI, meaning decryption occurs implicitly without prompting the user for a fingerprint or PIN (unlike macOS). Malicious scripts could call `promptBiometricUnlock` to silently extract the plaintext Master Password.
- **Fix**: Implemented a mandatory, custom system-level password verification prompt explicitly for the Windows platform to enforce user interaction before decryption.

## [C-05] Full CSP Bypass & RCE via `will-navigate` Protocol Logic Flaw
- **Vulnerability**: To allow loading the app's `index.html`, the `will-navigate` event blindly permitted all `file://` protocol navigations. An attacker could execute `window.location.href = 'file:///tmp/malicious.html'`, causing the main window to load a malicious local file. This file would inherit all `electronAPI` privileges while escaping the app's Content Security Policy (CSP), resulting in Remote Code Execution (RCE).
- **Fix**: Tightened the navigation rules to strictly allow list only the exact, expected path for `dist/index.html`.

## [C-06] Out of Memory (OOM) Crash via Unbounded SFTP File Reads
- **Vulnerability**: The SFTP handler utilized `readFile` to load entire file contents directly into RAM. Opening a multi-gigabyte remote log file would instantly exhaust the V8 engine's memory, causing a fatal app crash.
- **Fix**: Refactored the file transfer subsystem to utilize Streams, implementing bounded chunk transfers and size limits.
