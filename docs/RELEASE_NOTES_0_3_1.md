# Snipvia 0.3.1 · 笔记与对话操作优化

## 主要改进

- **笔记直接保存**：Agent 在用户选择的笔记本或笔记范围内写入，无需逐次审批；保留修改差异和撤销。脚本、命令和其他文件权限保护继续保留。
- **对话框尺寸调节**：截图对话右下角可拖拽调整大小，也支持方向键微调；紧凑与展开模式分别记住本次运行期间的尺寸。
- **AI 对话字号**：设置 → 外观中可选 12–24px，对话正文、代码与输入同步调整，重启后保留。
- **设置层级更清楚**：调整分组标题、行标签、说明文字的字号、字重与留白，保持黑白灰主题。

无需登录或会员；AI 继续使用用户自己配置的模型和 API Key。应用标识与本地数据目录保持不变，新字号默认 15px。

## 下载

| 平台 | 安装包 | 状态 |
| --- | --- | --- |
| macOS 14+ Apple Silicon | [DMG](https://github.com/yuyeyuyy/Snipvia/releases/download/v0.3.1/Snipvia-0.3.1-arm64.dmg) | Developer ID 签名、Apple 公证、Staple、Gatekeeper 通过 |
| macOS 14+ Intel | [DMG](https://github.com/yuyeyuyy/Snipvia/releases/download/v0.3.1/Snipvia-0.3.1-x64.dmg) | 正式签名与公证通过；Intel 真机仍待验收 |
| Windows x64 | [EXE](https://github.com/yuyeyuyy/Snipvia/releases/download/v0.3.1/Snipvia-Setup-0.3.1-x64.exe) | **未签名预览版**，静态校验通过，尚未完成 Windows 真机验收 |

同时提供 macOS ZIP、更新元数据、Windows 安装说明与 SHA-256 清单。Windows 仍采用手动下载安装，不启用未签名包自动替换；不要关闭系统安全保护或绕过组织策略。

## 更新与验证范围

macOS 保留应用内检查、下载和确认重启更新。旧账号版 v0.2.3 及更早版本仍需手动安装新客户端，才能切换至本仓库更新渠道。保留原有模型配置、快捷键、主题、本地历史和笔记；升级前请备份重要数据。

本版复用已通过的功能验收，仅对新增工具、冻结产物哈希及发布链路作相应检查，没有将未验收的平台记为通过。真实模型、Intel/Windows 真机、混合 DPI 及安装升级仍保留原验证边界。本次未调整依赖或处理已记录的依赖告警，详见 [打包记录](https://github.com/yuyeyuyy/Snipvia/blob/main/docs/RELEASE_0_3_1.md) 和 [依赖安全记录](https://github.com/yuyeyuyy/Snipvia/blob/main/docs/opensource/dependency-security.json)。

## Windows 图标更新（2026-10-18）

Windows 安装包已换用透明背景图标，应用、安装器和运行时图标资源均已核对。版本仍为 0.3.1；已安装 Windows 版可手动重新下载安装。macOS 安装包未改动。Windows 图标与打包配置对应[源码提交](https://github.com/yuyeyuyy/Snipvia/commit/cb2cbf9d326c231787cb3e20b1ce4b1d544f9e03)。Windows 仍为未签名预览版。
