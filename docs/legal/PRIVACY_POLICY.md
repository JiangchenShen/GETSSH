# Privacy Policy

**Last Updated:** May 2026
**Effective Date:** May 21, 2026

GETSSH ("we", "our", or "us") respects your privacy and is fundamentally committed to protecting your personal data. We believe that privacy is a human right, especially when building tools for server administration and secure network communications. 

This Privacy Policy describes in exhaustive detail how your data is handled when you use the GETSSH Terminal Platform.

---

## 1. Zero-Knowledge Architecture & Local-First Philosophy
GETSSH is strictly designed as a **local-first, zero-knowledge application**. 
We do not operate a centralized backend infrastructure for syncing your personal data, nor do we harvest your server credentials.

### 1.1 Local Storage Mechanism
All your data, including but not limited to:
- SSH hostnames, usernames, and ports
- Plaintext passwords and private SSH keys
- SFTP connection logs
- Application layout configurations and visual themes

...are stored **strictly on your local machine** within your operating system's designated `userData` directory (e.g., `~/Library/Application Support/getssh` on macOS or `%APPDATA%\getssh` on Windows).

### 1.2 AES-256-GCM Encryption
GETSSH provides an opt-in Secure Vault system. When enabled, your sensitive connection profiles and credentials are encrypted using military-grade local **AES-256-GCM encryption**, derived from your unique Master Password. 
- The encryption and decryption happen entirely in local memory (RAM).
- We do not transmit, backup, or hold a copy of your Master Password.
- If you lose your Master Password, we cannot recover your data under any circumstances.

## 2. Information We DO NOT Collect
To be absolutely clear, GETSSH **DOES NOT** collect, transmit, or monetize:
- Telemetry data or application usage statistics.
- Crash logs or error reports (unless explicitly provided by you via GitHub Issues).
- IP addresses, MAC addresses, or location data.
- Personally identifiable information (PII).
- Server configuration details or command-line history.

## 3. Network Communications Initiated by the App
While GETSSH does not send analytics to our servers, the application does make essential network connections to function properly:

### 3.1 Update Checks
GETSSH periodically pings the public GitHub Releases API (`api.github.com/repos/JiangchenShen/GETSSH/releases/latest`) to check if a new software version is available. This request contains standard HTTP headers (like your IP address and User-Agent) which are processed by GitHub according to [GitHub's Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-privacy-statement). We do not have access to these logs.

### 3.2 Direct SSH/SFTP Connections
The core functionality of GETSSH involves establishing direct, encrypted TCP connections between your local machine and your designated remote servers over SSH. This traffic is strictly end-to-end between you and your server. We do not proxy, inspect, or intercept this traffic.

### 3.3 Third-Party Plugins
GETSSH supports an extensible plugin ecosystem. Plugins run in an isolated Iframe sandbox but may execute network requests to their respective third-party APIs. 
- **Disclaimer**: We do not govern the privacy policies of third-party plugins. By installing a plugin, you agree to their specific data handling practices. We strongly advise auditing plugin source code or reviewing their privacy statements before installation.

## 4. Host Key Verification (MITM Protection)
When connecting to a server, GETSSH caches the SSH host key fingerprint in a local `known_hosts.json` file. This data is used solely to protect you against Man-in-the-Middle (MITM) attacks during future connections. This file is never transmitted externally.

## 5. Security Practices
We employ rigorous security practices during the development of GETSSH, including:
- Context Isolation and Sandboxing for the Electron Renderer.
- Explicit blocking of unsafe `eval()` and strict Content Security Policies (CSP).
- Local-only inter-process communication (IPC) for handling sensitive cryptographic keys.

## 6. Changes to This Policy
As GETSSH evolves and introduces new features (such as opt-in cloud sync plugins, if ever developed), we may update this Privacy Policy. Any changes will be reflected in this document within the application and on our GitHub repository. We will notify users of significant changes via release notes.

## 7. Contact Us
If you have any questions, concerns, or require clarification regarding our privacy practices, please contact us openly by creating an issue on our GitHub repository:
**GitHub:** [https://github.com/JiangchenShen/GETSSH](https://github.com/JiangchenShen/GETSSH)
