# macOS 构建与正式分发入口

- 开发：pnpm dev；固定开发应用与录屏权限见[开发说明](DEVELOPMENT.md)。
- 编译：pnpm build。
- 无签名应用目录：electron-builder.macos-validation.cjs；禁止启用生产自动安装更新。
- 正式配置：electron-builder.macos-release.cjs，配合 scripts/macos-release/ 的 preflight、签名、公证、产物与元数据验证。
- 正式执行入口为 node scripts/macos-release/release.cjs --execute；这会执行签名和 Apple 公证，必须在获得明确授权后运行，本轮没有执行。
- release:publish 也保留执行开关，不把构建成功视为推送或正式发布授权。

App ID 保持 com.snipvia.desktop，产品包名 Snipvia，macOS 最低 14。图标源、entitlements 和原生 Helper 均为构建输入，不能当作闲置资源删除。Apple Silicon 与 Intel 需要分别验证，不能推断真机结果。

旧临时朋友体验包、跨平台 assemble 入口及固定旧版本更新实验已移除；正式签名、公证与发布工具保留。本轮没有执行这些发布操作。[分发状态](RELEASE_DISTRIBUTION.md)。
