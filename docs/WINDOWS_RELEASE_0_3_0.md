# Windows 0.3.0 本地打包验收

日期：2026-10-18。工作区为 `Snipvia-public-baseline`，分支 `codex/jev-vision`，HEAD 为 `ce46e1fff25ac7abae4f0e85f76393990042ceb8`。

## 交付结论

已生成 **Windows x64 未签名安装验收包**，版本 0.3.0。当前 Mac 可以完成交叉构建及静态校验，不能代替 Windows 真机验收。没有 Windows 代码签名配置，也未尝试使用 Apple 证书签 Windows。未推送、上传 Release、触发远程 CI、安装本机软件或修改生产服务。

| 项目 | 实际产物 |
| --- | --- |
| 安装器 | [Snipvia-Setup-0.3.0-x64.exe](../dist/windows-internal/internal-SCKvzd/Snipvia-Setup-0.3.0-x64.exe) |
| 版本 / 架构 | 0.3.0 / Windows x64 |
| 字节数 | 118687707 |
| 大小 | 113.19 MiB |
| SHA-256 | `eae9d7cc714daa5465d02f14a8acb790e8cea759dbaea166732233bc2470f56a` |
| 签名 | 未签名；应用和安装器 PE 证书表为空 |
| 校验文件 | [SHA256SUMS.txt](../dist/windows-internal/internal-SCKvzd/SHA256SUMS.txt) |
| 构建元数据 | [BUILD_METADATA.json](../dist/windows-internal/internal-SCKvzd/BUILD_METADATA.json) |
| 配套说明 | [WINDOWS_INSTALL_GUIDE.md](../dist/windows-internal/internal-SCKvzd/WINDOWS_INSTALL_GUIDE.md) |

## 本次实际变更

本轮没有修改业务源码、打包配置、依赖或锁文件；无需重复改造已经完成的免登录与 Jev 功能。仅新增本报告及忽略目录中的安装包、安装说明和验证记录。原有 741 个源文件逐一 SHA-256 对比不变，四个已公证 macOS 安装包 SHA-256 对比不变。原有未提交与未跟踪工作保留，未执行 reset、clean 或移动仓库。

本次直接使用 `pnpm dist:windows`，其实际流程为 `pnpm build` → `scripts/package-windows.mjs` → `verifyWindowsBuild`。版本仍为用户已确认的 0.3.0；Windows 配置继承共享图标、App ID 与许可证资源，输出位于新的 `dist/windows-internal/internal-SCKvzd/`，未覆盖旧产物。没有运行 Mac native:build、签名、公证或发布入口。

## 验证记录

| 检查 | 结果及边界 |
| --- | --- |
| `pnpm dist:windows` | 退出码 0；包含类型检查、生产编译、许可通知生成、NSIS 构建和既有静态校验。 |
| 固定工具 | Node.js 24.15.0、pnpm 11.1.3、Electron 44.4.1、electron-builder 26.15.3、NSIS toolset 1.2.1。没有调整版本或更新依赖。 |
| PE | 应用为 x64，版本与产品名称匹配；7 个图标资源；应用与安装器 `asInvoker`；未签名。 |
| NSIS | 压缩完整性测试和解包通过，存在 x64 payload 和卸载器；内嵌 EXE、ASAR、ICO 与构建目录逐一哈希一致。没有执行安装器。 |
| 原生资源 | 既有校验未发现 `.node`、Mac Swift Helper、dylib/so、Swift、ICNS、sandbox vendor 或提权 helper 进入受检查的应用资源。没有为通过校验移除有效测试。 |
| ASAR | 6265 个条目；Main / Preload / Renderer 入口与本轮编译输出字节一致；检查的私有应用、旧账号源码、Git 元数据及根环境文件路径均不存在。 |
| 许可证 | 项目 LICENSE、NOTICE、第三方声明、276 个生产依赖版本的通知、明确标注的 lazy-val 补充均存在；Windows Electron 自带的 `LICENSE.electron.txt` 与 `LICENSES.chromium.html` 存在。补充文本不等同上游原始通知或独立法律审查。 |
| 安全与模型边界 | Main 编译输出保留 sandbox、contextIsolation、Jev 固定端点及 Windows 未配置签名更新的提示；没有启用不受信的自动替换更新。安装器保留卸载不删除用户数据的配置。 |
| Windows Renderer 合成测试 | `pnpm exec playwright test tests/integration/windows-capture-ui.spec.ts --reporter=list,json`，1 项通过、0 失败、0 跳过；Enter 整屏、Esc 取消、框选、窗口复用、合成剪贴板尺寸通过。宿主仍为 macOS，仅模拟 Renderer 平台选择，不能据此认定 Windows Main、DPAPI 或真实截图通过。 |
| 既有测试 | 上轮相同源码已有 lint、typecheck、981 项单元测试通过；本轮构建再次通过 typecheck，没有重复全量单元/Electron 套件。既有 Electron 时序失败和 Intel 调试超时仍见 [macOS 报告](MACOS_RELEASE_0_3_0.md)，未将其改记为通过。 |
| 哈希与保护 | 安装器 SHA-256 与元数据/校验文件一致；741 个既有源码文件及四个 macOS 成品保持不变。 |

