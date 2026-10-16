# Snipvia Windows 适配与 EXE 构建报告

日期：2026-10-10（Asia/Taipei）。版本：`package.json` 的 `0.2.1`。目标：Windows 10/11 x64。执行环境：macOS Apple Silicon arm64，Node.js 24.15.0、pnpm 11.1.3、Electron 44.4.1、electron-builder 26.15.3。

## 交付结论

已完成兼容性审计、Windows 必要代码适配、本地 NSIS EXE 交叉构建与静态内容校验。可以开始小范围、受控的 Windows 内部安装验收；**尚未获得 Windows 真机运行证据，不具备正式发布验收结论**。产物未签名，版本号沿用项目版本，不表示本次产物是既有 v0.2.1 的正式 Windows 发布文件。

未推送代码、未触发远程构建、未上传安装包、未创建 Release。工作区原有大量未提交改动保留，未使用 reset、clean 或历史格式迁移。此前 `dist/` 的 Windows EXE 也未覆盖、未作为本次结果。

## Windows 兼容性清单

| 范围 | 审计结果与处理 | 验证边界 |
| --- | --- | --- |
| Main / Preload / IPC | 复用主进程业务与窄桥；sandbox、contextIsolation 开启，nodeIntegration 关闭，IPC 保留角色与 Zod 校验 | 类型检查、契约测试、Electron IPC 冒烟通过 |
| Renderer | 复用 React 黑白灰主题、工作区和设置两种语言；Windows 仅增加原提示条的全屏入口 | 合成画面模拟 Windows Renderer 通过；原生 Windows 控件待验收 |
| 截图 | Windows 直接用 desktopCapturer；修复禁用原生后端仍查询健康状态并误记 fallback 的逻辑 | 单元测试覆盖；实际 Windows 帧待验证 |
| ScreenCaptureKit / Swift | 原后端和 Helper 保留；只有 darwin 且原策略允许时启用 | 原生与 fallback 的模拟路径回归通过；没有新增真实录屏授权测试 |
| 权限 | Windows 不读取 macOS TCC、不启动 Swift、不打开 Mac 权限设置；空源、空帧、屏幕映射失败有明确错误 | UAC、安全桌面、DRM 内容无法保证可截取 |
| 多显示器 / DPI | 以鼠标所在屏幕定位 overlay；按 display_id 匹配；局部 DIP 按实际帧宽高裁剪；捕获中显示器变化拒绝旧帧 | 100/125/150/175/200% 合成坐标测试通过；跨屏拼接不支持 |
| 快捷键 | 既有 CommandOrControl 自动映射 Ctrl，保留用户录制与配置；注册失败提示、回滚及托盘入口保留 | 单元与 macOS 注册测试通过；Windows 冲突需实机确认 |
| 窗口 | 保留主窗口原生最小化/最大化/关闭覆盖控件、拖动、浮窗 alwaysOnTop、skipTaskbar；工作区可见 API 仅在 Mac 调用 | Windows 焦点、透明度、任务栏与虚拟桌面待验收 |
| 托盘 / App ID | 使用现有 Windows ICO；显式设置 `com.snipvia.desktop` AppUserModelID，与既有 appId 一致 | ICO PE 资源校验通过；Windows 托盘/通知待验收 |
| 存储 / 数据库 | 桌面历史与配置为 userData 下现有文件存储；笔记保留用户选定目录，路径使用 node:path；服务器存储不参与安装包适配 | 历史/设置/笔记的合成测试通过；不写 Program Files、不改变历史 schema |
| safeStorage | 既有主进程 safeStorage 路径复用 Windows DPAPI；无独立 Mac Keychain 调用；旧凭据迁移代码未改动 | Windows 加解密测试已准备，尚未运行；没有添加明文降级 |
| 日历 / Apple Events | 既有 Mac 日历调用有 darwin 检查，Windows UI 隐藏该系统集成；Snipvia 日程和 ICS 继续复用 | 不宣称 ICS 是日历同步；提取事件仍需用户确认保存 |
| Agent 命令沙箱 | 现有配置只在 darwin 注册命令工具；Windows 不启用 run_command/run_script | 保持显式能力边界；未绕过沙箱执行命令 |
| 原生依赖 / ASAR | 桌面安装包中没有 `.node` 模块；JS SDK 可复用；Windows 专用配置排除禁用命令功能的 sandbox vendor 二进制 | ASAR 与资源扫描通过；Windows 模块启动加载待安装版冒烟 |
| 脚本 | 现有 Mac `.sh` 发布、图标、Swift 构建保持原样；增加可在 Mac/Windows 执行的 Node 打包脚本 | Windows 开发用 `pnpm dev:raw`；原 `pnpm dev` 为 Mac 固定开发应用入口 |
| 打包 / 签名 | 保留公共与 Mac 发布配置，通过专用配置继承现有 Windows NSIS/图标设置 | 独立输出、无 Apple 发布 hooks、无远程发布 |

