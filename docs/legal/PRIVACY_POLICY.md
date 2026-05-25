# GETSSH Privacy Policy

**Effective Date:** May 24, 2026  
**Last Updated:** May 24, 2026

At GETSSH ("we," "our," or "us"), we recognize that trust is the cornerstone of enterprise server administration and secure network communications. We are fundamentally committed to protecting the privacy, confidentiality, and integrity of your data. This Privacy Policy outlines our data handling practices, our zero-knowledge architecture, and your rights regarding your information when you use the GETSSH Terminal Platform (the "Software").

---

## 1. Scope, Applicability, and Extreme Open-Source Disclaimer

### 1.1 Official Verification Prerequisite
**CRITICAL LEGAL NOTICE:** Because GETSSH is developed under an open-source model, its underlying source code is publicly accessible and can be freely cloned, modified, recompiled, and redistributed by any entity worldwide—including malicious actors. 

**This Privacy Policy applies EXCLUSIVELY and STRICTLY to the official, verified builds of GETSSH downloaded directly from our official GitHub Releases page.** 

### 1.2 Nullification of Policy for Unofficial Builds
If you execute, install, or operate a forked, community-modified, self-compiled, or third-party distributed version of GETSSH, **this Privacy Policy is instantly rendered null, void, and entirely inapplicable.**

By utilizing an unofficial build, you explicitly acknowledge that:
1. **Code Tampering:** The source code governing data handling may have been intentionally altered to bypass the privacy protections outlined in this document.
2. **Credential Theft:** Malicious modifications may be specifically designed to silently harvest your plaintext SSH credentials, private keys, or AES-256-GCM Master Password.
3. **Unauthorized Telemetry:** Third-party distributors may inject aggressive telemetry, tracking scripts, or analytics engines without your consent.
4. **Absolute Severance of Liability:** We have absolutely no visibility into, authority over, or legal responsibility for the data collection and privacy practices of any unofficial software forks. We categorically disclaim all liability for privacy breaches, data exfiltration, or surveillance conducted through modified versions of our open-source codebase.

---

## 2. Zero-Knowledge Architecture & Local-First Philosophy

### 2.1 Architectural Principle
GETSSH is engineered from the ground up as a strictly **local-first, zero-knowledge application**. We do not provision, operate, or maintain centralized backend infrastructure for the purpose of aggregating, synchronizing, or storing your personal data or server credentials.

### 2.2 Local Storage Mechanism
All operational and authentication data—including but not limited to SSH hostnames, usernames, port configurations, cryptographic key pairs, plaintext passwords, SFTP connection logs, and application state configurations—are persistently stored **strictly on your local device**. 

By default, this data resides within your operating system's secured `userData` directory (e.g., `~/Library/Application Support/getssh` on macOS or `%APPDATA%\getssh` on Windows).

### 2.3 Cryptographic Safeguards
GETSSH offers an opt-in Secure Vault system. When provisioned, your sensitive connection profiles and credentials undergo local encryption utilizing military-grade **AES-256-GCM**, keyed by a cryptographic hash derived from your designated Master Password via PBKDF2.

- **Ephemeral Processing:** Encryption and decryption operations occur entirely in volatile memory (RAM).
- **Absolute Non-Transmission:** We do not transmit, back up, or retain any copy of your Master Password or cryptographic keys.
- **Irrevocability:** In the event of a lost Master Password, GETSSH possesses no technical capability to recover, decrypt, or restore your encrypted data.

---

## 3. Information We Explicitly DO NOT Collect

To provide absolute clarity on our privacy posture, GETSSH **DOES NOT** collect, transmit, process, or monetize any of the following:

- **Telemetry & Analytics:** We do not harvest application usage statistics, behavioral telemetry, or performance metrics.
- **Diagnostics:** We do not automatically collect crash logs or error reports. Diagnostic data is only processed if manually and explicitly submitted by you via public GitHub Issues.
- **Network Metadata:** We do not track IP addresses, MAC addresses, device identifiers, or geolocation data.
- **Personally Identifiable Information (PII):** We do not collect names, email addresses, or other personal identifiers.
- **Operational Data:** We have zero visibility into your server configuration details, command-line history, file transfers, or session payloads.

---

## 4. Necessary Network Communications

While GETSSH does not transmit analytics, the Software must initiate specific network connections to fulfill its core functionality:

### 4.1 Software Update Checks
To ensure you receive critical security patches, GETSSH periodically queries the public GitHub Releases API (`api.github.com`). These requests contain standard HTTP headers (e.g., User-Agent, IP address) which are processed by GitHub in accordance with the [GitHub Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-privacy-statement). GETSSH does not control, log, or have access to this infrastructure.

### 4.2 Direct SSH/SFTP Tunnels
The primary function of GETSSH is establishing direct, end-to-end encrypted TCP tunnels between your local client and your designated remote infrastructure. This traffic flows strictly between you and your target servers. We do not proxy, intercept, decrypt, or inspect any segment of this communication.

### 4.3 Extensible Plugin Ecosystem
GETSSH supports third-party plugins running within an isolated sandbox. Plugins may independently initiate network requests to external APIs. 
**Disclaimer:** GETSSH does not govern, audit, or endorse the privacy practices of third-party plugins. By provisioning a plugin, you subject yourself to the respective publisher's data handling policies. We strongly mandate auditing plugin source code prior to installation in secure environments.

---

## 5. Host Key Verification & MITM Mitigation

To safeguard against Man-in-the-Middle (MITM) attacks, GETSSH caches SSH host key fingerprints within a local `known_hosts.json` registry. This cryptographic ledger is utilized exclusively for verifying host authenticity during subsequent connections and is never transmitted beyond your local filesystem.

---

## 6. Security & Isolation Practices

We employ rigorous, industry-standard security practices throughout the software development lifecycle, including:
- **Process Sandboxing:** Utilization of Electron's Context Isolation and sandboxing mechanisms for all renderer processes.
- **Code Execution Safeguards:** Explicit blocking of unsafe JavaScript execution (e.g., `eval()`) and enforcement of strict Content Security Policies (CSP).
- **Secure IPC:** Segregated Inter-Process Communication (IPC) channels designed to isolate sensitive cryptographic operations from untrusted UI contexts.

---

## 7. Policy Modifications

As the GETSSH platform evolves, we may periodically revise this Privacy Policy to reflect changes in our architectural posture or legal obligations. All modifications will be published directly within the Software and on our official code repository. For material changes, we will provide conspicuous notice via release notes.

---

## 8. Contact & Inquiries

We welcome scrutiny and dialogue regarding our privacy engineering. If you require clarification or have concerns regarding our data handling practices, please engage with us via our official repository:

**Official Repository:** [https://github.com/JiangchenShen/GETSSH](https://github.com/JiangchenShen/GETSSH)
