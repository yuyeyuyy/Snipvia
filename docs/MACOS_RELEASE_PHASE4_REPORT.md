# Snipvia Phase 4 正式签名、公证与发布验收报告

## 1. 最终结论

**双架构 Developer ID 签名、Apple 公证、Staple、Gatekeeper 和最终 APP/DMG/ZIP 容器验收均已完成。四个最终分发文件已冻结，没有公开发布。**

- 签名与公证：成功，4 次提交全部 Accepted，日志均为 statusCode=0、issues=null，没有重复或失败公证提交。
- 授权范围内的自动化技术验收：完成。Apple Silicon 的最终 DMG 安装副本回归通过；补充的 x64/Rosetta 回归通过，但保留首次启动超时证据和性能风险。
- 外部分发前的人工验收：**未完成**。真实录屏权限、真实像素与 AI/账号交互、实际 Finder 替换安装、Intel 真机和最低 macOS 14.0 运行仍需人工验证。
- 公开发布建议：**暂不建议现在公开发布**。先完成下面的人工验收；用户再次明确授权后才能对外分发。本报告生成后停止，没有上传官网、GitHub Releases、对象存储或自动更新服务。

**x64 构建、签名、公证通过；Intel 真机运行尚未验证。** Rosetta 结果仅作为补充证据。

## 2. 环境、预检与源码保护

| 检查 | 实际结果 |
| --- | --- |
| 产品与版本 | Snipvia 0.2.1，显示名称截然，Bundle ID `com.snipvia.desktop`，最低系统 14.0 |
| 工具版本 | Electron 44.4.1、electron-builder 26.15.3、Node.js 24.15.0、pnpm 11.1.3；未升级依赖 |
| 有效身份 | Developer ID Application: chen houbiao (F76JCDMA4Y) |
| 证书 SHA-1 / Team ID | `BFF84DE0E09178F88BABE1BAD7C60F6B0FFECD8F` / `F76JCDMA4Y` |
| 公证凭据 | `snipvia-notary`，notarytool history 只读预检成功；提交前任务历史为 0 |
| Phase 3 | 读取[最终报告](MACOS_RELEASE_PHASE3_VALIDATION_REPORT.md)，无未解决 P0/P1；939 单元测试、37 发布 Mock 为第三阶段历史结果，不计为第四阶段新执行 |
| Git 提交 | `c414cdd991733ffb8bb4ee88dd53cdb22a691744`，执行结束仍为该提交 |
| 工作区 | 使用现有未提交内容构建；源码基线复查变化 0，136 个编译输入漂移 0；全部既有未提交修改保留 |
| 新增项目文件 | 本报告；产品代码、配置、依赖、Bundle ID、图标、功能逻辑与 Helper 路径未修改 |
| 输出隔离 | `dist/macos-release/0.2.1-2026-10-10T04-27-38-351Z-d03b6c05/`，没有覆盖旧正式产物或混用 Phase 3 测试产物 |

没有执行 git reset/clean，没有删除、导出或重新签发证书，没有修改系统信任、钥匙串私钥或 notarytool Profile。凭据通过钥匙串读取，未获取或打印明文密码/API Key，未写入 Git。

## 3. 实际发布入口与公证顺序

```sh
SNIPVIA_NOTARY_PROFILE=snipvia-notary node scripts/macos-release/release.cjs --execute
```

使用第二阶段原有正式入口。复核了原 YAML、正式 CJS 配置、package.json、历史 package-release.sh、common/hooks/preflight/verify/release 脚本、Entitlements、Swift 构建流程及当前安装的 macPackager、osx-sign、notarize、archive/dmg 实现。

1. 有效身份与版本预检，创建全新目录；notarytool history 验证远程凭据，没有提交测试任务。
2. 原 native:build 编译 arm64/x86_64 并合并 Universal Swift Helper；pnpm build 完成类型检查、Electron 主进程及 React 生产构建。
3. arm64 APP：osx-sign 从深层组件向外签名，APP 最后签名；校验通过后由 electron-builder 内置集成提交 APP 的临时 ZIP。
4. 仅 Accepted 后内置 Staple APP，afterSign 验证票据与 Gatekeeper，然后构建最终 ZIP 与签名 DMG。
5. release.cjs 对最终 DMG 提交一次，Accepted 后 Staple；验证镜像及实际 DMG 内、ZIP 解压后的 APP。
6. 对 x64 重复上述流程。双架构验收通过后，校验最终 SHA-256 并生成 verified 目录。

