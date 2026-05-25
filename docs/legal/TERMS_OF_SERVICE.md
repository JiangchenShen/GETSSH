# GETSSH Terms of Service

**Effective Date:** May 24, 2026  
**Last Updated:** May 24, 2026

Welcome to the GETSSH Terminal Platform. These Terms of Service ("Terms") constitute a legally binding agreement between you (whether an individual or a corporate entity) and GETSSH ("we," "our," or "us"). By downloading, installing, accessing, or utilizing the GETSSH application (the "Software" or "Service"), you expressly acknowledge that you have read, understood, and agree to be bound by these Terms. 

If you do not accept these Terms in their entirety, you are strictly prohibited from using or accessing the Software.

---

## 1. Acceptance and Authority

By accessing the Software, you affirm that you are of legal age to enter into a binding contract. If you are accepting these Terms on behalf of a corporation, governmental organization, or other legal entity, you represent and warrant that you possess the requisite authority to bind such entity to these Terms.

## 2. Open Source Nature, Forks, and Absolute Disclaimer of Unofficial Builds

### 2.1 The Open Source Paradigm and Official Distribution
GETSSH is distributed as an open-source project to foster transparency, security auditing, and community contribution. However, the **only** legally recognized, officially supported, and verified versions of the Software are those distributed exclusively through our official GitHub Releases page. We do not publish, endorse, or verify any distributions made available on third-party package managers (e.g., Homebrew, Chocolatey, apt repositories), software mirrors, download aggregators, or torrent networks.

### 2.2 Exhaustive Disclaimer for Modifications, Forks, and Third-Party Builds
The inherently permissive nature of open-source software allows any individual, organization, or malicious actor to clone, modify, recompile, and redistribute the GETSSH source code. 

**BY USING ANY VERSION OF GETSSH NOT DIRECTLY DOWNLOADED FROM OUR OFFICIAL RELEASES PAGE, YOU EXPLICITLY ACKNOWLEDGE AND AGREE THAT:**

1. **Malicious Alterations:** Unofficial builds may contain injected malware, backdoors, keyloggers, credential harvesters, ransomware, or cryptominers.
2. **Network Interception:** Third-party builds may have their source code altered to silently route your SSH/SFTP traffic, master passwords, or private keys to unauthorized external servers (e.g., Man-in-the-Middle or data exfiltration).
3. **Zero Warranty or Liability:** We possess zero technical oversight over community-modified code. We categorically and unconditionally disclaim all liability, responsibility, warranties (express or implied), and indemnification obligations for any damages resulting from the use of unofficial, forked, customized, or community-compiled versions of the Software.
4. **Assumption of Catastrophic Risk:** If you choose to compile the Software from source or download it from an unverified third party, you assume 100% of the catastrophic risk associated with total data loss, infrastructure compromise, server breaches, and subsequent financial, legal, and operational liabilities.

### 2.3 Prohibition of Deceptive Distribution
While you are free to modify the source code in accordance with the underlying open-source license, you are strictly prohibited from distributing modified, malicious, or vulnerable versions of the Software under the trademark, branding, logos, or name "GETSSH" in any manner that could deceive or mislead end-users into believing they are utilizing the official, uncompromised Software.

## 3. License Grant & Usage Restrictions

### 3.1 Limited License
Subject to your continuous compliance with these Terms and the underlying open-source licenses, GETSSH grants you a personal, worldwide, non-exclusive, revocable, and limited license to install and execute the Software strictly for your internal personal or business operations.

### 3.2 Prohibited Conduct
As a condition of this license, you unconditionally agree **NOT** to:
- Utilize the Software to facilitate unauthorized penetration testing, vulnerability scanning, or any form of cyberattack (including, without limitation, DDoS, MITM, or brute-force credential stuffing) against infrastructure you do not explicitly own or possess authorization to test.
- Circumvent, disable, or tamper with any security-related features embedded within the official Software.
- Falsely imply endorsement, sponsorship, or affiliation with GETSSH for any third-party derivatives or commercial services.

