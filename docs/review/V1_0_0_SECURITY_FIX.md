# v1.0.0 安全修复与发行准备

日期：2026-10-30。基于功能基线 `d377977`，工作区 `Snipvia-public-baseline`。本记录更新[上一轮审查](V1_0_0_REVIEW.md)中的依赖阻断结论；旧报告和旧审计 JSON 保留为历史证据。

## 已解除的安全阻断

| 组件 | 原版本 | 当前锁定版本 | 修改位置 |
| --- | --- | --- | --- |
| Electron | 44.4.1 | 44.9.1 | `package.json`、`pnpm-lock.yaml` |
| Vite | 7.3.6 | 7.3.7 | 同上 |
| Vitest 与配套 mocker | 4.1.11 | 4.1.12 | 同上 |
| undici 6.x / 7.x | 6.28.1 / 7.29.1 | 6.29.1 / 7.30.1 | 既有上游允许范围内更新锁文件 |
| fast-uri | 3.1.8 | 3.1.9 | `pnpm-workspace.yaml` 的既有安全 override 与锁文件 |

完整 `pnpm audit --json` 为 **0 high / 0 moderate / 0 low / 0 critical**，覆盖 615 个生产、开发及可选依赖记录；见[升级后审计](V1_0_0_DEPENDENCY_AUDIT_AFTER.json)。这次包含随安装包分发的 Electron，没有用 `--prod` 排除它。

Electron 官方包已安装，实际 `dist/version` 为 44.9.1。官方归档由原 `@electron/get` 使用 npm 包内置 SHA-256 校验；没有关闭 TLS、修改供应方校验和或使用旧二进制冒充新版本。没有升级到其他主版本，没有新增依赖或修改截图、IPC、AI、旧数据与存储逻辑。

## 验证结果

- Node 24.15.0、pnpm 11.1.3；冻结锁文件安装成功。
- `pnpm lint`、`pnpm typecheck` 通过。
- Vitest 4.1.12：51 个文件、291 项单测通过（含新增的 3 项 Windows 构建命令回归）。
- `pnpm build` 通过；依赖许可证记录为 122 个生产版本，0 个缺少许可证文件。
- Electron 44.9.1 完整集成回归：31 通过、13 按环境条件未执行。原先的真实屏幕/耐久/正式包专项为 12 项，新增 1 项仅在已安装 Windows 客户端上执行。
- 首次升级后的离屏收纳重启测试曾超时，未删除或放宽断言；专项诊断重跑和无诊断改动的完整回归均通过。没有把这次超时称为已经证明的业务缺陷或已定位的产品修复，后续若复发应保留启动阶段诊断继续追查。
- 另将 `v2-continuous.spec.ts` 中两种主题的合成截图输出移入 `test-results/v2-shelf/`，避免测试改写已跟踪的文档图片；相关合并/导出测试单独通过。原文档图片已从基线恢复。
- 双架构 Helper 重建、截图协议及浏览器 worker 检查通过。新 Electron 的真实剪贴板专项验证 3 张合成图片的原文件字节、数量、退出后读取及原剪贴板恢复通过；没有记录用户剪贴板内容。Windows CI 与正式安装包另行核对，不以 Renderer 通过代替平台验收。

## 开发运行时与回滚

升级前正常退出本项目开发进程。固定 `~/Applications/截然 Dev.app` 已通过现有 `pnpm dev:prepare` 重建为 Electron 44.9.1，并完成代码签名完整性验证；仍使用 `com.snipvia.desktop.dev`、既有图标、权限用途声明和原开发数据目录。

旧开发 App 与原 package/锁文件在 `.dev-runtime/v1-security/before-20261030/`，没有删除。没有重置 TCC、修改系统授权数据库或清空用户数据。运行时变更后 macOS 仍可能要求本人确认权限；旧授权记录不能被宣称已自动迁移。源码回滚使用 `d377977` 这一可恢复基线；开发 App 备份不包含用户数据或正式密钥。

## Windows 安装验收补齐

`.github/workflows/windows-internal.yml` 继续使用只读仓库权限和显式手动触发，新增临时用户目录的静默安装、`windows-release.spec.ts` 已安装客户端测试与始终执行的卸载清理。

新增测试核对实际运行时/产品版本、x64、图标、临时 userData、默认快捷键、窄 Preload API 与 Renderer 不暴露 Node；用合成帧验证设置、取消截图、Quick 复制、Collect 收纳。不会读取用户屏幕、原配置、账号或模型服务。旧版 AI/Agent/笔记测试没有重新引入。

第二次 CI 已通过全部 288 项原单测，随后发现 Windows 无法用 `execFileSync` 直接启动 pnpm 的 `.cmd` 入口。`prepare-release-build.mjs` 现通过当前 Node 执行活动 pnpm CLI 文件，保留字面参数数组，不启用 shell；新增测试覆盖空格路径、特殊字符参数和无效入口拒绝。

Windows 首次 CI 暴露 7 项跨平台测试夹具问题：异步原生 realpath 与 8.3 同步路径比较、审查过的许可证文本在 checkout 时被转换为 CRLF、只测试 Unix 执行位的 chmod 断言，以及未固定 macOS 主机的四项模拟 SCK 协议测试。修复为原生路径比较、用 `.gitattributes` 固定许可证 LF、跨平台可观察的只读位变化与可恢复的平台模拟；保留全部原断言，没有更改生产平台检查或放宽许可证哈希。Windows CI 成功记录及产物哈希仍需要在上传 Release 前核对。Windows 安装包仍未配置代码签名与自动安装更新，分发说明必须明确；检查更新和手动下载安装保留。真实混合 DPI、第三方应用接收拖放/多文件粘贴仍为平台边界，不能用 CI 合成帧推断其全部行为。

## macOS 签名准备与剩余条件

钥匙串 `snipvia-notary` 已通过 Apple `notarytool history` 的只读认证，没有导出凭据或上传二进制。这解除“远程凭据尚未验证”这一不确定项，不等于本次 APP/DMG 已经通过公证。

本记录准备时完整 Xcode 仍在安装，系统选中 Command Line Tools；正式 preflight 尚未放行。正式构建仍需完整 Xcode 的 `xcodebuild` / `actool`，不能删掉检查或切换到临时签名作为替代。

发行顺序为：保存安全升级提交并正常推送 → Windows CI 安装/运行/卸载通过 → 完整 Xcode preflight → 从干净的相同源码构建两种 macOS 架构 → 签名、公证 Accepted、Staple、Gatekeeper 与最终元数据/哈希验证 → 核对远程源码和标签 → 发布 v1.0.0。没有覆盖已有发行版或强推历史的步骤。

本机诊断、恢复备份、构建目录和验证收据均在忽略目录，不提交到公开仓库。最终发布结果以 GitHub Release 和对应冻结产物验证记录为准。