实际共 **2 次 APP 容器提交 + 2 次最终 DMG 提交**。APP 自动公证结果被复用，没有自定义重复 APP 提交。ZIP 自身未签名或 Staple，内含已经 Staple 的 APP；没有使用 altool。

现有签名器、签名配置和凭据隔离机制未替换。因内置 notarize 不持久保存 APP Submission ID，本次使用执行专用的临时 Node preload 被动保存公开 ID、状态和日志；它不改变签名及子进程结果，并拒绝非钥匙串认证参数。正式环境剔除 Apple ID/API/CSC 凭据与 DEBUG 覆盖。CLI 明确 `--publish never`；源码没有自动更新入口，生成的 blockmap 不进入最终 verified 清单。

## 4. 正式签名与双架构构建结果

| 验收项目 | arm64 | x64 |
| --- | --- | --- |
| APP、DMG、ZIP 构建 | 已通过 | 已通过 |
| 主程序 / Electron Framework | arm64 | x86_64 |
| 其他必要原生 Mach-O | 13 个单架构组件匹配目标 | 13 个单架构组件匹配目标，无 arm64-only 必要组件 |
| Swift Helper | 唯一文件，arm64 + x86_64 | 唯一文件，arm64 + x86_64 |
| APP Developer ID、Team、时间戳、Hardened Runtime | 已通过 | 已通过 |
| 嵌套代码 / bundle 校验 | 14 个 Mach-O、9 个 bundle、24 条代码/slice 详情 | 14 个 Mach-O、9 个 bundle、24 条代码/slice 详情 |
| APP 公证 / Staple / Gatekeeper | 已通过 | 已通过 |
| DMG 签名 / 公证 / Staple / Gatekeeper | 已通过 | 已通过 |
| 实际 DMG 内及 ZIP 解压后 APP | 已通过 | 已通过 |

所有必要可执行组件的 Authority 为预期 Developer ID Application，TeamIdentifier 为 F76JCDMA4Y，安全时间戳存在，Mach-O/runtime 标记通过；没有未签名、Ad-hoc 或其他团队的必要组件。DMG 也验证 Developer ID 与安全时间戳；磁盘镜像不适用 Hardened Runtime。

覆盖主程序、四个 Electron Helpers、Electron Framework、chrome_crashpad_handler、libffmpeg、libvk_swiftshader、Mantle、ReactiveObjC、Squirrel、ShipIt 和 Swift Helper。每个 slice 的代码完整性、身份及 Entitlements 均独立校验。没有以 `codesign --deep --force` 修复嵌套代码，也没有签名失败降级。

| 权限对象 | 实际 Entitlements |
| --- | --- |
| 主 APP / 主可执行文件 | `com.apple.security.cs.allow-jit`、`com.apple.security.automation.apple-events` |
| Electron Helpers | 仅 `com.apple.security.cs.allow-jit` |
| Swift Helper / 其他原生代码 | 空字典 |

没有添加 unsigned-executable-memory、disable-library-validation、get-task-allow 或 sandbox 例外。Helper 标识为 `com.snipvia.desktop.capture-helper`，路径为 `Contents/Resources/native/snipvia-capture-helper`；未重复或遗漏。Helper 两个 slice 的 Mach-O minos 均为 14.0；Electron 主程序/Framework 为 13.0，APP LSMinimumSystemVersion 为 14.0。

签名结束后没有修改 APP 内部业务内容，仅按批准流程 Staple。安装及解压副本均通过原签名校验。

## 5. Apple 公证记录与日志

| 架构 / 对象 | Submission ID | 状态 | 结果时间 UTC | statusCode / issues |
| --- | --- | --- | --- | --- |
| arm64 APP | `60bd9ca1-1dc4-443b-a70e-16ee9e331f67` | Accepted | 2026-10-10T05:02:47.306Z | 0 / null |
| arm64 DMG | `12c05978-acee-4da4-8bb8-c18cc554e724` | Accepted | 2026-10-10T05:06:05.714Z | 0 / null |
| x64 APP | `c19b6e46-45f1-490c-8710-3c0511fd8df7` | Accepted | 2026-10-10T05:16:13.277Z | 0 / null |
| x64 DMG | `9277c2a3-3542-4add-b186-197c1f3b4bd9` | Accepted | 2026-10-10T05:19:35.113Z | 0 / null |

