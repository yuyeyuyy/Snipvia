# Snipvia 0.3.2 · 反馈入口与界面精简

## 本次更新

- 主窗口右上角新增「反馈」按钮，弹窗显示 QQ 群号 **643251313**。
- 群号支持一键复制，成功后显示「已复制」；失败可重试。
- 移除 AI 对话侧栏左下角重复的设置入口，继续通过右上角齿轮进入设置。
- 沿用黑白灰主题，适配亮暗模式；关闭反馈弹窗保留当前页面和对话草稿。
- Windows 沿用上一版已切换的透明应用图标。

反馈入口仅本地展示群号与按点击复制，不自动上传信息或打开 QQ。桌面功能仍免费、无需登录，AI 使用用户配置的模型和 API Key。应用标识与本地数据目录保持不变。

## 下载与平台状态

| 平台 | 安装包 | 状态 |
| --- | --- | --- |
| macOS 14+ Apple Silicon | [DMG](https://github.com/yuyeyuyy/Snipvia/releases/download/v0.3.2/Snipvia-0.3.2-arm64.dmg) | Developer ID 签名与 Apple 公证 |
| macOS 14+ Intel | [DMG](https://github.com/yuyeyuyy/Snipvia/releases/download/v0.3.2/Snipvia-0.3.2-x64.dmg) | 正式签名、公证；Intel 真机仍待验收 |
| Windows x64 | [EXE](https://github.com/yuyeyuyy/Snipvia/releases/download/v0.3.2/Snipvia-Setup-0.3.2-x64.exe) | **未签名预览版**，Windows 真机仍待验收 |

同时提供 macOS ZIP、更新元数据、Windows 安装说明与 SHA-256 清单。macOS 保留检查、下载和确认重启更新；Windows 继续手动下载安装，不启用未签名包自动替换。

## 验收范围

本次按用户要求复用已完成的新功能验收，不重跑整套单元、Electron 或平台回归。仅确认新包包含反馈、复制群号和导航调整，并完成新安装包所需签名、公证与上传哈希检查。真实模型、Windows/Intel 真机、混合 DPI 与安装升级没有在本次补做。

既有依赖告警未在本轮修复，见[依赖安全记录](https://github.com/yuyeyuyy/Snipvia/blob/main/docs/opensource/dependency-security.json)。旧版本安装包和本地数据保留。
