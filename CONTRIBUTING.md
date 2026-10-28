# 参与开发

Snipvia 桌面核心免费、本地优先、无需账号。请基于当前独立客户端工程工作；后台、官网和管理系统不属于本仓库构建输入。

使用 Node.js 24.15.x 和 pnpm 11.1.3：

```sh
pnpm install --frozen-lockfile
pnpm electron:install
pnpm dev
```

提交前执行 `pnpm lint`、`pnpm typecheck`、`pnpm test` 和 `pnpm build`；涉及窗口、IPC 或存储时运行 `pnpm test:smoke`。测试使用临时数据与合成截图，不提交真实用户数据、Key 或证书。真实录屏与安装包条件用例须单独记录，跳过不算通过。

Main 持有系统权限与本地图片数据；Preload 只增加必要的窄接口，IPC 同时检查输入和调用窗口。保留 IPC 参数校验、截图会话隔离、文件访问限制和旧数据保护。Renderer 沿用 [两套界面语言](docs/UI_DESIGN_LANGUAGE.md)，不新增第三套页面骨架。

PR 说明问题、改变后的行为、验证结果和未验证的平台；UI 改动附合成数据截图。依赖保持固定版本并保留锁文件。不要提交 `.env`、用户目录备份、生产日志、安装包或生成的依赖目录。

贡献者应有权提交相应内容，并按本项目 Apache License 2.0 提交原创贡献；第三方内容保留来源、许可和原始通知。此说明不要求版权转让，也不能替代第三方授权。安全问题先阅读 [SECURITY.md](SECURITY.md)。
