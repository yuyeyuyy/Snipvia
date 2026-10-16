# Snipvia 开发计划

日期：2026-09-16。以下为一位熟悉 TypeScript 的全职开发者的初始估算，约 5–7 周达到 v0.1 内测；不是交付承诺。权限、签名、原生依赖与实机资源可能延长周期。

实施顺序调整：当前先完成 macOS 框架与验证，Windows 仅保留基础适配。下列双端出口仍是最终目标，尚未因框架建立而完成。当前实现边界见 [开发与验收](DEVELOPMENT.md)。

## M0：双端风险验证（3–5 个工作日）

- [ ] 建立最小 Electron + React + TypeScript 工程，锁定 Node、Electron、pnpm 和打包工具版本。
- [ ] Mac 和 Windows 都能启动、注册快捷键、截图、显示浮窗。
- [ ] 验证 macOS 首次屏幕授权、拒绝与撤销，记录实际系统行为。
- [ ] 验证 Retina、Windows 150%/200%、混合 DPI、负坐标副屏。
- [ ] 验证帧尺寸和小字清晰度，确保没有误用低分辨率缩略图。
- [ ] 验证一个视觉模型的图片、流式与结构化输出能力。
- [ ] 验证权限为 `600` 的本地加密凭据文件、主密钥文件和 SQLite 在三种目标架构的安装包中可运行，并在设置页持续明确同一用户权限边界。
- [ ] 决定首批测试用户是否接受本地日程；若不接受，提前安排外部日历直写。

出口：至少 macOS arm64 与 Windows x64 真机跑通截图浮窗；macOS x64 安装烟测完成或明确为未支持，不得未经验证宣称三架构全支持。失败时先解决平台问题，不进入大量 UI 开发。

## M1：截图到对话（5–7 个工作日）

- [ ] 截图状态机与取消清理，单实例与托盘入口。
- [ ] 浮窗锚定、拖动、边界夹紧和焦点恢复。
- [ ] 图像多轮对话、流式输出、取消和失败重试。
- [ ] 模型设置与凭据保护，首次上传告知。
- [x] 本地会话历史与删除（当前使用 JSON + JPEG，SQLite 迁移及“不保存历史”开关待后续完成）。

出口：两端都能从任意常见工作应用框选并完成问答；连续 100 次截图/取消无残留窗口。

## M2：截图到日程（5–7 个工作日）

- [x] EventDraft schema、可编辑确认卡片与缺失/推断提示（字段级来源证据待补充）。
- [x] 相对日期上下文、时区、全天事件、缺失信息与多事件候选（DST 边界实测待补充）。
- [ ] 本地日程 CRUD、重复检查与事务（JSON 草稿、编辑与删除已实现；去重和 SQLite 事务待补充）。
- [ ] 系统通知、权限状态、重启及唤醒补发策略。
- [ ] ICS 导出并在目标日历客户端实际导入验证。

出口：冻结标注样本达到 PRD 门槛；写入失败、导出与保存状态准确，不把推断时间当已知事实。

## M3：内测交付（7–10 个工作日）

- [ ] 权限、断网、API 错误、无图片能力模型、休眠恢复测试。
- [ ] 三架构安装包、签名与公证准备，双端干净环境安装测试。
- [ ] 数据迁移、隐私清理与不保存历史模式。
- [ ] Windows 输入法/快捷键、macOS 全屏 Space、屏幕热插拔。
- [ ] 记录本地唤起 p95、截图清晰度与空闲资源占用，确定发布基线。
- [ ] 邀请约 10 位目标用户内测，收集真实使用频率和日程纠错率。

出口：P0 全通过；源码 lint/typecheck/test/build 通过；没有未解释的权限失败或已知丢失日程问题。构建成功不替代真机验收。

## v0.2：外部日历（另估 1–3 周起）

先选择一个真实用户需要的目标：Microsoft Graph 可两端复用，Apple EventKit 则服务 Mac 原生日历用户。不要同时启动三个服务接入。

- [ ] 用户账号授权和令牌存储。
- [ ] 选择可写日历、创建、结果核验、失败恢复和去重。
- [ ] 明确本地记录和外部事件的关系；首版只做创建，不宣称双向同步。
- [ ] 远程写入超时但实际成功的故障注入测试。
- [ ] 根据目标平台补充权限与隐私说明。

当前开发预览额外提供 macOS Calendar 脚本直写，用于尽早验证“选择日历 → 明确确认 → 创建事件”的交互。它不代表上述 v0.2 适配完成；EventKit、写入核验、幂等和正式权限声明仍在本阶段范围内。

## 第一批可创建的 Issues

1. `M0: Bootstrap Electron desktop app on macOS and Windows`
2. `M0: Verify screenshot permissions and native-resolution capture`
3. `M0: Validate mixed-DPI coordinate mapping`
4. `M1: Implement capture lifecycle and anchored chat panel`
5. `M1: Add vision provider adapter with streaming and cancellation`
6. `M2: Extract event drafts with date evidence and uncertainty`
7. `M2: Persist events and schedule local reminders`
8. `M2: Export timezone-safe ICS files`
9. `M3: Package and smoke-test all supported architectures`

## 需要准备的外部资源

- 一台可测试的 Mac 和一台 Windows 11 设备；Windows 虚拟机可做初测，真机验证桌面体验。
- 至少一个可用视觉模型账号/API Key；不把密钥提交到仓库。
- 对外发布前的 Apple Developer ID、公证凭据和 Windows 签名方案。
- 远程仓库归属和可见性、最终品牌与许可证选择。当前本地目录未推送到任何托管平台。
