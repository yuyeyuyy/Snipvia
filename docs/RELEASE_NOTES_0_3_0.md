# Snipvia 0.3.0 — 免费、免登录与本地优先

本版同时提供 macOS Apple Silicon / Intel 安装包和 **Windows x64 未签名预览包**。源码采用 Apache License 2.0，分发目标统一为 `yuyeyuyy/Snipvia`。

## 下载与平台状态

| 平台 | 安装文件 | 状态 |
| --- | --- | --- |
| macOS 14+ Apple Silicon | [Snipvia-0.3.0-arm64.dmg](https://github.com/yuyeyuyy/Snipvia/releases/download/v0.3.0/Snipvia-0.3.0-arm64.dmg) | 正式 Developer ID 签名和 Apple 公证通过 |
| macOS 14+ Intel | [Snipvia-0.3.0-x64.dmg](https://github.com/yuyeyuyy/Snipvia/releases/download/v0.3.0/Snipvia-0.3.0-x64.dmg) | 正式签名和公证通过；Intel 真机待验收 |
| Windows x64 预览 | [Snipvia-Setup-0.3.0-x64.exe](https://github.com/yuyeyuyy/Snipvia/releases/download/v0.3.0/Snipvia-Setup-0.3.0-x64.exe) | **未签名、未完成 Windows 真机验收**；静态内容和合成 UI 检查通过 |

Release 同时提供 Mac ZIP、`latest-mac.yml`、Windows 安装说明和覆盖五个安装文件的 `SHA256SUMS.txt`。Mac 将 DMG 中的 Snipvia 拖入“应用程序”；Windows 先退出旧版再运行 EXE。升级前备份重要笔记和本地数据，不关闭系统安全保护或绕过组织策略。

## 主要变化

- 桌面核心无需账号或会员资格。保留截图、编辑、历史、对话、AI 笔记、预测分支与 Agent。
- AI 使用用户自己配置的模型和 API Key；未配置时仍可使用本地功能。客户端免费不包含模型服务额度。
- 可选配置 Jev 图片预测模型与独立 Key；未启用或未配置 Jev Key 时使用用户选择的视觉模型。命中分支后继续既有流程。
- 模型凭据由 Main Process 管理，Jev 使用独立加密存储，不发送账号 Cookie，不向 Renderer 返回已保存 Key。
- 保留原黑白灰主题、交互结构、应用标识 `com.snipvia.desktop` 和原有本地数据路径。

## 更新与兼容

本版的检查更新使用本仓库 GitHub Releases，独立于官网和账号服务。签名 macOS 版支持显式下载、校验并确认重启更新；Windows 当前手动下载安装，不启用未配置签名的自动替换更新。

旧账号版仍指向原分发源，需手动安装 0.3.0 后才使用新渠道。本次不删除旧账号数据、不迁移用户目录、不停止旧服务。旧设置、Key、历史与笔记的合成兼容测试通过，不等同于完成真实 Windows 升级或所有用户环境的数据恢复验收。

## 已知问题与验证边界

- 981 项单元测试及免登录兼容集成检查通过；完整 Electron 套件曾有窗口可见性与 CodeMirror 时序失败。保留失败记录，不将单独重跑视为全套通过。
- Intel 应用在 Rosetta 下直接启动通过；调试自动化出现过 30 秒超时，Intel 真机、性能和混合 DPI 仍需验收。
- Windows 为未签名预览，安装/卸载、DPAPI、真实截图、剪贴板与升级尚未真机验证。Windows Agent 命令工具尚未开放；不会为平台对等绕过沙箱保护。
- Jev 协议、独立 Key 和路由已有模拟集成验证；真实模型的可用性和准确率需由用户验收。
- `node-forge@1.4.0` 仍有高危告警，2026-10-18 生产依赖审计仍报告 1 项 high。当前 macOS 命令沙箱禁止网络且不启用 TLS 终止，未发现受影响签名验证器的已启用路径；这不是漏洞修复或绝对不可利用证明。构建依赖 `sprintf-js@1.1.3` 的既有告警也未在本轮修复。
- 安装包包含第三方通知及明确标注的 lazy-val MIT 补充。补充并非上游原始 LICENSE，不代表独立法律审查。

详细证据保存在仓库的 macOS / Windows 0.3.0 打包验收报告中。本次不宣称所有平台、真实模型和旧版原始数据升级已完成验收。