4 次提交均只在 Accepted 后继续。APP、DMG 的 Staple 与 validate 全部成功。未出现 Invalid/Rejected，未重试提交；内置集成的有限 Staple 重试机制没有被改为无限重试。

所有日志保存为 `audit/notary-log-<Submission ID>.json`。两个 APP 原始提交容器保存于 `audit/inputs/`，其 SHA-256 与 Apple 日志一致；它们是 **Staple 前审计输入，禁止分发**。Apple DMG 日志中的 SHA-256 对应提交前镜像，最终表中的 SHA-256 对应 Staple 后冻结镜像，两者不能混用。

## 6. APP、DMG、ZIP 最终验收

实际执行并通过：

```sh
codesign --verify --deep --strict --all-architectures <APP>
xcrun stapler validate <APP>
spctl --assess --type exec --verbose=4 <APP>
hdiutil verify <DMG>
xcrun stapler validate <DMG>
spctl --assess --type open --context context:primary-signature --verbose=4 <DMG>
unzip -tq <ZIP>
```

另对所有 Mach-O/slice 及 bundle 执行带 Developer ID 证书类型/Team requirement 的严格代码验证，检查签名详情、安全时间戳和最小 Entitlements。APP Gatekeeper 实际输出为 `accepted`、`source=Notarized Developer ID`；DMG 的适用 assessment 同样通过。

两套最终 DMG 正常只读挂载，内含 `.DS_Store`、`.VolumeIcon.icns`、`.background.tiff`、`Snipvia.app` 和指向 `/Applications` 的 Applications 链接。布局配置、图标及背景文件齐全；Finder 实际视觉拖拽尚待人工验收。

ZIP 正常解压，仅包含完整 Snipvia.app 及包内合法符号链接。暂存 APP、实际 DMG 内 APP 和 ZIP 解压 APP 的 Info.plist、ASAR SHA-256、14 个主要 Mach-O 的字节 SHA-256/架构逐项一致，签名、票据和 Gatekeeper 均通过。两架构 ASAR SHA-256 相同：`3179ad4914fe1a19e99949b09cb1bafb8913d58358590c31c08498df663fbbcc`。

由于已有 `/Applications/Snipvia.app`，从实际 DMG 复制到新建隔离 Applications 目录进行运行回归。复制后再次验证签名/票据/架构，回归结束后再次验证并删除本次安装副本；既有安装保留。这验证了复制安装与删除副本流程，不能代替 Finder 对既有安装的拖拽替换/卸载验收。

## 7. 本机回归与自动化结果

| 执行内容 | 通过 | 失败 | 实际证据 |
| --- | --- | --- | --- |
| pnpm native:build、pnpm build（包含 typecheck） | 已通过 | 0 | release.log，双架构 Swift 与生产编译 |
| 已签名 arm64 APP 提前 UI / IPC / fallback | 2 | 0 | runtime-preliminary.log |
| 已签名 arm64 APP 提前 packaged ASAR / Node | 1 | 0 | commands-preliminary.log |
| 最终 arm64 DMG 安装副本 UI / IPC / fallback | 2 | 0 | runtime-installed.log；8.8 秒 |
| 最终 arm64 DMG 安装副本 packaged ASAR / Node | 1 | 0 | commands-installed.log |
| 最终 x64 DMG 安装副本 / Rosetta 首轮 | 1 | 1 | runtime-installed-x64-rosetta.log；正常启动测试在 Electron.launch 45 秒超时，页面测试 36.2 秒通过 |
| 同一 x64 正常启动诊断复测，测试器等待上限 90 秒 | 1 | 0 | runtime-x64-rosetta-diagnostic.log；37.6 秒完成，process.arch=x64，原功能断言不变 |
| 最终 x64 DMG 安装副本 / Rosetta packaged ASAR / Node | 1 | 0 | commands-installed-x64-rosetta.log；42.2 秒，保留原测试时限 |
| Helper 自检脚本的 5 次实际执行 | 4 | 1 | 首次 arm64 ping 超过原始 2 秒；未放宽断言的复测、x86_64/Rosetta、两个最终 DMG 安装副本的完整自检均通过 |
| 本阶段 pnpm test / 完整 lint / 37 个发布 Mock | 未执行 | 不计结果 | 复用第三阶段证据，未修改产品代码或发布配置 |

