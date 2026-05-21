# Third-Party Licenses

**Last Updated:** May 2026

The **GETSSH Terminal Platform** is built upon robust open-source foundations. We are deeply grateful to the open-source community, without whom this software would not exist. 

Below is a comprehensive registry of critical third-party components, their respective licenses, and copyright notices used within GETSSH. By using GETSSH, you also agree to respect the terms and conditions outlined by these underlying licenses.

---

## 1. Core Frameworks & Runtimes

### Electron
- **License**: MIT
- **Description**: Framework for building cross-platform desktop apps with web technologies.
- **Copyright**: Copyright (c) Electron contributors and OpenJS Foundation.
- **Repository**: [https://github.com/electron/electron](https://github.com/electron/electron)

### Node.js
- **License**: MIT / Various
- **Description**: JavaScript runtime built on Chrome's V8 JavaScript engine.
- **Copyright**: Copyright Node.js contributors. All rights reserved.
- **Repository**: [https://github.com/nodejs/node](https://github.com/nodejs/node)

### Chromium
- **License**: BSD 3-Clause / Various
- **Description**: An open-source browser project that forms the foundation of Electron.
- **Copyright**: Copyright The Chromium Authors.
- **Repository**: [https://chromium.googlesource.com/chromium/src](https://chromium.googlesource.com/chromium/src)

---

## 2. Frontend Libraries

### React & React DOM
- **License**: MIT
- **Description**: A JavaScript library for building user interfaces.
- **Copyright**: Copyright (c) Meta Platforms, Inc. and affiliates.
- **Repository**: [https://github.com/facebook/react](https://github.com/facebook/react)

### Zustand
- **License**: MIT
- **Description**: Bear necessities for state management in React.
- **Copyright**: Copyright (c) 2019 Paul Henschel.
- **Repository**: [https://github.com/pmndrs/zustand](https://github.com/pmndrs/zustand)

### Tailwind CSS
- **License**: MIT
- **Description**: A utility-first CSS framework for rapid UI development.
- **Copyright**: Copyright (c) Tailwind Labs, Inc.
- **Repository**: [https://github.com/tailwindlabs/tailwindcss](https://github.com/tailwindlabs/tailwindcss)

---

## 3. Terminal & Networking Core

### xterm.js
- **License**: MIT
- **Description**: A terminal for the web, powering the core terminal emulator in GETSSH.
- **Copyright**: Copyright (c) 2017-2022, The xterm.js authors.
- **Repository**: [https://github.com/xtermjs/xterm.js](https://github.com/xtermjs/xterm.js)

### ssh2
- **License**: MIT
- **Description**: SSH2 client and server modules written in pure JavaScript for Node.js.
- **Copyright**: Copyright (c) Brian White. All rights reserved.
- **Repository**: [https://github.com/mscdex/ssh2](https://github.com/mscdex/ssh2)

### ssh2-streams
- **License**: MIT
- **Description**: SSH2 streams handling, utilized alongside `ssh2`.
- **Copyright**: Copyright (c) Brian White.

---

## 4. Supplementary Utilities

### Lucide React
- **License**: ISC
- **Description**: Beautiful & consistent icon toolkit.
- **Copyright**: Copyright (c) 2022 Lucide Contributors.
- **Repository**: [https://github.com/lucide-icons/lucide](https://github.com/lucide-icons/lucide)

### i18next
- **License**: MIT
- **Description**: Internationalization-framework written in and for JavaScript.
- **Copyright**: Copyright (c) 2022 i18next.
- **Repository**: [https://github.com/i18next/i18next](https://github.com/i18next/i18next)

### DOMPurify
- **License**: Apache License 2.0 / Mozilla Public License 2.0
- **Description**: A DOM-only, super-fast, uber-tolerant XSS sanitizer for HTML, MathML and SVG.
- **Copyright**: Copyright 2015 Mario Heiderich.
- **Repository**: [https://github.com/cure53/DOMPurify](https://github.com/cure53/DOMPurify)

---

## 5. Full Dependency Tree
The components listed above represent the core dependencies of GETSSH. There are numerous transitive dependencies automatically resolved by `npm`. For a complete, exhaustive tree of dependencies and their exact versions, please refer to the `package.json` and `package-lock.json` files within the GETSSH source repository.

If you believe a library has been omitted or a license is incorrectly attributed, please open an issue immediately on our GitHub repository so we can rectify it.