构建仍出现依赖注释位置和重复依赖引用提示，不影响退出码 0。未将构建成功当作安全审计全绿：生产依赖 node-forge 的既有高危告警和构建依赖 sprintf-js 的告警仍按 [依赖安全记录](opensource/dependency-security.json) 保留，未加忽略或修改加密实现。

## 安装与配置

安装器不需要 Node.js 或 pnpm。先在测试用 Windows x64 设备上核对来源与 SHA-256；退出旧应用后运行安装器，使用原安装目录测试升级。安装是当前用户、可选目录模式，不要求应用主动提权。卸载配置不主动删除用户数据；升级与回退验收前仍应备份原有用户数据和笔记。

```powershell
Get-FileHash -Algorithm SHA256 .\Snipvia-Setup-0.3.0-x64.exe
```

0.3.0 客户端无需登录或会员。截图、编辑、本地历史与本地笔记的代码不要求 API Key；AI 功能使用用户自行配置的模型和 Key。设置中可选配置支持图片输入的 Jev 与独立 Key，未启用或未配置 Jev Key 时使用用户配置的视觉模型预测，命中分支后继续原处理链。安装包不附带分享者的 Key，不能把客户端免费理解为模型服务免费额度。

普通截图默认 `Ctrl+Shift+A`，AI 截图默认 `Ctrl+Shift+Space`，均可由用户设置或系统托盘进入。对话空输入按 Enter 触发预测，填写问题后按 Enter 则发起对话。此前 [0.2.1 安装说明](WINDOWS_FRIEND_INSTALL_GUIDE.md) 是账号版历史文档，不适用于本版。

未签名安装器可能显示未知发布者或受系统策略拦截；不要关闭 SmartScreen 或绕过组织安全策略。Windows 仍通过 GitHub 检查版本并手动下载安装，未配置 Authenticode 的自动安装链路，不生成假称可自动更新的 `latest.yml`。

## Windows 真机验收清单

以下均未在本轮验证，不能将此包称为 Windows 正式发行已验收：

- 非管理员安装、卸载、快捷方式、中文目录、旧版升级与回退、卸载后数据保留。
- 启动、托盘、快捷键冲突、休眠唤醒、系统自启和焦点。
- 真实全屏与框选截图、剪贴板、保存、历史、混合 DPI、多显示器/负坐标/热插拔、RDP。
- 当前 Windows 用户的 DPAPI 加密、重启解密与旧 Key 兼容；不尝试跨用户或跨机器复用密文。
- 用户模型与 Jev 的真实图片输入、取消、错误处理、预测命中后的 AI/笔记/Agent 路由。
- Windows Agent 的对话和文件工具；`run_command` / `run_script` 仍未在 Windows 注册，不为平台对等绕过原有沙箱保护。
- Mac 的 Swift Helper 与 Apple 日历系统集成不适用于 Windows；本地日程和 ICS 保留既有边界。

## 本地证据与恢复

- 当前构建：`dist/windows-internal/internal-SCKvzd/`，含安装器、blockmap、应用目录、元数据和 SHA-256。不是在线 Release。
- 构建日志、包内检查、Windows Renderer 测试结果：`.dev-runtime/windows-0.3.0/`。
- 打包前 manifest、Git 状态、diff 和 macOS 文件保护清单：`.dev-runtime/windows-0.3.0/20261018T011921Z/`。
- 可恢复源码归档：`.dev-runtime/release-0.3.0/source-final.tar.gz`，本轮开始时已验证其 741 个源文件与工作区完全一致；不依赖删除工作区或重写历史。新增报告也保存在本轮归档中。
- 本次没有迁移或读取真实用户数据；没有修改原恢复目录、Snipvia-legacy 或 Snipvia-server。
