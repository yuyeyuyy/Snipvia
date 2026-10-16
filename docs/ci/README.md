# Windows 发布验证模板

2026-10-10 新增实际工作流文件 [windows-internal.yml](../../.github/workflows/windows-internal.yml)。只支持手动触发，使用 Windows Server 2022 x64 runner 执行固定依赖安装、lint/typecheck、平台单元测试、NSIS 构建与内容校验、合成截图流程、临时目录安装、安装版冒烟及卸载。它使用 `pnpm dist:windows`，每次输出到独立的 `dist/windows-internal/internal-*` 目录；默认不上传产物，不创建 Release。

本次只准备了文件，未推送、未触发 Actions。推送与远程运行需要项目所有者明确批准；只有另行批准上传时才勾选 `upload_internal_artifacts`。Runner 的安装冒烟即使通过，也不能替代 Windows 10/11 混合 DPI 和多显示器真机检查。当前证据与产物见 [Windows 构建报告](../WINDOWS_BUILD_REPORT.md)。

[`windows-release.yml`](windows-release.yml) 保留了 Windows runner 的适配测试、EXE 构建、静默安装及安装版冒烟流程。

v0.2.0 发布时，现有 GitHub CLI 凭据未获得 `workflow` 权限，因此此模板尚未作为 Actions 工作流启用，不能据此声称完成真实 Windows 安装验收。

获得仓库工作流写入权限后，将此文件复制到 `.github/workflows/windows-release.yml`，提交并推送，在 GitHub Actions 页面手动运行。它仅请求读取仓库，不需要生产账号、模型 Key 或签名密钥。测试使用临时目录、合成截图和本机模拟账号。

安装版测试入口是 `tests/integration/windows-release.spec.ts`；也可在 Windows 开发环境安装本版 EXE 后指定 `SNIPVIA_TEST_APP_BINARY` 执行。混合 DPI、多显示器、受保护内容和安全软件兼容性仍需额外真机检查。