Playwright 实际执行共 **9 次通过、1 次失败**，所选择测试没有 skip；Helper 脚本实际为 **4 次通过、1 次失败**，不把脚本内部断言拆成虚构测试数量。第三阶段 939/37 不合并到本阶段计数。

临时测试器命令为：

```sh
pnpm exec playwright test --config <audit临时配置>
pnpm exec playwright test --config <commands临时配置> --grep 'packaged ASAR'
# 仅用于定位 Rosetta 启动超时；不改变 APP 或安全权限：
pnpm exec playwright test --config <audit临时配置> --grep 'signed normal application' --timeout=90000
node <基于原 scripts/test-native-helper.mjs 的安装副本自检>
```

原始日志、失败 Trace 和可复查测试器存于 audit，临时绝对路径见日志及 `audit/test-harness/`。首次 Rosetta Trace 明确停在 Launch electron，测试主体尚未进入。90 秒仅为临时测试器诊断上限，原失败保留；APP、Hardened Runtime、Entitlements、Helper 自检 2 秒截止及功能断言没有修改。当前不能确定启动延迟的根因，也不能把 Rosetta 耗时归因于 Intel 真机性能。

最终安装副本已验证正常启动/关闭、主窗口和设置/历史页面、预加载 capture/pin 资源、安全 IPC、临时配置 F17/F18/F19 的真实快捷键注册（未物理触发）、Electron→签名 Helper 的 ping、合成截图框选/预览、注入 Helper 故障后 Electron fallback、ASAR 内沙箱依赖和自带 Node 执行。

Helper 原有自检验证 ping、captureSessionId、合成图片 OCR、未知命令拒绝、取消、dispose。权限拒绝与允许状态仅在测试进程 Mock；所有框选帧为合成数据，阻止真实 Helper 采集。没有真实录屏、登录生产账号、使用真实 API Key 或修改 TCC。命令测试复用既有测试的进程内合成资格，仅操作临时合成笔记；生产账号/会员权限链路未验证。没有修改 APP 文件或持久化业务配置。

独立 codesign 复核曾因工具沙箱无法访问系统验证服务而失败；相同只读检查在本机权限下通过。另一个 EOF 短诊断没有有效 ping 数据，未计为通过。临时容器检查曾沿用“Both architecture”通用末行，原日志附范围更正，本轮数据始终按实际架构记录。

## 8. 打包安全与质量

两个架构各 5974 个 ASAR 条目；APP 实体文件与 ASAR 内未匹配 .env、私钥、证书导出、钥匙串等敏感文件名，项目 out 文本未匹配常见完整私钥/API Key 模式。没有新增凭据文件或敏感日志。该模式扫描不等于对任意格式秘密的形式化保证。

项目自身 Source Map 为 0，第三方依赖 Source Map 为 879，延续第三阶段记录的生产策略。图标、Assets.car、TrayTemplate 两种尺寸、NSScreenCaptureUsageDescription、NSAppleEventsUsageDescription 和原 Helper 资源路径均正确。

测试用户目录真实路径隔离已断言；macOS `/var` 与 `/private/var` 别名按 realpath 比较。测试输出没有覆盖 docs/ui 既有截图。没有修改业务文件、依赖、系统信任或已签名 APP 内容。

## 9. 冻结产物与 SHA-256

冻结时间：2026-10-10T05:43:57.628Z。版本均为 0.2.1。

APP 保留于本次独立暂存目录，文件内容总量不重复跟随符号链接，不包含目录分配/xattr 大小：

| 架构 | APP 相对本次输出的路径 | 内容字节 | 文件数 |
| --- | --- | --- | --- |
| arm64 | `mac-arm64/Snipvia.app` | 351338146 | 906 |
| x64 | `mac/Snipvia.app` | 357758932 | 906 |

