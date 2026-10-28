# GitHub 版本检查与更新

当前实现：src/main/updates/UpdateCheckService.ts、ElectronUpdateInstaller.ts、shared/updates.ts 和设置页 UpdateSettings.tsx。发布源以 src/shared/release-source.json 为准，当前为 yuyeyuyy/Snipvia。

检查不依赖账号、官网、旧服务端或模型 Key。正式包可延迟后台检查，设置页手动检查共享状态；说明使用安全 Markdown，不加载远程图片或原始 HTML。失败返回可见错误，不阻止截图与本地数据。

下载安装依赖包体、平台与 snipviaAutoUpdate 开关。签名 macOS 正式包在用户点击下载和“重启并更新”后执行安装；开发/验证包不擅自启用安装更新。发布脚本保留 hash、签名、公证、元数据和资产检查。

当前自动测试是 tests/unit/updates.test.ts、update-installer.test.ts 及 tests/integration/updates.spec.ts。历史 0.2.1→0.2.2 的独立签名更新实验依赖旧 AI 笔记 UI，不作为 V2 当前验收；相关源码的后续处理见[review 清单](review/CLEANUP_REVIEW.md)。本次未运行签名、公证、下载或远程更新。
