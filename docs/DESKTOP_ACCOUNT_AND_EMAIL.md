# 桌面账号兼容边界

本轮仅分离代码，没有改变账号、会员检查和预测逻辑。默认来源仍由 `src/main/account/AccountService.ts` 决定；开发环境允许本机 HTTP，打包应用只接受 HTTPS 构建配置。客户端 Cookie 由主进程加密存储，不暴露给 Renderer。

服务端、邮件配置、部署说明及本文迁移前版本已完整保留在私有候选。桌面构建不再需要服务端源码或数据库；测试通过 `tests/helpers/account-fixture.ts` 使用合成 HTTP 响应，不能代替私有工程的真实认证安全测试。

无需登录的目标与服务停用顺序仍按 [重构方案](opensource/REFACTOR_PLAN.md) 待后续确认实施。当前不要据此停用生产账号服务。[本轮分离报告](opensource/SEPARATION_REPORT.md) 记录验证与回滚。