最终分发目录：[verified](../dist/macos-release/0.2.1-2026-10-10T04-27-38-351Z-d03b6c05/verified)。最终镜像完成 Staple 后计算；冻结复核同时校对原文件、verified 副本及容器检查结果。

| 文件 | 字节 | 最终 SHA-256 |
| --- | --- | --- |
| Snipvia-0.2.1-arm64.dmg | 139381668 | `9fb13a8d67049bcb6222c494e7255d88745109e8d89e74965fe7e73a286f302b` |
| Snipvia-0.2.1-arm64.zip | 139300536 | `6c8aa9c598f27a76ab7671ff1f0eda7124412497dfe04faf79d65c47fb1fea5a` |
| Snipvia-0.2.1-x64.dmg | 146128545 | `4211f13634248b301da42c5e26da9e93c8e8f0dbf0c625a45ba926927ae8f25a` |
| Snipvia-0.2.1-x64.zip | 146103674 | `5ba93b5fbcbaf22f69f7c88f75db5c1af01e181a53cfa6430fa00ef4aa102297` |

- [SHA256SUMS.txt](../dist/macos-release/0.2.1-2026-10-10T04-27-38-351Z-d03b6c05/verified/SHA256SUMS.txt)
- [原发布入口验收结果](../dist/macos-release/0.2.1-2026-10-10T04-27-38-351Z-d03b6c05/verified/verification.json)
- [最终产物、APP、Submission ID、源码状态清单](../dist/macos-release/0.2.1-2026-10-10T04-27-38-351Z-d03b6c05/audit/final-manifest.json)

audit 还保存两套 APP 的完整文件内容 SHA-256/符号链接清单、48 条代码/slice 签名及 Entitlements、Apple 日志、基线、编译输入及运行证据。verified 不含旧 blockmap/自动更新元数据或公证前审计 ZIP。冻结后不再修改 APP/DMG/ZIP；后续如改变内容，应重新执行对应签名、公证和校验。

## 10. 未完成的人工验收与风险

| 级别 | 实际风险 / 状态 | 下一步 |
| --- | --- | --- |
| P0 | 未发现凭据泄露、越界发布或安全机制关闭 | 保持现有边界 |
| P1 | 当前没有已确认且未解决的签名、公证、完整性或 Apple Silicon 自动化阻塞 | 真实人工验收如发现 P1，停止公开发布并定位；不能放宽安全检查 |
| P2 | 首次 Helper 2 秒 ping 超时，原时限复测与最终安装自检通过，根因未确认 | 在正式 Finder 安装及冷启动环境回归 Helper 与首次真实截图 |
| P2 | Rosetta 首次 Electron.launch 45 秒超时；90 秒诊断完成，模拟测试启动较慢 | 保留失败；在 Intel 真机验证正常启动、功能、性能与最小 Entitlements |
| P2 | Intel 真机、最低 macOS 14.0 实机尚未验证 | 不宣称 Intel 端完整兼容或最低系统真实运行已通过 |
| P2 | 真实录屏 TCC、物理快捷键、真实框选/预览、多显示器、权限重授予与 Helper 真实帧尚未验证 | 用户明确授权后操作，不自动修改系统隐私权限 |
| P2 | AI 浮窗、真实账号/Provider/API Key、Apple Events 日历/提醒事项尚未验收 | 用户提供交互与授权，验证最小 Entitlements 下的真实链路 |
| P2 | Finder 对既有安装的实际拖拽替换/卸载、隔离下载首启与离线验收未执行 | 本阶段仅复制/删除隔离安装副本；需要人工补齐 |
| P2 | 构建包含未提交内容，非干净提交 | 保留当前工作区、源码基线与编译输入；不要把未来重新构建视为同一冻结产物 |
| P2 | 第三方依赖 Source Map 879 个；APP Submission ID 由本次临时记录器持久化 | 后续版本单独评估裁剪策略及将审计记录器纳入正式入口；本次冻结产物不修改 |

人工验收前没有公开分发条件全部满足的结论。完成上述必要人工项目后，使用同一冻结文件与校验清单，由用户再次明确批准公开发布；本阶段到此停止。
