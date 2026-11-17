---
name: getssh-files-trust-ui
description: Design or review the GETSSH SFTP panel, host key prompts, and related desktop security dialogs.
---

# GETSSH 文件管理与主机信任

先读相邻的 `getssh-ui-foundations/SKILL.md`。文件区借鉴参考图 3 的身份、路径、工具条、目录表层级，在会话内停靠显示。文件入口只属于可见、已连接且允许 SFTP 的当前 SSH 分屏。标明当前服务器，只显示已有协议数据。用对齐的表头和等宽路径帮助扫描；加载、空目录、失败和截断是不同状态。切换服务器须清空旧目录和列表。

参考图 7 的信任弹窗用紧凑的事实表分别显示目标、已有指纹和新指纹等实际可用字段；长指纹可换行和选取。首次见到与已知指纹变更区分风险。动作标签写后果，保留取消、现有默认和验证流程。界面修改不改变授权范围、工作区隔离、密钥信任或 IPC。

检查短指纹和长指纹、窄窗、键盘操作、服务器 A/B 切换和非 SSH 会话。文件测试用模拟目录或隔离测试端点。
