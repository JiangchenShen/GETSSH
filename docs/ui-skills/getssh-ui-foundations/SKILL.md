---
name: getssh-ui-foundations
description: Apply the desktop GETSSH visual system to shared colors, controls, typography and layout. Use for GETSSH-wide UI work or cross-screen review.
---

# GETSSH 桌面界面基础

参考图提供布局和信息层级。保留 GETSSH 标志、墨色与海绿色，以及现有外观和终端配色设置。浅色用淡灰画布和白色导航、表格；深色用近黑画布和略亮一阶的条栏。用细线分隔区域，弹窗才用明显的遮罩和阴影。语义色描述状态，选中和主操作共用强调色。

使用 `apps/getssh-client/src/index.css` 的共享颜色。`bg` 是画布，`panel` 是导航或工具条，`surf` 是卡片或抬升层，`surf-2` 是输入和次级控件，`line` 与 `line-soft` 区分边界。普通文字用 UI 字体，地址、路径、指纹和终端输出用等宽字体。行内控件约 6–8px 圆角，弹窗约 12–16px。用边线和底色交代选中、悬停和危险状态，保留键盘焦点。

改变布局时保留功能及其归属。仅显示真实数据，状态不明要明确，保持中英文、深浅色和窄面板可用。用隔离的 Electron 环境验证，用户预览走 `pnpm dev`。

- 首页、主机列表和地图使用同目录的 `getssh-home-ui`。
- 会话外框、标签、分屏使用 `getssh-terminal-ui`。
- 文件与连接信任使用 `getssh-files-trust-ui`。
- 设置、工作区、插件、AI、连接编辑使用 `getssh-management-ui`。
