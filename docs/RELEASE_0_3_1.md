# Snipvia 0.3.1 推送与打包记录

> 2026-10-18 后续更新：Windows 安装包已换用透明图标并重新上传；本页保留首次构建/发布快照，最新 Windows 哈希与来源见[图标重包记录](WINDOWS_ICON_REFRESH_0_3_1.md)。macOS 包和更新元数据未改动。

0.3.1 安装包已在本地完成。macOS arm64 / x64 正式签名、公证与容器验收通过；Windows x64 生成未签名预览版。应用源码提交 [`cb50b23`](https://github.com/yuyeyuyy/Snipvia/commit/cb50b23775ad27b8ed0fa6a5087f8201ba66d1fe) 已推送 main。本报告和打包工具收尾单独提交，不改变安装包内业务源码。

仅在 `Snipvia-public-baseline` 操作；原目录、私有仓库和生产服务未改动。保留既有 0.3.0 标签和安装包。本次打包后另经用户授权，已将 0.3.1 发布为[最新正式 Release](https://github.com/yuyeyuyy/Snipvia/releases/tag/v0.3.1)，见[发布记录](RELEASE_0_3_1_PUBLICATION.md)。

## 产品改动

- 笔记由 Agent 在用户选择的范围内直接保存，保留原子提交、差异和撤销；脚本与通用文件权限保护保留。
- 截图对话可拖拽和用键盘调节尺寸，紧凑与展开模式分别记住本次运行尺寸。
- 对话正文、代码和输入支持 12–24px 字号，跨窗口同步且重启保留。
- 设置分组标题、行标签与说明通过字号、字重和留白区分，保留黑白灰主题。

行为细节与实际合成截图见 [操作优化记录](CHAT_CONTROLS_2026_10_18.md)。

## 交付文件

候选目录：`dist/Snipvia-0.3.1-candidate-1b59aa65`。包括两种架构各一份 DMG/ZIP、Windows EXE、`latest-mac.yml`、`WINDOWS_INSTALL_GUIDE.md` 和 `SHA256SUMS.txt`。

| 文件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| [Snipvia-0.3.1-arm64.dmg](../dist/Snipvia-0.3.1-candidate-1b59aa65/Snipvia-0.3.1-arm64.dmg) | 141558038 | `2c625c622ac650fdc886207eeb23158fe892ea27100e0975da5f5f46d9a7d227` |
| [Snipvia-0.3.1-arm64.zip](../dist/Snipvia-0.3.1-candidate-1b59aa65/Snipvia-0.3.1-arm64.zip) | 141958348 | `1137a85fa26beb51f6af5a86779b5b2d77340da2f6fabb1de6852ecc7a8fd4dd` |
| [Snipvia-0.3.1-x64.dmg](../dist/Snipvia-0.3.1-candidate-1b59aa65/Snipvia-0.3.1-x64.dmg) | 148324197 | `84bf9768363f2d8b94cc5f608bd2fb63c2bce0afe8f35bbf5d22817ab8de0f0b` |
| [Snipvia-0.3.1-x64.zip](../dist/Snipvia-0.3.1-candidate-1b59aa65/Snipvia-0.3.1-x64.zip) | 148761493 | `d7111044d6c2adfafd539217fd8525fd7988cec5e7c9cddf755de70ddd96ba69` |
| [Snipvia-Setup-0.3.1-x64.exe](../dist/Snipvia-0.3.1-candidate-1b59aa65/Snipvia-Setup-0.3.1-x64.exe) | 118689671 | `b6e4c520eef5641023760e912105c6c0aafbf0f532778f9300eccadb896256b9` |

[校验清单](../dist/Snipvia-0.3.1-candidate-1b59aa65/SHA256SUMS.txt)；[Windows 安装说明](../dist/Snipvia-0.3.1-candidate-1b59aa65/WINDOWS_INSTALL_GUIDE.md)。发布前可复用这些冻结哈希对应的验收结果，无需重新签名、公证或重跑功能测试。

## 验收与复用

| 检查 | 结果 |
| --- | --- |
| 已有功能 | 复用 63 文件 / 988 单测、9 项 Electron 用例、lint；业务代码未再改变，不重跑原套件 |
| 新增打包工具 | 构建复用与清单工具的 6 项单测、定向 lint、最终类型检查通过 |
| 0.3.1 构建 | 生产编译与 276 项生产依赖通知生成通过；缺失许可证文本为 0 |
| 构建次数 | 一次桌面编译与一次 Native 构建；双平台与签名重试实际命中构建复用 |
| macOS 两种架构 | Developer ID、时间戳、Hardened Runtime、最小 Entitlements、Apple Accepted、Staple、Gatekeeper、DMG/ZIP 内应用检查通过 |
| 新 ARM 应用启动 | 临时 userData、版本 0.3.1、Preload 入口和采样窗口 sandbox/contextIsolation 检查通过；没有真实 AI 请求或安装到系统目录 |
| Windows x64 | PE、版本、7 组图标、ASAR、NSIS、卸载器与解包哈希通过；未签名、未做 Windows 真机运行检查 |
| 最终文件 | 从验收目录复制后 SHA-256 与冻结记录一致，未重新验收二进制 |

Apple 时间戳服务两次返回缺失时间戳，流程均停止并保留失败输出；重试未降级签名或跳过公证。Intel 改用独立目录重试，ARM 包未重新签名或公证。

原流程在 Intel 失败前未保存 ARM 完整哈希凭据，恢复时补做一次 ARM 产物完整性校验并保存真实结果。未以日志阶段描述代替凭据。新流程每架构完成后立即写出哈希检查点，避免此类重复。

同时修复原脚本将换行写为字面量导致发布清单 JSON 无法解析的问题。清单解析、哈希变化拒绝、禁止覆盖测试通过；使用已有验收包生成清单，没有重新编译应用。

[精简验收规则](VALIDATION_POLICY.md)；[功能与工具机器记录](ci/release-0.3.1-validation.json)；[安装包机器记录](ci/release-0.3.1-packaging.json)。

## 兼容性与剩余边界

App ID `com.snipvia.desktop`、用户数据目录和加密 Key 存储不变。旧设置缺少字号时使用 15px，不需要删除或迁移用户数据。

Windows 真机、Intel 真机、混合 DPI、真实厂商模型和安装升级未在本轮补做。Windows 保持 GitHub 检查和手动下载安装，不生成声称可静默替换的 `latest.yml`。

既有依赖告警不在本次 UI/打包修复范围；保留 [依赖安全记录](opensource/dependency-security.json) 和历史风险边界，不将编译通过解释为安全审计全部通过。

## 恢复路径

包装前全部 52 项改动保存在 `.dev-runtime/release-0.3.1/before-packaging.tar.gz`、二进制补丁与 SHA-256 清单。完整源码可由已推送的客户端提交恢复。恢复时先解到另一个目录比对，不使用 reset、clean 或覆盖后续改动。

本轮日志、构建哈希、启动探针和交付摘要位于忽略目录 `.dev-runtime/release-0.3.1/`。macOS 真实验收记录位于 `dist/macos-release/0.3.1-x64-retry-2026-10-18T04-21-23-944Z-07846da0/verified/verification.json`；Windows 元数据位于 `dist/windows-internal/internal-cRRFgH/BUILD_METADATA.json`。失败目录和已发布 0.3.0 产物均保留；代码回退不删除用户笔记或设置。
