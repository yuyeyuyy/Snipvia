# Snipvia（截然）

轻量、本地优先的截图工具。当前稳定版为 [1.0.0](https://github.com/yuyeyuyy/Snipvia/releases/tag/v1.0.0)：不需要账号、模型或 API Key，主窗口是设置中心。

| 快捷键（新安装默认） | 当前行为 |
| --- | --- |
| Ctrl+1 | 框选后直接复制到剪贴板 |
| Ctrl+2 | 框选一次，加入右上角截图收纳区 |
| Ctrl+Shift+2 | 打开、展开或收起收纳区 |
| Alt+2 | 确认后清空收纳区 |
| Ctrl+3 | 框选后编辑、复制、保存或贴图 |

已有自定义快捷键继续保留，以设置页面实际显示为准。收纳区采用无边框透明图堆，点击展开、再点图片放大，按钮悬浮显示；保留单张复制、全部独立原图复制、逐项删除、原图文件拖出、Alt 拖动排序、选中子集、纵向合并复制和独立 PNG 导出。收纳仅在本次应用运行内保留，最多 32 张 / 256 MiB；满额明确提示，不静默淘汰。

复制成功后，可选显示快速切换条，前往常用应用或网页。macOS 支持 Chrome 已有标签匹配与可选的输入框聚焦，需要对应系统权限；不会自动粘贴或发送。设置采用左侧分类菜单，支持浅色、深色与系统主题。

## 本地运行

使用 Node.js 24.15.x 和 pnpm 11.1.3：

~~~sh
pnpm install --frozen-lockfile
pnpm electron:install
pnpm dev
~~~

macOS 启动固定的 `~/Applications/截然 Dev.app`，开发数据使用独立目录。首次截图按权限引导授权；详情见[开发说明](docs/DEVELOPMENT.md)。Windows 使用 `pnpm dev:raw`。

## 阅读与 review

- [代码 review 导航与清理记录](docs/review/CLEANUP_REVIEW.md)
- [当前项目结构](docs/PROJECT_STRUCTURE.md)与[架构](docs/TECHNICAL_DESIGN.md)
- [产品范围](docs/PRD.md)、[路线与验收保留项](docs/ROADMAP.md)
- [隐私边界](docs/PRIVACY.md)、[界面规范](docs/UI_DESIGN_LANGUAGE.md)
- [透明图堆与截图性能优化记录](docs/v2/TRANSPARENT_SHELF_REPORT.md)
- [Phase 2 实际验收报告](docs/v2/PHASE2_CONTINUOUS_CAPTURE_REPORT.md)
- [参与开发](CONTRIBUTING.md)、[安全报告](SECURITY.md)

## 验证与当前边界

~~~sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:smoke
~~~

当前截图与透明图堆优化的验证、性能样本和未验收范围见[最新记录](docs/v2/TRANSPARENT_SHELF_REPORT.md)。原 Phase 2 的 227 项单测包含现已移除的 V1 模块测试，清理范围见 review 记录。Windows 真机及实际多屏/混合 DPI 尚未完成验收；历史指标保留在[原始指标汇总](docs/v2/PHASE2_METRICS_SUMMARY.json)，不作为当前版本的实测结果。

V2 没有 AI 对话、Agent、笔记编辑、账号、订阅或模型调用。旧历史、日程和笔记目录仅通过设置页只读查看、显式导出及截图导入；不能把历史兼容代码误认为仍提供旧产品功能。旧配置仅读取快捷键与主题，模型、凭据和日程 schema 已退出当前依赖图。

## 分发与许可

[v1.0.0 已发布](https://github.com/yuyeyuyy/Snipvia/releases/tag/v1.0.0)：[macOS Apple Silicon](https://github.com/yuyeyuyy/Snipvia/releases/download/v1.0.0/Snipvia-1.0.0-arm64.dmg)、[macOS Intel](https://github.com/yuyeyuyy/Snipvia/releases/download/v1.0.0/Snipvia-1.0.0-x64.dmg)、[Windows x64](https://github.com/yuyeyuyy/Snipvia/releases/download/v1.0.0/Snipvia-Setup-1.0.0-x64.exe)。macOS 已签名并公证；Windows 安装、运行、卸载回归通过，安装包尚未签名，保留手动更新。

完整结果、公开文件哈希及已知限制见[发行记录](docs/review/V1_0_0_RELEASE.md)。本机 SCK 原生截图专项仍有超时，客户端会自动回退 Electron；连续截图人工试用正常，不能据此声称原生路径已通过。Electron 与构建依赖的修复见[安全记录](docs/review/V1_0_0_SECURITY_FIX.md)。更新使用独立 GitHub Release 渠道；旧 v0.3.2 与 V1 AI 客户端发行资产保留。

源码采用 [Apache License 2.0](LICENSE)，保留 [NOTICE](NOTICE)、[第三方声明](THIRD_PARTY_NOTICES.md)和[素材来源](docs/opensource/ASSET_PROVENANCE.md)。
