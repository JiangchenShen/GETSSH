# GETSSH Bug Fixes & Security Patches

This document outlines the recent critical bugs and security vulnerabilities discovered and fixed in the GETSSH application.

## 1. Plugin Sandbox Escape Vulnerability (Critical Security Fix)
- **Bug Discovered**: The plugin execution environment utilized `vm.runInNewContext`, which was discovered to be inherently vulnerable to sandbox escape attacks. Malicious plugins could execute arbitrary code by navigating the prototype chain (e.g., `this.constructor.constructor('return process')()`), gaining full access to the Node.js `child_process` and host system.
- **Fix Implemented**: We engineered a robust Runtime Application Self-Protection (RASP) layer in `SecureCenter.ts` and `PluginManager.ts`. Instead of relying solely on `vm`, we implemented deep `Proxy` hooks on native Node.js requires (like `fs` and `child_process`) and strictly froze (`Object.freeze`) the global prototype chains to definitively block memory corruption and prototype pollution attacks.

## 2. Command Center "Quick Connect" Crash (UI/UX Fix)
- **Bug Discovered**: When a user attempted to use the "Quick Connect" feature (typing `user@host` and pressing Enter) in the Empty State Command Center, nothing happened and the console flooded with red DOM errors. The underlying code was trying to execute an unreliable `document.querySelector` on buttons that no longer existed in the updated DOM.
- **Fix Implemented**: Removed all brittle DOM query hacks. Extracted the core layout into a shared `<CommandCenter />` component and explicitly passed the `onConnect` callback directly to the underlying `sshConnect` engine. Quick connect now works flawlessly and instantly.

## 3. Vite Build/HMR Failure (Compilation Fix)
- **Bug Discovered**: The application failed to compile in development mode (`npm run dev`) and production mode due to `SyntaxError: Unexpected token '<'` thrown by Vite. This was caused by malformed and unclosed JSX tags within `EmptyState.tsx`.
- **Fix Implemented**: Conducted a strict TypeScript and JSX audit of the component tree, properly closing all stray `<div>` and `<button>` tags, restoring the Hot Module Replacement (HMR) and build pipelines.

## 4. Unlocalized Date Formatting (i18n Fix)
- **Bug Discovered**: The live clock in the top-right corner of the Command Center was formatting the date and time using the host OS default (`undefined` locale), ignoring the language selected by the user within GETSSH's internationalization settings.
- **Fix Implemented**: Bound the `toLocaleDateString` and `toLocaleTimeString` APIs to the `react-i18next` engine by injecting `i18n.language`, ensuring the date format correctly matches the active UI language (e.g., Chinese formatting when the app is in Chinese).
