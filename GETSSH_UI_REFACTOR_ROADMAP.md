# GETSSH 3.0 UI 优化与重构路线图 (MOOVIER SUPREME)

基于 `MOOVIER_UI_ARCHITECTURE_PROPOSAL_CN.md` 视觉架构规范，以下是将概念转化为工程代码的详细实施路线图。我们将遵循“由底层到表层”的原则，逐步替换掉 v2.0 的旧视觉体系。

## Phase 1: 基底重构 (Liquid Glass & Absolute Grid)
**目标**：抛弃伪造的 CSS 模糊，接入操作系统真实的物理材质；确立全屏幕绝对网格秩序。
*   **1.1 原生材质接入**：在 Electron 主进程（`windowHandler.ts`）中，根据操作系统注入原生材质。macOS 开启 `Vibrancy`（如 `fullscreen-ui`），Windows 开启 `Mica`。
*   **1.2 全局透明度变量系统**：在前端建立 CSS 变量系统（`--glass-transparency`, `--glass-tint-opacity` 等），取代写死的背景色。
*   **1.3 绝对网格对齐**：清理侧边栏、状态栏和主内容区之间多余的 `margin` 和 `padding`，实现真正的“边缘抵达（Edge-Flush）”。移除不必要的全局 `border-radius`。

## Phase 2: 物理光影雕刻 (Physical Shading & Rim Lighting)
**目标**：将所有面板从“容器”升级为“漂浮的磁贴（Tiles）”，赋予其质量感和光影折射。
*   **2.1 剔除 CSS 边框**：全局搜索并移除面板元素的 `border: 1px solid`。
*   **2.2 实现定向边缘高光（Rim Light）**：基于左上方 45° 虚拟光源，使用 `box-shadow: inset` 编写顶边和左边的半透明白色高光，以及右边的深色暗影。
*   **2.3 复合阴影构建**：为磁贴实现 3 层堆叠外阴影（近场轮廓、中场漫射、远场环境），彻底与背景“剥离”。

## Phase 3: 镜头级景深调度 (Cinematic Focus Pulling)
**目标**：实现“影院熄灯”般的沉浸感，引导用户注意力。
*   **3.1 状态管理**：在 Zustand 中扩展状态记录当前的“主焦点磁贴 ID (`focusTileId`)”。
*   **3.2 降压渲染逻辑**：当存在焦点磁贴时，动态为其他非焦点磁贴附加 `brightness(0.6)`、`saturate(0.5)` 和 `blur(0.6px)` 的 CSS 滤镜。
*   **3.3 豁免机制**：确保侧边栏、状态栏和重要的安全告警不受景深模糊的影响。

## Phase 4: 物理弹簧动效重构 (Spring Physics)
**目标**：消除所有的“硬切”和生硬的线性动画，引入具备真实惯性的物理反馈。
*   **4.1 引入 Framer Motion**：在关键组件（磁贴、按钮）中应用 `framer-motion`。
*   **4.2 悬浮与按压反馈**：配置标准化弹簧参数（`SPRING_SNAPPY`、`SPRING_FLUID`）。实现 Hover 时的轻微上浮（`translateY(-2px)`）和阴影扩散，以及 Active 时的下压形变（`scale(0.98)`）。
*   **4.3 场景切换平滑化**：将路由切换或 Tab 切换的硬切，替换为包含透明度和微量缩放的定制贝塞尔曲线（`CINEMATIC_IN/OUT`）。

## Phase 5: 极端环境可读性防御 (Readability Defense)
**目标**：保证在任何透明度和桌面壁纸下，核心代码和日志依然清晰可读。
*   **5.1 终端专属暗色滤镜**：为 xterm.js 容器底层强制叠加一层不透明度不低于 `30%` 的黑色遮罩。
*   **5.2 联动透明度补偿**：当全局透明度滑块被调高时，反向微调暗色遮罩的浓度，确保 WCAG 对比度达标。

---

> **实施建议**：我们可以挑选一个核心组件（例如**主终端磁贴 (Terminal Tile)** 所在的面板容器）作为切入点，先进行 Phase 1 和 Phase 2 的光影重构。验证效果满意后，再全面铺开。
