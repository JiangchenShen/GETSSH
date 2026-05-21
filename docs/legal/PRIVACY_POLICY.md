# Privacy Policy

**Last Updated:** May 2026

GETSSH ("we", "our", or "us") respects your privacy and is committed to protecting your personal data. This Privacy Policy describes how your data is handled when you use the GETSSH Terminal Platform.

## 1. Zero-Knowledge Architecture
GETSSH is designed as a **local-first, zero-knowledge application**. 
- **Local Storage:** All your data, including SSH keys, credentials, and connection profiles, is stored strictly on your local machine (`userData` directory).
- **Encryption:** Your sensitive connection profiles and credentials are encrypted using military-grade local AES-256-GCM encryption powered by your unique Master Password. We do not have access to your Master Password or the decrypted data.
- **No Cloud Sync:** We do not transmit your profiles, keys, or terminal data to any external servers or third-party cloud services.

## 2. Data Collection
We **do not** collect, transmit, or monetize telemetry, usage analytics, or personally identifiable information (PII). 

The only network requests initiated by GETSSH to external servers are:
- **Update Checks:** GETSSH pings the GitHub Releases API (`api.github.com/repos/JiangchenShen/GETSSH/releases/latest`) solely to check if a new version is available.
- **SSH Connections:** Direct, encrypted SSH traffic between your local machine and your designated remote servers.
- **Plugins:** Network requests explicitly initiated by sandboxed plugins you choose to install.

## 3. Third-Party Plugins
GETSSH supports a plugin ecosystem. Plugins run in a restricted sandbox environment but may have their own privacy practices if they request specific permissions. We encourage you to review the privacy policies of any third-party plugins you install.

## 4. Changes to This Policy
We may update our Privacy Policy from time to time. Any changes will be reflected in this document and effective immediately.

## 5. Contact Us
If you have any questions or concerns about our Privacy Policy, please open an issue on our GitHub repository: [GETSSH GitHub](https://github.com/JiangchenShen/GETSSH).