## 修改文件及原因

以下是本任务的增量，不能把工作区其他既有改动归入本次适配：

- `src/main/capture/capture-engine.ts`：禁用原生后端时直接走 Electron，不查询 Swift 健康状态、不误记 fallback；取消后不再启动捕获。
- `src/main/capture/electron-capture-backend.ts`：在等待预热、窗口隐藏和抓帧之后检查取消；Windows 屏幕几何或缩放变化时拒绝旧帧。
- `src/main/index.ts`：Windows AppUserModelID；限制 Mac 全工作区 API；Windows 捕获失败后恢复主窗口承载错误，避免隐藏窗口导致失败不可见。
- `src/main/platform/index.ts`：更新 Windows 权限适配注释，保留真机验证边界。
- `src/main/windows/capture-overlay-window.ts`、`screenshot-to-all-window.ts`：Mac 全工作区 API 仅在 darwin 调用，置顶与窗口复用机制保持。
- `src/renderer/src/capture/CaptureOverlay.tsx`：仅 Windows 支持 Enter 整屏，继续走原裁剪/编辑/AI IPC；不改 Mac 截图入口。
- `electron-builder.windows.yml`：继承基础配置；显式未签名、per-user、asInvoker、禁止提权、卸载保留数据、快捷方式、排除 sandbox vendor。
- `scripts/package-windows.mjs`：用当前 builder API 构建 x64 NSIS，每次生成新目录，强制 publish never。
- `scripts/verify-windows-build.mjs`：校验 PE 架构、签名表、产品元数据、图标、权限 manifest、ASAR 与 NSIS 内嵌内容，生成哈希和构建元数据。
- `package.json`：仅追加 `dist:windows` 与 `windows:verify` 命令；核心依赖及锁文件不变。
- `tests/unit/capture-engine.test.ts`、`geometry.test.ts`、`electron-capture-backend.test.ts`：平台分发、取消、DPI、负桌面坐标、映射/空帧与屏幕变化测试。
- `tests/integration/windows-capture-ui.spec.ts`：模拟 Windows Renderer 验证 Enter 整屏、Esc 取消、框选、复用与剪贴板像素尺寸，使用合成帧。
- `tests/integration/windows-release.spec.ts`：补充实际安装版的 userData、全屏、取消、剪贴板尺寸和错误可见性验证；只在 Windows 已安装临时测试包时运行。
- `.github/workflows/windows-internal.yml`：准备手动 Windows runner 安装、构建、校验、冒烟和卸载工作流；默认不上传产物。
- `docs/ci/README.md`、`docs/UI_DESIGN_LANGUAGE.md`、`docs/ui/windows-capture-ui-synthetic.png`、本报告：说明入口、合成 UI 验收证据及真实验证边界。

## 截图引擎方案与限制

Windows 沿用预加载、重复使用的 CaptureOverlay。快捷键/托盘进入同一个 `startCapture`，从 `screen.getCursorScreenPoint()` 的 DIP 找到当前显示器，隐藏主窗口与旧钉图/聊天后等待既有 compositor 隐藏策略，再调用 Electron。没有新建一套业务或新的窗口冷启动流程，也没有常驻屏幕视频流。

