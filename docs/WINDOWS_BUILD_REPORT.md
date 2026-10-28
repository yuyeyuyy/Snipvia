# Windows 当前构建与验收边界

当前入口为 pnpm dist:windows，配置 electron-builder.windows.yml，校验工具 scripts/verify-windows-build.mjs。Windows 图标使用 UI/Snipvia-Win-transparent.ico；保留原稿、NSIS、PE、ASAR 与 hash 检查工具。

Windows 使用 Electron 截图适配，不启动 Swift Helper。当前有坐标/缩放逻辑测试与 tests/integration/windows-capture-ui.spec.ts 的 Renderer 仿真；不代表真实 Windows 安装、系统权限、自启、混合 DPI 和完整收纳流程已通过。

.github/workflows/windows-internal.yml 已改为当前全量单测及 V2 合成桌面测试，移除指向不存在测试的旧安装/卸载流程。测试启动开发构建，不能作为安装后的验收证据；本轮未触发远程 CI，未打包或上传安装包。[清理记录](review/CLEANUP_REVIEW.md)。
