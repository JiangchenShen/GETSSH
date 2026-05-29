# GETSSH 工作区 (Workspace) 架构演进提案

为了满足高级用户和未来团队协作的需求，GETSSH 计划引入 **Workspace（工作区）** 的概念。工作区不仅仅是视觉上的标签分类，而是一个**完全隔离的上下文环境 (Isolated Context)**。

---

## 1. 核心设计理念：完全隔离

通过彻底的数据物理隔离，让不同的工作区拥有互不干扰的生态：
- **独立的服务器资产**：工作区 A (如“公司生产环境”) 和工作区 B (如“个人项目”) 的 SSH 连接配置、目录标签完全隔绝。
- **独立的凭据金库**：不同工作区使用不同的加密密钥（Vault Key），防止个人密码泄露至团队环境。
- **独立的插件实例**：监控插件在“开发工作区”和“生产工作区”收集的数据完全隔离；某些高危插件可以在敏感工作区被强制禁用。
- **独立的视觉标识**：支持为不同工作区设置独立的顶栏颜色（如红色代表生产，蓝色代表开发），防止用户在多窗口间切错环境。

---

## 2. 存储模型改造 (Storage Architecture)

我们目前的存储模型是全局平铺的。引入 Workspace 后，物理文件结构将演进为基于“作用域 (Scope)”的目录树架构：

```text
~/.getssh/
├── app-config.json          # 全局配置：记录所有 workspaces 列表、当前选中项、UI字体等
├── plugins/                 # 全局插件库：插件代码只有一份，所有工作区复用
└── workspaces/
    ├── default-workspace/   # 默认工作区 (自动迁移现有数据)
    │   ├── profiles.json    # 主机配置
    │   ├── known_hosts      # SSH 信任指纹
    │   └── storage.db       # 插件存储 (ctx.storage)
    └── prod-workspace/      # 用户自建的生产工作区
        ├── profiles.json
        ├── vault.key        # 独立的密钥库文件
        └── storage.db
```

### 插件存储的双键隔离
插件存储 `ctx.storage` 必须从目前的 `[pluginId]` 单主键隔离，升级为 `[workspaceId + pluginId]` 的联合主键隔离，或者直接将 SQLite/JSON 库分散到各自工作区的目录中。

---

## 3. UI/UX 交互层改造 (Frontend React)

1. **左侧工作区切换栏 (Workspace Switcher)**
   - 在现有的左侧边栏（导航图标区）的最左侧，再增加一条极窄的工作区快速切换栏（参考 Discord 的 Server 列表或 Slack 的多工作区侧边栏）。
   - 每个工作区用一个方形的颜色块或首字母图标表示。

2. **状态机重建 (Zustand Stores)**
   - `sessionStore` 和 `profileStore` 需要具备上下文切换能力。
   - 切换工作区的过程必须是原子的、阻塞的：
     ```typescript
     // 伪代码：切换工作区生命周期
     async function switchWorkspace(newWorkspaceId) {
       // 1. 拦截警告并关闭当前工作区的所有终端/SFTP Tab
       await sessionStore.closeAll();
       
       // 2. 通知主进程重定向底层数据读取路径
       await electronAPI.switchWorkspace(newWorkspaceId);
       
       // 3. 重新加载目标工作区的资产
       profileStore.reload();
       
       // 4. 应用目标工作区的专属颜色主题
       appStore.applyWorkspaceTheme();
     }
     ```

---

## 4. 商业化与未来演进：团队协作 (Team Workspace)

架构在设计之初就应考虑到云端协同。Workspace 本质上是一个“配置集合包”。
未来，如果 GETSSH 推出云同步或企业版，可以引入 **Team Workspace (团队工作区)**：

- **配置下发**：团队成员通过邀请码加入后，GETSSH 会在本地生成一个锁定的 Workspace。
- **只读资产**：团队工作区内的 `profiles.json` 从云端拉取，本地无法修改；管理员可以在云端撤销某台机器的访问权限。
- **强制插件策略**：管理员可设定该工作区必须强制加载特定的企业安全审计插件。
