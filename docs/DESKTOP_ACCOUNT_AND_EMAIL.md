# 旧账号数据保留说明

Phase 1 已移除账号服务、登录界面、会员限制和 account IPC。`SNIPVIA_CONSOLE_ORIGIN` 与 `MAIN_VITE_CONSOLE_ORIGIN` 不再读取。

旧 `userData/account/session.json` 不读取、不解密，也不自动删除；`account` 目录继续受到 Agent 文件访问保护。原模型 Key、历史、笔记和日程继续使用原位置。私有服务端与原账号实现保存在私有仓库及本地迁移快照。

旧安装包仍可能要求账号，不能因新源码免登录就立即停用生产服务。新免费版的发布、更新过渡和停服需后续单独确认。[Phase 1 报告](opensource/PHASE1_REPORT.md) 记录验收与回滚。