捕获请求的 thumbnailSize 为显示器 DIP 尺寸乘 scaleFactor。实际帧可能小于请求尺寸，裁剪因此使用实际 frame/view 比例，不二次乘缩放、不加入显示器全局负坐标。display_id 精确匹配优先；只有一台显示器且仅一个源时才允许缺失 ID 的安全回退，多屏 ID 不明确时明确失败，避免猜错屏幕。相关行为与 [Electron desktopCapturer](https://www.electronjs.org/docs/latest/api/desktop-capturer) 和 [screen 坐标文档](https://www.electronjs.org/docs/latest/api/screen) 一致。

按 Enter 截取的是鼠标所在显示器整屏；框选局限于该显示器。跨显示器长选区/整桌面拼接不在当前架构内。100% 到 200% 坐标测试不等于真实混合 DPI 验收；Windows 返回较低分辨率 thumbnail 时可能降低清晰度，不能宣称每次都有原生像素质量。

Esc 取消会沿用原会话清理，释放 NativeImage/预览引用、撤销 Blob URL；异步任务返回后检查 AbortSignal，过期帧不再进入 UI。Electron 的 getSources 不能被应用强制中止，取消后其底层调用可能短暂继续，但结果会丢弃。热插拔与 DPI 变化使当前会话失效；再次截图重新定位。

普通截图复制、保存、钉图仍复用原编辑器；AI 浮窗和历史流程仍保留原会员/模型配置边界。普通截图不会绕过资格规则变成 AI 调用。图像上传范围仍为选区，不上传整个原始桌面帧。

空源、空图、尺寸不匹配或映射不明确会报错；Windows 抓帧异常后恢复主窗口以展示失败。UAC 安全桌面、锁屏、DRM、受保护窗口或远程桌面特殊会话可能无帧/黑屏。合法纯黑桌面与受保护黑屏无法通过像素颜色可靠区分，未增加误判纯黑图片的启发式处理。

## EXE 构建配置与复现

专用配置继承原 `appId: com.snipvia.desktop`、产品名 Snipvia、版本 0.2.1、`UI/Snipvia-Win.ico`，target 为 NSIS x64。现有 ICO 有 7 种尺寸，直接复用品牌素材；未重绘图标。

安装向导允许选择目录，默认当前用户安装，不要求管理员，提供开始菜单及桌面快捷方式；卸载器存在且不主动删除 userData。桌面快捷方式可通过专用配置的 createDesktopShortcut 控制。配置遵循 [electron-builder NSIS 选项](https://www.electron.build/v26/docs/nsis/)。

```sh
# Mac 或 Windows：固定环境与依赖后构建；不执行 Mac native:build
pnpm install --frozen-lockfile
pnpm electron:install
pnpm dist:windows

# 复查指定的本地构建目录
pnpm windows:verify dist/windows-internal/internal-具体目录
```

本机无 Wine/Windows VM。已检查实际安装的 26.15.3 源码：Windows 图标与元数据由 resedit 处理；现代 macOS 的 NSIS 卸载器通过 UninstallerReader 提取，无需 Wine。缓存 NSIS 1.2.1 和 7zip 工具可以运行，没有需要跨编译的生产 `.node` 模块。因此使用 builder 官方实现完成构建，没有自制安装器、跳过图标元数据或不可靠替换卸载器。

初次受限构建无法解析 github.com，未产生成功安装包；获得本地构建执行授权后下载官方 Windows Electron 运行时并成功打包。没有更改 Electron、builder、NSIS pin 或锁文件。输出保留 `builder-debug.yml`（若 builder 生成）、EXE、blockmap、应用目录、BUILD_METADATA.json 和 SHA256SUMS.txt，失败输出与成功输出分开保留。

## macOS 保护情况

`electron-builder.yml`、`electron-builder.macos-release.cjs`、`electron-builder.macos-validation.cjs`、`scripts/macos-release/`、ScreenCaptureKit 后端、Swift Helper、Bundle ID 和 Mac 图标均未改动。Mac 仍使用原生优先、Electron fallback 和原签名/公证流程；没有执行 Mac package/dist/release 命令。

打包前后对 328 个保护文件进行 SHA-256 对比，对 5,441 个现有产物文件比较大小与修改时间，全部一致。此检查证明本次打包没有改写保护文件与现有产物，不替代真实签名/公证重验。生产 build 更新的是开发用 `out/`，没有覆盖 Mac 正式应用/DMG/ZIP。

## 自动化验证结果

| 检查 | 结果 |
| --- | --- |
| `pnpm lint` | 通过 |
| `pnpm typecheck` | 通过 |
| `pnpm test` | 59 文件、950 测试通过 |
| Windows 相关平台/存储测试子集 | 12 文件、97 测试通过（Mac 执行，Windows 分支 mock） |
| `pnpm build` | 通过，Main / Preload / Renderer 生产构建成功 |
| 相关 Electron 冒烟 | 8 通过；覆盖原生模拟/fallback、早期框选、窗口隐藏、模型设置、编辑器、AI 与持久化；Windows 安装版 1 条跳过 |
| Windows Renderer 合成验收 | 1 通过：Enter、Esc、重新框选、overlay 复用、整屏剪贴板像素尺寸 |
| Windows 安装包内容 | PE x64、版本/产品名、7 尺寸图标、asInvoker、无 Authenticode；NSIS 压缩测试及解包通过，含卸载器，内嵌 EXE/ASAR/ICO 与构建目录 SHA 一致 |
| 原生依赖 | ASAR/资源不存在 `.node`、Mac Helper、Swift、ICNS、dylib/so、提权 helper 或 sandbox vendor；Windows 实际加载待验收 |
| Mac 原有资源与产物保护 | 328 文件 hash 和 5,441 产物文件属性一致 |

受限环境最初阻止 macOS 沙箱初始化和本机模拟服务监听，导致测试失败；宿主机授权重跑后上述测试通过，没有为测试关闭产品安全检查。生产构建有既有 zod 注释提示，不影响成功。未执行全仓全部 Electron 集成用例或新的实际桌面性能基准；不宣称 Windows 截图延迟达到了 PRD 指标。

## 本次 Windows EXE 产物

| 项目 | 本次最终产物 |
| --- | --- |
| EXE 路径 | `/Users/macbook/IdeaProjects/Snipvia/dist/windows-internal/internal-gqsNc7/Snipvia-Setup-0.2.1-x64.exe` |
| 文件名 | `Snipvia-Setup-0.2.1-x64.exe` |
| 版本 / 架构 | `0.2.1` / Windows `x64` |
| 大小 | `117,789,446` 字节（约 `112.33` MiB） |
| SHA-256 | `0bcb4a1e5027cb727ed1f3fc79c9a46580a960ed058f5b9d70a01f2f21591a7d` |
| 签名 / 状态 | 未签名；内部安装验收包；Windows 真机未验证 |

同目录中的 `BUILD_METADATA.json` 与 `SHA256SUMS.txt` 是本次构建证据，`win-unpacked/` 是应用目录。此前本任务成功构建的 `internal-FjmaBN` 是中间验证产物，首次受限网络失败目录为 `internal-WdmYSq`；交付以本表最终目录为准，不应与 `dist/` 既有正式发布文件混用。

```powershell
Get-FileHash -Algorithm SHA256 .\Snipvia-Setup-0.2.1-x64.exe
```

## Windows 真机与远程验证状态

本次没有 Windows 10/11 运行环境，未尝试在 Wine 下把 Electron 运行等同于 Windows 验收。工作流准备完成但未推送/运行，Windows Server runner 即使后续通过，也只是安装/启动/合成流程证据。

| 真机项目 | 当前状态 / 后续验收 |
| --- | --- |
| 普通用户安装、目录、快捷方式、退出、卸载 | 未验证；分别在 Windows 10/11 x64 非管理员账户测试 |
| 主窗口、托盘与快捷键 | 未验证；检查被占用提示、休眠/唤醒、开机自启、任务栏和焦点 |
| 多显示器、混合 DPI | 未验证；100/125/150/175/200%，主/副屏、负坐标、竖屏、热插拔、缩放变更、RDP |
| 真实截图质量与遮挡 | 未验证；检查全屏/区域像素、主窗口/旧浮窗不入图、无黑屏或错位 |
| 复制、保存、历史、AI 浮窗 | 合成流程已覆盖；Windows 真实剪贴板、中文路径、重启持久化、真实模型仍未验证 |
| DPAPI 与原生模块加载 | 安装版测试已准备；Windows 尚未实际执行 |
| 性能 / 资源释放 | 合成测试证明窗口复用；真实冷/热捕获耗时、连续截图内存与进程计数仍需测量 |

## Authenticode 与后续签名方案

没有找到 Windows 证书、Azure Trusted Signing 或 signtool 签名配置。本次专用配置使用 `win.signExecutable: false`，保留图标/元数据编辑；校验应用和安装器 PE 证书表为空。Apple Developer ID 不用于 Windows，未伪造签名。

未签名软件可能出现未知发布者或 SmartScreen 提示，受管理设备可能阻止运行。测试者应核对来源与 SHA-256，不关闭 SmartScreen 或绕过组织安全策略。暂不购买证书。

后续可采购受信任 CA 的组织 Authenticode 证书及硬件/云端签名服务，或评估 Microsoft Trusted Signing 适用条件；在独立 Windows 签名配置启用 signtoolOptions 或 azureSignOptions、时间戳和 forceCodeSigning。密钥只放硬件/CI secrets，不进仓库。正式发布前分别验证应用、安装器与卸载器签名链、时间戳、安装与卸载，并重新计算 SHA-256。签名方案不复用 Apple 证书，不能保证立即取得 SmartScreen 信誉。

## 是否具备 Windows 内测条件

具备**受控内部安装验收**条件：有真实构建的 EXE、静态校验、自动化回归、Windows runner 复现入口与明确的待验收清单。首次安装测试需由知悉未签名和未真机验证状态的测试者执行。公开发布条件尚未满足，不能标记正式版本。

本任务完成后暂停；等待项目所有者确认 Windows 真机测试、批准推送/远程工作流或安排 Windows 签名的下一步。
