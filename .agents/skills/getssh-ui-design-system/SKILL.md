---
name: getssh-ui-design-system
description: >-
  GETSSH 官方 UI 设计系统与视觉规范 (GETSSH Official UI Design System).
  用于统一客户端软件 (Electron/Desktop) 与 网页端 (Web/Landing/Docs/Cloud) 的视觉风格、设计 Tokens、组件标准与动效规范。
---

# GETSSH UI 设计系统规范 (Web & Desktop 统一化标准)

本文档是 GETSSH 项目官方的 **UI/UX 视觉设计系统与规范 (Design System)**。无论是构建桌面客户端界面、Web 官网、管理后台、文档站还是移动端响应式页面，所有前端开发者与 AI 助手必须严格遵循本规范，保证 **网页端与客户端的一致性、极客美学与工业级品质**。

---

## 🎨 1. 核心设计哲学 (Core Philosophy)

* **极客未来感与工业质感 (Cyberpunk Precision + Industrial Solidity)**：
  摒弃廉价与平庸的默认控件，采用深邃黑金/赛博霓虹的深色模式与纯净通透的浅色模式，结合精细的像素级发光与内凹光泽。
* **高阶毛玻璃与物理层级 (Glassmorphism & Depth Layers)**：
  采用深色通透毛玻璃（`backdrop-blur-xl` + 半透明黑色背景），辅以微弱的 `1px` 内部高光，营造如 Apple Pro 级别的层次感。
* **动效呼吸感 (Spring Fluid & Micro-Interactions)**：
  所有卡片、按钮和悬浮窗具备微弹性响应（`hover:scale-[1.02] active:scale-[0.98]`）与平滑渐变映射，严禁生硬突兀的无动画状态切换。

---

## 🌈 2. 色彩系统与设计 Tokens (Design Tokens)

### 2.1 基础基底色 (Base Canvas)

| 模式 | 背景色类名 | HEX / HSL | 语义用途 |
|---|---|---|---|
| **深色底座 (Dark Void)** | `bg-[#0B0C10]` / `bg-[#12131C]` | `#0B0C10` | 软件主视口、背景画布 |
| **深色面板 (Dark Panel)** | `bg-white/[0.03]` / `bg-black/40` | `rgba(255,255,255,0.03)` | Bento 卡片、侧边栏底色 |
| **浅色底座 (Light Canvas)** | `bg-slate-50` / `bg-[#F8FAFC]` | `#F8FAFC` | 浅色模式主画布 |
| **浅色面板 (Light Panel)** | `bg-white` / `bg-white/80` | `#FFFFFF` | 浅色模式卡片底色 |

### 2.2 DuoTone 双色主题动态变量 (CSS Variables)

GETSSH 采用独特的 DuoTone 双色主题引擎，所有主题驱动变量如下：
```css
:root {
  --color-a: 0 212 255;       /* 主强调色 A (RGB) */
  --color-b: 168 85 247;     /* 辅助强调色 B (RGB) */
  --primary-color: var(--color-a);
}
```

### 2.3 核心功能中枢专属配色 (Functional Accents)

每个核心功能模块具备专属的视觉标识色，在 Web 和软件中必须统一：

* 🛡️ **安全中心 (Secure Center / RASP)**: **Emerald 翠绿** (`#10B981`, `text-emerald-400`, `bg-emerald-500/20`)
* ⚡ **AI 调度中心 (AI Center / Agent)**: **Amber 琥珀金** (`#F59E0B`, `text-amber-400`, `bg-amber-500/20`)
* 🌐 **工作区中心 (Workspace Center)**: **Purple 紫罗兰** (`#A855F7`, `text-purple-400`, `bg-purple-500/20`)
* 🧩 **插件中心 (Plugin Center)**: **Rose 玫红** (`#F43F5E`, `text-rose-400`, `bg-rose-500/20`)
* 🚀 **全局调度 (Command Center / ⌘K)**: **Blue 科技蓝** (`#3B82F6`, `text-blue-400`, `bg-blue-500/20`)
* 🛸 **悬浮助手 (Floating AI / Capsule)**: **Cyan 荧光青** (`#06B6D4`, `text-cyan-400`, `bg-cyan-500/20`)

---

## 🪟 3. 毛玻璃与圆角系统 (Material Elevation)

### 3.1 质感规范 (Surface & Border)

```css
/* 标准深色卡片容器规范 */
.getssh-glass-card {
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(24px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 20px 40px rgba(0, 0, 0, 0.4);
}
```

### 3.2 圆角等级 (Border Radius Hierarchy)

* **Pill 胶囊 (Full)**: `rounded-full` 用于状态药丸、搜索框、输入胶囊。
* **大中枢 / 弹窗 (Super Large)**: `rounded-[32px]` 用于全屏 Modal、主功能大卡片。
* **Bento 磁贴 (Large)**: `rounded-2xl` / `rounded-[24px]` 用于仪表盘磁贴、面板容器。
* **基础控件 (Medium)**: `rounded-xl` (12px) 用于常规按钮、输入框、下拉框。
* **微型标签 (Small)**: `rounded-md` / `rounded-lg` 用于代码块、快捷键徽标（`<kbd>`）。

