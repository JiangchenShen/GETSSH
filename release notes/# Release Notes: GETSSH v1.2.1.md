# Release Notes: GETSSH v1.2.1 (The AI-Driven Architecture Leap)

始终感谢所有选择GETSSH的伙伴们

如果说三天前的 v1.2.0 是一次极限压缩体积的“物理瘦身”，那么今天的 **v1.2.1 则是一场彻底的“基因重组”**。
这不仅仅是一个版本号的递增，更是为了迎接终极形态（插件生态 & Web 版堡垒机）而铸造的钢铁地基。

## 🏗️ 击碎“上帝类” (The God-Class Refactoring)

随着功能的堆叠，我们的 `App.tsx` 和主进程 `index.ts` 曾一度膨胀到逼近千行。在这个版本中，我们对主进程进行了极其严苛的模块化肢解：

* **IPC Handlers 彻底解耦**：将高达 700 多行的入口文件压缩至不足 250 行。抽象出了独立的 `ConnectionManager`（会话与防并发锁管理）、`sshHandler`、`sftpHandler` 以及 `cryptoHandler`。
* **为什么这么做？** 这一切都是为了 **v2.0 的 Plugin SDK** 让路。只有底层的 IPC 频道和状态被彻底物理隔离，未来的第三方插件才能以极低风险挂载到我们的核心 I/O 上。

## 🚀 SFTP 引擎补全与 Oracle Cloud 兼容性修复

我们重构了整个 SFTP 可视化面板的交互与底层解析逻辑：

* **消灭 UI 阻塞**：彻底移除了在 macOS 上可能导致 UI 进程挂起甚至死锁的底层 `window.prompt` 调用，采用基于 Zustand 状态驱动的受控 React Modal，让“新建文件/文件夹”的交互丝滑无比。
* **极客导航**：地址栏（Address Bar）现已支持点击直达。你可以直接粘贴绝对路径 ` /etc/nginx/sites-available` 并一键穿越。
* **根目录穿透修复**：修复了一个隐藏极深的 Bug——在某些深度定制的 Linux 发行版（如甲骨文云的 Ubuntu 镜像）下，因底层 `ssh2` 对象缺失 `isDirectory` 属性导致的文件树渲染折叠问题。现在，它甚至完美支持了软链接（Symlink）的图标显示与穿透访问。

## 🤫 “佛系但致命”的自动更新机制

我们痛恨流氓软件强塞的更新弹窗，也受限于跨平台代码签名的繁文缛节。因此，我们摒弃了臃肿的 `electron-updater`，用纯原生 API 写了一套最符合极客审美的更新机制：

* **后台静默轮询**：应用会在后台以极低的资源占用轮询 GitHub Releases API，并完美兼容含有 `V` 前缀的 Tag 解析。
* **非侵入式提醒**：当发现新版本时，你只会看到侧边栏“设置”图标上亮起一个优雅的小红点 (Badge)，以及一个数秒后自动消失的轻量级 Toast 气泡。决定权（前往浏览器下载）永远交还给用户。

## 🌍 全平台大满贯：Windows ARM 正式加入战场！

我们进一步优化了交叉编译流水线。在 v1.2.1 中，**我们正式宣布加入了对 Windows ARM64 架构（如骁龙 X Elite 笔记本）的原生支持！** 至此，GETSSH 达成了跨平台兼容性的“大满贯”，且每个架构的独立安装包体积均被严苛控制。

### 📦 最终发布的独立产物清单 (Artifacts)

**1. Windows 阵营**
* 🪟 **x64 (标准 64 位):** `dist/GETSSH-Setup-1.2.1-x64.exe` 
* 💻 **ARM64 (骁龙笔记本专属):** `dist/GETSSH-Setup-1.2.1-arm64.exe`

**2. macOS 阵营**
* 🍏 **Apple Silicon (M1/M2/M3/M4):** `dist/GETSSH-1.2.1-arm64.dmg` 
* 💻 **Intel Chip (老款 Mac):** `dist/GETSSH-1.2.1.dmg` 

> ⚠️ **关于 macOS 版本的终极建议与停更预警 (Deprecation Warning):**
> 我们强烈建议所有 Mac 用户尽快向 **Apple Silicon (M系列芯片)** 硬件平台迁移。根据 Apple 的官方通告，**macOS 27 将是最后一个支持 Rosetta 2 翻译层以及 Intel 芯片硬件的版本**。在后续的 macOS 28 暂停更新计划及底层架构彻底转向后，Intel 架构的 GETSSH 极大概率将面临无法运行的底层兼容性问题。因此，在苹果正式切断支持后，**我们将无限期停止对 macOS Intel 版本 GETSSH 的维护与发版**。

**3. Linux 阵营 (免安装便携版)**
* 🐧 **x64:** `dist/GETSSH-1.2.1.AppImage`
* 🐧 **ARM64:** `dist/GETSSH-1.2.1-arm64.AppImage`

*(注：全平台已拆分，请根据您的真实 CPU 架构下载对应的包以获得最极致的性能，体积大幅缩小。)*

## 🔮 Roadmap 剧透：WebSSH 与一鱼两吃

许多开发者问我们：GETSSH 的终极形态是什么？
在这里我们可以正式透露：目前 1.x 系列乃至未来的 2.0（插件版）疯狂进行底层解耦，**最终目的是为了在 2.0 时代之后，推出 GETSSH 的 WebSSH / 私有堡垒机版本！**

凭借完全抽象的核心无头引擎（Headless Core），我们计划在未来将 GETSSH 打包为一个极小的 Docker 镜像。你只需一句 `docker run` 部署在没有显示器的 VPS 上，即可在任何设备的浏览器中，获得与桌面端完全一致的极致终端与插件体验。

**“罗马不是一天建成的，但我们的 AI 牛马正在全天候施工。”**
去下载体验吧，感受这个的现代化工具带来的纯粹生产力！