## 4. Account Security and Cryptographic Responsibilities

### 4.1 Zero-Knowledge Encryption
GETSSH provides an optional AES-256-GCM Secure Vault to encrypt your connection profiles. **You bear sole and absolute responsibility for the secure management of your Master Password.**
GETSSH operates on a strict zero-knowledge architecture. We do not transmit, store, or possess the cryptographic capability to recover your Master Password. **Loss of your Master Password will result in the irretrievable loss of your encrypted data.**

### 4.2 Infrastructure Access Liability
You are exclusively responsible for the servers, networks, and systems you interface with using the Software. We assume zero liability for unauthorized access, data breaches, or system compromises resulting from your negligence, mishandled credentials, weak passwords, or failure to verify host fingerprints.

## 5. Third-Party Plugins & Ecosystem

GETSSH facilitates a sandboxed ecosystem for third-party plugins. These plugins are developed, maintained, and distributed by independent third parties. GETSSH does not audit, endorse, or guarantee the security, stability, or privacy practices of any third-party plugin. Your use of such plugins is entirely at your own risk, and GETSSH expressly disclaims all liability arising from plugin execution, data exfiltration, or privilege escalation caused by malicious plugins.

## 6. Disclaimer of Warranties

TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, THE SOFTWARE IS PROVIDED ON AN "AS IS" AND "AS AVAILABLE" BASIS, WITH ALL FAULTS AND WITHOUT WARRANTY OF ANY KIND. GETSSH EXPRESSLY DISCLAIMS ALL WARRANTIES, WHETHER EXPRESS, IMPLIED, STATUTORY, OR OTHERWISE, INCLUDING WITHOUT LIMITATION ANY IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, QUIET ENJOYMENT, ACCURACY, AND NON-INFRINGEMENT.

WE DO NOT WARRANT THAT THE SOFTWARE WILL FUNCTION UNINTERRUPTED, THAT IT WILL BE ERROR-FREE, THAT IT WILL MEET YOUR SPECIFIC REQUIREMENTS, OR THAT ANY DEFECTS WILL BE CORRECTED.

## 7. Limitation of Liability

TO THE FULLEST EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT SHALL GETSSH, ITS FOUNDERS, DEVELOPERS, AFFILIATES, OR CONTRIBUTORS BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO, DAMAGES FOR LOSS OF PROFITS, LOSS OF REVENUE, LOSS OF DATA, BUSINESS INTERRUPTION, OR PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES, HOWEVER CAUSED AND UNDER ANY THEORY OF LIABILITY (CONTRACT, STRICT LIABILITY, TORT, OR OTHERWISE), ARISING OUT OF OR IN CONNECTION WITH YOUR USE OR INABILITY TO USE THE SOFTWARE, EVEN IF WE HAVE BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.

## 8. Indemnification

You agree to fully indemnify, defend, and hold harmless GETSSH, its affiliates, developers, and contributors from and against any and all claims, demands, liabilities, damages, losses, costs, and expenses (including reasonable attorneys' fees) arising out of: (a) your use of the Software; (b) your use of any unofficial or modified fork of the Software; (c) your breach of these Terms; or (d) your violation of any applicable law, regulation, or third-party rights.

## 9. Governing Law & Jurisdiction

These Terms, and any dispute arising out of or related to them, shall be governed by and construed in accordance with the laws of the jurisdiction in which the principal developer resides, without regard to its conflict of laws principles.

## 10. Modifications to Terms

We reserve the unilateral right to amend, update, or replace these Terms at any time. Material changes will be communicated via release notes or within the Software interface prior to taking effect. Your continued use of the Software following the effective date of any modifications constitutes your binding acceptance of the revised Terms.

## 11. Contact Information

For legal inquiries or notices pertaining to these Terms, please contact us via our official repository:

**Official Repository:** [https://github.com/JiangchenShen/GETSSH](https://github.com/JiangchenShen/GETSSH)