---

## ✍️ 4. 字体与排版标准 (Typography Hierarchy)

* **UI 界面主字体**: `Inter`, `-apple-system`, `BlinkMacSystemFont`, `PingFang SC`, `system-ui`
* **终端 / 代码 / 数据主字体**: `"Fira Code"`, `Consolas`, `Monaco`, `monospace`
* **小标题与状态标签 (Section Badges)**:
  ```html
  <span class="text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">
    STATUS: ONLINE
  </span>
  ```

---

## 🧩 5. 核心标准组件模版 (Standard Component Blueprints)

### 5.1 标准 Bento 磁贴卡片 (Dashboard Tile)

```tsx
<div className="group relative overflow-hidden p-6 rounded-[24px] bg-black/40 border border-white/10 shadow-2xl backdrop-blur-xl transition-all duration-300 hover:scale-[1.02] hover:border-primary/40 cursor-pointer">
  {/* 悬浮呼吸发光背景 */}
  <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
  
  <div className="relative z-10 flex items-center justify-between">
    <div className="w-10 h-10 rounded-xl bg-primary/20 text-primary flex items-center justify-center">
      <Sparkles className="w-5 h-5" />
    </div>
    <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-white/10 text-white/60">
      ACTIVE
    </span>
  </div>

  <div className="relative z-10 mt-6">
    <h3 className="text-lg font-black tracking-tight text-white mb-1">MODULE TITLE</h3>
    <p className="text-xs text-white/50 leading-relaxed font-medium">Clear description of the functional module.</p>
  </div>
</div>
```

---

### 5.2 标准输入框与交互按钮 (Input & Button Standards)

```tsx
/* 1. 主行动按钮 (Primary Action Button) */
<button className="px-6 py-3 rounded-xl font-bold text-sm text-white bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] flex items-center gap-2">
  <Send className="w-4 h-4" /> Connect Now
</button>

/* 2. 次级毛玻璃按钮 (Glass Secondary Button) */
<button className="px-6 py-3 rounded-xl font-bold text-sm text-white/80 bg-white/5 hover:bg-white/10 border border-white/10 transition-all duration-200 flex items-center gap-2">
  Cancel
</button>

/* 3. 标准毛玻璃输入框 (Glass Input Field) */
<input 
  type="text" 
  placeholder="Enter host..."
  className="w-full px-4 py-3 bg-black/40 border border-white/10 rounded-xl text-sm text-white placeholder:text-white/30 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
/>
```

---

### 5.3 苹果式平滑开关 (Apple-style Toggle Switch)

```tsx
<button
  onClick={() => setEnabled(!enabled)}
  className={`relative w-12 h-6 rounded-xl border transition-colors duration-300 ${
    enabled 
      ? 'bg-emerald-500 border-emerald-400' 
      : 'bg-white/10 border-white/10'
  }`}
>
  <div className={`absolute top-1 left-1 bg-white shadow-md w-4 h-4 rounded-xl transition-transform duration-300 ${
    enabled ? 'translate-x-6' : 'translate-x-0'
  }`} />
</button>
```

---

## 🎬 6. 动效与过渡规范 (Motion & Transitions)

* **统一缓动曲线**:
  - `transition-all duration-200 ease-out` 用于微交互（按压、悬停高亮）。
  - `transition-all duration-500 ease-in-out` 用于全页背景色平滑变换、展开折叠。
* **Framer Motion 弹簧标准**:
  ```tsx
  <motion.div
    initial={{ opacity: 0, scale: 0.95, y: 10 }}
    animate={{ opacity: 1, scale: 1, y: 0 }}
    exit={{ opacity: 0, scale: 0.95, y: 10 }}
    transition={{ type: "spring", stiffness: 350, damping: 25 }}
  >
    {/* 内容 */}
  </motion.div>
  ```

---

## 🌐 7. 网页端 (Web) 与客户端 (Desktop) 统一化指南

1. **共享 Design Tokens**: 网页端必须引用相同的 DuoTone 调色板与暗黑背景色规范。
2. **响应式断点统一**:
   - `sm: 640px`
   - `md: 768px` (iPad / 侧边栏自动折叠)
   - `lg: 1024px` (标准桌面)
   - `xl: 1280px` (宽屏/多窗口分屏)
3. **平台差异优雅降级**:
   - 客户端（Electron）：支持原生 OS Vibrancy 毛玻璃、窗口拖拽区（`drag-region`）、无边框 Traffic Lights。
   - 网页端（Web）：通过纯 CSS `backdrop-filter: blur(20px)` 模拟毛玻璃效果，顶部替换为极简 Web 导航栏，保证两者 1:1 视觉克隆。
