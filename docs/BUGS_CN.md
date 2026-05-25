# GETSSH 关键安全漏洞审计与修复报告 (Critical Vulnerabilities)

本文档记录了在深度代码审计中发现的 6 个 **CRITICAL (致命级)** 安全漏洞及其修复方案。这些漏洞一旦被利用，可导致数据泄露、系统接管或应用崩溃。

## [C-01] `getssh-plugin://` 路径穿越导致本机 LFI
- **漏洞描述**：自定义协议拦截器未对路径进行过滤，`join()` 函数无法阻止 `../` 遍历。攻击者通过 XSS 执行 `fetch('getssh-plugin://../../../../../../Users/xxx/.ssh/id_rsa')` 即可窃取任意本地文件（如 SSH 私钥）。
- **修复方案**：引入 `startsWith()` 进行严格的边界路径校验，拒绝任何跳出插件目录的请求。

## [C-02] 主进程插件以 Node.js 最高权限运行（无沙盒）
- **漏洞描述**：第三方插件通过 `require()` 直接加载到 Electron 主进程，可直接访问 `fs`、`child_process` 等全部 Node.js API，等同于拥有当前用户的最高系统权限。
- **修复方案**：全面重构插件沙盒架构，引入基于 `Proxy` 的运行时应用自我保护 (RASP) 层，阻断未授权的 API 调用，并冻结全局原型链。

## [C-03] `safeStorageDecrypt` 暴露给插件导致凭证明文泄露
- **漏洞描述**：主进程不慎将 `safeStorageDecrypt` 接口暴露给所有插件。恶意插件只需读取本地的 `profiles.key`，传入该函数即可无门槛获得明文主密码。
- **修复方案**：彻底从 Plugin SDK 及 IPC 暴露层中移除该解密接口的授权。

## [C-04] Windows 平台生物解锁验证绕过
- **漏洞描述**：Electron 的 `safeStorage` 在 Windows 下底层依赖 DPAPI，解密是隐式的，不会像 macOS 那样弹出指纹确认框。恶意脚本调用 `promptBiometricUnlock` 即可秒级窃取主密码明文。
- **修复方案**：在 Windows 平台强制引入自定义的系统级密码验证弹窗，补齐安全短板。

## [C-05] `will-navigate` 协议校验逻辑漏洞导致全局 CSP 绕过 + RCE
- **漏洞描述**：为主窗口加载 `index.html` 而简单放行了所有 `file://` 协议导航。恶意脚本可通过 `window.location.href` 跳转到本地恶意网页，该网页在主窗口中渲染，继承了全部 `electronAPI` 特权并脱离了 CSP 限制，直接升级为无限制的 RCE。
- **修复方案**：收紧 `will-navigate` 的校验规则，仅允许精确匹配的 `dist/index.html` 路径进行跳转。

## [C-06] SFTP 大文件读取导致 OOM 崩溃
- **漏洞描述**：SFTP 底层使用了 `readFile` 一次性读取文件内容到内存。双击远端数 GB 大小的日志文件会瞬间导致 Node.js V8 引擎 Out of Memory 崩溃。
- **修复方案**：重构为流式读写 (Streams) 进行文件交互，引入合理的大小限制与分块传输。
