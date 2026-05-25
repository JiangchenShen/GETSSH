# GETSSH Open Source Attributions & Third-Party Licenses

**Effective Date:** May 24, 2026  
**Last Updated:** May 24, 2026

The **GETSSH Terminal Platform** is engineered upon robust, industry-standard open-source foundations. We extend our deepest gratitude to the global open-source community, whose continuous innovation and dedication make this software possible.

This document serves as the official registry of critical third-party components, their respective licensing agreements, and mandatory copyright notices integrated within the GETSSH ecosystem. By deploying, installing, or utilizing GETSSH, you acknowledge and agree to comply with the terms and conditions set forth by these underlying open-source licenses.

---

## 1. Core Frameworks & Runtimes

### Electron
- **License**: MIT
- **Description**: Framework for building cross-platform desktop applications utilizing web technologies.
- **Copyright**: Copyright (c) Electron contributors and OpenJS Foundation.
- **Repository**: [https://github.com/electron/electron](https://github.com/electron/electron)

### Node.js
- **License**: MIT / Various
- **Description**: High-performance JavaScript runtime environment built on Chrome's V8 engine.
- **Copyright**: Copyright Node.js contributors. All rights reserved.
- **Repository**: [https://github.com/nodejs/node](https://github.com/nodejs/node)

### Chromium
- **License**: BSD 3-Clause / Various
- **Description**: Open-source browser project forming the foundational rendering engine of Electron.
- **Copyright**: Copyright The Chromium Authors.
- **Repository**: [https://chromium.googlesource.com/chromium/src](https://chromium.googlesource.com/chromium/src)

---

## 2. Frontend Infrastructure

### React & React DOM
- **License**: MIT
- **Description**: JavaScript library for engineering dynamic user interfaces.
- **Copyright**: Copyright (c) Meta Platforms, Inc. and affiliates.
- **Repository**: [https://github.com/facebook/react](https://github.com/facebook/react)

### Zustand
- **License**: MIT
- **Description**: Lightweight, unopinionated state management solution for React.
- **Copyright**: Copyright (c) 2019 Paul Henschel.
- **Repository**: [https://github.com/pmndrs/zustand](https://github.com/pmndrs/zustand)

### Tailwind CSS
- **License**: MIT
- **Description**: Utility-first CSS framework for rapid and scalable UI development.
- **Copyright**: Copyright (c) Tailwind Labs, Inc.
- **Repository**: [https://github.com/tailwindlabs/tailwindcss](https://github.com/tailwindlabs/tailwindcss)

---

## 3. Terminal & Networking Core

### xterm.js
- **License**: MIT
- **Description**: High-performance terminal emulator powering the core UI of GETSSH.
- **Copyright**: Copyright (c) 2017-2022, The xterm.js authors.
- **Repository**: [https://github.com/xtermjs/xterm.js](https://github.com/xtermjs/xterm.js)

### ssh2
- **License**: MIT
- **Description**: Robust SSH2 client and server implementations authored in pure JavaScript for Node.js.
- **Copyright**: Copyright (c) Brian White. All rights reserved.
- **Repository**: [https://github.com/mscdex/ssh2](https://github.com/mscdex/ssh2)

### ssh2-streams
- **License**: MIT
- **Description**: Underlying stream handling for the SSH2 protocol.
- **Copyright**: Copyright (c) Brian White.

---

## 4. Supplementary Utilities

### Lucide React
- **License**: ISC
- **Description**: Comprehensive and consistent open-source icon toolkit.
- **Copyright**: Copyright (c) 2022 Lucide Contributors.
- **Repository**: [https://github.com/lucide-icons/lucide](https://github.com/lucide-icons/lucide)

### i18next
- **License**: MIT
- **Description**: Enterprise-grade internationalization framework for JavaScript.
- **Copyright**: Copyright (c) 2022 i18next.
- **Repository**: [https://github.com/i18next/i18next](https://github.com/i18next/i18next)

### DOMPurify
- **License**: Apache License 2.0 / Mozilla Public License 2.0
- **Description**: Highly resilient, DOM-only XSS sanitizer for HTML, MathML, and SVG.
- **Copyright**: Copyright 2015 Mario Heiderich.
- **Repository**: [https://github.com/cure53/DOMPurify](https://github.com/cure53/DOMPurify)

---

## 5. Exhaustive Dependency Registry
The components detailed above denote the primary core dependencies integrated into GETSSH. The Software also relies upon numerous transitive dependencies automatically resolved via the `npm` ecosystem. For an exhaustive, cryptographic bill of materials (SBOM) and exact dependency versioning, please consult the `package.json` and `package-lock.json` manifests located within the GETSSH source repository.

### Reporting Omissions
If you believe a library has been inadvertently omitted or a license incorrectly attributed, please open an issue immediately on our official GitHub repository to facilitate expedited remediation.
