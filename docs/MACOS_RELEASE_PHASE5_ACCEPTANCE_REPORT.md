# Snipvia Phase 5 正式安装包人工验收与发布准备报告

## 1. 当前结论

**最新阶段性结论：存在阻断问题，不建议分发。** 用户反馈首次无录屏权限时提示不及时、进入系统设置后应用未自动出现在列表；静态复查确认冻结候选存在对应权限引导缺口，详见第 8 节。原签名、公证票据与完整性复核仍通过，但不能替代首次使用体验。其他真实安装、截图、AI 及性能人工结果尚待提供，**Phase 5 未完成**。

只有完整人工验收通过、风险处置明确，才建议进入公开发布阶段。没有重新构建、签名、公证或 Staple，没有修改冻结 APP，没有覆盖现有安装，没有公开上传、触发自动更新或调用真实模型 API。

53 项人工执行表见[详细中文清单](MACOS_RELEASE_PHASE5_MANUAL_CHECKLIST.md)。其中每项均包含步骤、预期、实际结果、状态、证据位置和风险，全部暂为未执行；收到实际结果后再更新本报告。

## 2. 基线与检查范围

| 项目 | 本轮实际结果 |
| --- | --- |
| Phase 4 基线 | 已重新读取[报告](MACOS_RELEASE_PHASE4_REPORT.md)；未将历史 Mock、合成截图或 Rosetta 结果算作本轮真实验收 |
| 执行日期 | 2026-10-10，自动化完成时间 2026-10-10T06:33:41Z |
| Mac | Apple M1 Pro、arm64、macOS 27.0.1（26A434）；不是 Intel 真机，也不是 macOS 14 |
| 系统安全策略 | `spctl --status` 为 `assessments enabled`；没有改变 Gatekeeper 或 TCC |
| 当前提交 | `c414cdd991733ffb8bb4ee88dd53cdb22a691744`；保留全部既有未提交修改 |
| 已安装应用 | `/Applications/Snipvia.app`，版本 0.2.0、Bundle ID com.snipvia.desktop、Ad-hoc 签名，TeamIdentifier 未设置；它不是本次正式候选 |
| 数据与备份 | 仅检查 Application Support 下 Snipvia/snipvia 目录存在；未读取用户数据内容；备份及覆盖安装决定均待用户确认 |
| 正式候选 | Snipvia 0.2.1 / 截然，com.snipvia.desktop，最低 macOS 14.0；主程序/Framework 分别 arm64、x86_64 |
| 冻结输入 | 仅使用 Phase 4 [verified](../dist/macos-release/0.2.1-2026-10-10T04-27-38-351Z-d03b6c05/verified) 中四个分发文件；未使用 Staple 前审计 ZIP 或 Phase 3 测试包 |
| 新证据目录 | [phase5-20261010T062953Z-3d83f330](../dist/macos-acceptance/phase5-20261010T062953Z-3d83f330)，与冻结目录隔离 |

当前旧版签名状态不影响冻结候选的验证结论；旧版权限是否可被正式签名版本复用，需由用户实际观察，不能假设升级后 TCC 无变化。

## 3. 本轮安全自动化结果

先核对全部四个文件的大小和 SHA-256；一致后才开始镜像挂载和 ZIP 解压。检查入口已重新读取：`verify.cjs` 仅调用 verifyApp/verifyDmg/verifyZip；这一调用路径不会触发签名、notarytool submit 或 stapler staple。

```sh
# FILE 是本次 verified 下的绝对文件路径；两种架构各执行一次：
node scripts/macos-release/verify.cjs --dmg FILE --arch arm64
node scripts/macos-release/verify.cjs --zip FILE --arch arm64
node scripts/macos-release/verify.cjs --dmg FILE --arch x64
node scripts/macos-release/verify.cjs --zip FILE --arch x64
```

精确命令、退出码和日志分别保存为证据目录中的 `arm64-dmg-verify.*`、`arm64-zip-verify.*`、`x64-dmg-verify.*`、`x64-zip-verify.*`。

| 自动检查 | arm64 | x64 | 执行依据 / 证据 |
| --- | --- | --- | --- |
| 冻结文件哈希、大小（开始与结束） | DMG、ZIP 已通过 | DMG、ZIP 已通过 | hashes-before.json、hashes-after.json；两次均四个文件一致 |
| 四个容器验收入口 | DMG、ZIP 已通过 | DMG、ZIP 已通过 | 4 次命令均退出 0，无失败或跳过 |
| DMG 格式与只读挂载 | 已通过 | 已通过 | hdiutil verify、attach -readonly；正常卸载，未安装 APP |
| DMG Developer ID、时间戳 | 已通过 | 已通过 | 带 Apple Developer ID 证书类型及 Team requirement 的严格验证 |
| DMG 公证票据与 Gatekeeper | 已通过 | 已通过 | stapler validate、spctl type open；入口要求 accepted 且 source=Notarized Developer ID |
| ZIP 完整性及路径安全 | 已通过 | 已通过 | unzip -tq；检查唯一条目、仅 Snipvia.app、无路径越界、合法包内符号链接；ditto 临时解压 |
| 实际 DMG 内 APP 与 ZIP 解压 APP | 均已通过 | 均已通过 | 各执行 codesign --verify --deep --strict --all-architectures、票据和 spctl exec 验证 |
| APP/嵌套 Developer ID、Team、Runtime、时间戳 | 已通过 | 已通过 | 每个 APP 14 个 Mach-O、9 个 bundle；Helper 两个 slice 均检查；无 Ad-hoc/未签名组件 |
| 最小 Entitlements | 已通过 | 已通过 | 主 APP 为 allow-jit、automation.apple-events；Electron Helpers 仅 allow-jit；Swift/其他原生为空字典 |
| 架构及 Helper | 已通过 | 已通过 | 主程序/Framework 匹配目标；Swift Helper Universal arm64+x86_64；原生组件逐项校验 |
| 全部文件内容与 Phase 4 清单比对 | DMG、ZIP 均已通过 | DMG、ZIP 均已通过 | 四个 inspection.json：各 906 个实体文件、14 个符号链接，差异 0 |
| 镜像布局资源 | 已通过结构检查 | 已通过结构检查 | dmg-layout.json：APP、.DS_Store、背景、卷图标、Applications→/Applications；Finder 视觉仍待人工 |
| 现有安装保护 | 已通过 | 不适用 | existing-installation-after.json：现有 APP 内容/符号链接变化 0；未执行覆盖、卸载、启动 |
| 工作区保护 | 已通过 | 不适用 | workspace-before/after-automation.txt 一致，验证脚本与配置输入哈希漂移 0 |

内容检查由本轮临时审计工具 `inspect.cjs` 完成，工具与 `inspection.log` 保存于新证据目录。四个容器内容审计均通过。签名摘要中每个 APP 有 15 条 Mach-O slice 记录（Universal Helper 占两条）；9 个 bundle 另由原验收入口检查，不将这些组件数量虚构为单元测试数量。

本轮未运行 pnpm build、native:build、单元测试、Playwright 或合成截图自检：它们不能替代这次真实用户验收，部分入口还会重新构建。第三阶段 939 项单元测试及 37 项 Mock 仅作为历史证据，不加入本轮通过数量。

### 内容与敏感文件审计

- 四个实际 APP 的完整内容哈希/符号链接均匹配 Phase 4 冻结清单；ASAR SHA-256 都为 `3179ad4914fe1a19e99949b09cb1bafb8913d58358590c31c08498df663fbbcc`。
- 每个 APP 检查 5974 个 ASAR 条目及包内实体文件名；未匹配 .env、常见私钥、证书导出、钥匙串、credentials/secrets 文件名。135 个项目 out 文本文件未匹配完整私钥、AWS/常见模型/Google Key 模式。没有输出任何匹配值。模式检查不能保证识别任意格式秘密；真实运行日志的 Key 隐私仍待人工检查。
- 项目自身 Source Map 0，第三方依赖 Source Map 879，保持 Phase 4 内容。verified 仅含四个分发包、SHA256SUMS.txt 与 verification.json，不含新的审计输入或自动更新元数据。
- 图标、Assets.car、两种尺寸 TrayTemplate 和唯一原生 Helper 均存在。屏幕录制及 Apple Events 用途描述完整；另有 Electron 默认英文相机、麦克风、蓝牙、音频捕获用途描述，记录为后续版本的范围审查项，不修改本候选。
- 所有提取与挂载只发生在本轮新建临时目录；检查后均卸载并清理本轮副本。没有读取私人截图、账号资料或现有历史文件。
- `xattr` 只读检查显示四个冻结分发文件均没有 `com.apple.quarantine` 属性；结果见 frozen-directory.json。因此本轮 Gatekeeper assessment 通过不能代替官网下载后带隔离属性的首次启动体验；未增加或移除任何属性。

## 4. 最终冻结文件与 SHA-256

下表为本轮重新计算值，与 Phase 4 报告完全一致；检查结束后再次计算，仍全部一致。

| 文件 | 字节 | SHA-256 | 状态 |
| --- | --- | --- | --- |
| Snipvia-0.2.1-arm64.dmg | 139381668 | `9fb13a8d67049bcb6222c494e7255d88745109e8d89e74965fe7e73a286f302b` | 已通过 |
| Snipvia-0.2.1-arm64.zip | 139300536 | `6c8aa9c598f27a76ab7671ff1f0eda7124412497dfe04faf79d65c47fb1fea5a` | 已通过 |
| Snipvia-0.2.1-x64.dmg | 146128545 | `4211f13634248b301da42c5e26da9e93c8e8f0dbf0c625a45ba926927ae8f25a` | 已通过 |
| Snipvia-0.2.1-x64.zip | 146103674 | `5ba93b5fbcbaf22f69f7c88f75db5c1af01e181a53cfa6430fa00ef4aa102297` | 已通过 |

本轮只有 stapler **validate**，没有重新 Staple 或提交 Apple。Phase 4 的 Accepted Submission ID 保持历史记录，参见原报告；本轮结果表示现存签名/票据有效，不表示新完成了一次 Apple 公证。

## 5. 真实环境验收状态

| 领域 | 状态 | 本轮实际结果 / 尚需证据 |
| --- | --- | --- |
| Finder 打开、布局、拖拽安装 | 需要人工验证 | 文件结构已检查，视觉、拖拽和替换未执行；先备份并由用户决定替换 0.2.0 |
| 用户正常启动、Dock/菜单、关闭与重启 | 未执行 | 没有启动冻结 APP；无真实启动耗时 |
| 升级数据保留、真实卸载/重装 | 未执行 | 旧安装内容保持不变，用户资料未读取；备份、数据迁移及卸载人工行为待确认 |
| 首次权限、拒绝提示、同意、撤销与恢复 | 用户报告问题；需修复与复验 | 用户反馈首次提示及系统列表登记有问题；静态缺口已确认。测试 APP 版本待确认，其他权限情形仍未验证；助手未重置/修改 TCC |
| 物理快捷键、真实框选/预览、复制/保存 | 未执行 | 没有真实画面采集或自动按键 |
| Helper 实际原生帧、IPC、故障 fallback | 未执行 | 已验证二进制与签名；没有真实 capture 成功或 fallback 新证据 |
| Retina、多显示器、取消/连续截图 | 未执行 | 待用户设备条件与实际操作 |
| AI 浮窗、上传理解、多轮、流式、模型切换 | 未执行 | 等待用户测试账号、无隐私选区上传及费用确认；实际模型请求 0 |
| 网络/认证失败、历史恢复、账号退出、日志 Key 隐私 | 未执行 | 不读取/改写现有账号或 Provider；用户本机测试与脱敏反馈后更新 |
| Apple Silicon 完整实机回归 | 未执行 | 本轮是 M1 Pro 上静态/容器检查，不能宣称真实使用回归通过 |
| Intel 真机 | 未执行 | 尚未提供真机测试结果；x64 构建/签名/公证历史通过，不能等同 Intel 真机运行 |
| macOS 14 最低系统 | 未执行 | 当前机器 27.0.1，LSMinimumSystemVersion=14.0 不能证明最低系统运行 |
| 性能与稳定性 | 未执行 | 没有首次/热启动、真实浮层/像素/AI 耗时或 CPU/内存新样本 |

### 性能风险的证据边界

Phase 4 保留了 Rosetta 首次 Electron.launch 45 秒超时，补充诊断随后通过；37.6 秒是整项测试完成时间，不能直接当作用户点击到可交互时间，也不能归因于 Intel 真机。Phase 4 首次 Helper ping 超过 2 秒，原时限复测通过；本轮没有将其重新计为首次通过。

项目[已有捕获诊断文档](CAPTURE_LATENCY_DIAGNOSIS.md)另记录开发/测试路径的原生 500ms 超时、Electron 回退和约 690–761ms 完整画面等待。该文档不是本轮冻结 APP 的实机证据，也不能据此认定正式包必然失败；但必须重点核实真正原生捕获成功率、后台首次截图和完整像素延迟。浮层迅速出现不能证明 ScreenCaptureKit 已成功取得像素。

## 6. 风险与停止条件

| 编号 / 级别 | 风险 / 当前状态 | 最小处理建议 |
| --- | --- | --- |
| R00 / P0 | 未发现冻结文件变化、凭据打包或安全机制关闭；尚未检查真实运行日志 | 人工如发现泄露/越权/哈希变化立即停止；不分享明文秘密，不就地重新签名 |
| R01 / P1 验收门槛 | 真实安装、数据迁移、授权、截图和 AI 核心链路尚未验收，公开发布条件未满足；不是已确认产品缺陷 | 先完成 I/T/C/A 核心项目，获得证据；失败则定位最小修复、等待批准新候选 |
| R02 / P2 | 现有 0.2.0 为 Ad-hoc，备份与手动替换未确认，正式版本权限继承情况未知 | 用户本地备份、退出旧版，决定手动覆盖；实际权限行为逐项记录 |
| R03 / P2 | 首次 Helper 超时及历史原生捕获回退，根因尚未确认 | 少量首次/后台截图；记录 native success/timeout 计数、真实像素及耗时；持续核心失败升级 P1 |
| R04 / P2 | Rosetta 首轮启动超时，没有 Intel 真机性能证据 | Intel 真机正常启动计时及功能回归；保持未验证状态 |
| R05 / P2 | macOS 14、Intel、多显示器/缩放设备覆盖不足 | 记录可用设备；核心支持声明需对应真实结果，不用架构/系统标识替代 |
| R06 / P2 | 人工 Helper 故障不一定导致实际 fallback；重启恢复与回退不同 | 只操作本人测试实例，保留回退诊断；无法安全复现时保持未执行 |
| R07 / P2 | 第三方 Source Map 879；默认额外隐私用途描述 | 后续版本单独审查分发策略和描述范围，不扩大 Entitlements，不改冻结 APP |
| R08 / P2 | 本地冻结文件的启动不能完整模拟官网下载后的隔离/quarantine 首启体验 | 不人工增加/去除 quarantine；记录真实来源和系统提示，公开发布前补相应用户环境证据 |
| R09 / P2 | 已批准构建包含未提交工作区内容 | 保留 Phase 4 源码/编译输入基线；后续重建必须作为新候选，不沿用当前哈希验收 |
| R10 / P1 | 首次录屏请求的状态条件无效；后台截图权限提示不可见；打开设置未触发申请 | 暂停分发准备；先批准第 8 节的最小源码修复，完成 Mock 与用户首次授权复验；产生新候选时重新执行受影响发布流程 |

初轮自动化没有发现签名/容器缺陷；后续用户反馈与静态复核新增确认 R10 的 P1 权限引导问题。R01 是其他尚未完成的验收门槛。涉及业务代码/配置修复时先提交最小方案等待确认，再对新候选重新执行受影响流程。

## 7. 待用户操作与后续交付

1. 先按清单 I01–I03 确认当前安装、备份、Finder 布局；回复是否决定自己手动覆盖安装。助手不会代为覆盖或卸载。
2. 明确同意在无隐私测试画面上执行真实截图后，由用户完成权限与本地截图项目；记录首次/热启动、完整像素耗时和原生成功/回退证据。
3. AI 路径单独确认账号、Provider/模型、费用上限及选区上传许可，再进行少量请求。API Key 仅在应用本地输入。
4. 说明 Intel、macOS 14、第二显示器的设备条件；缺少的项目保持未执行。
5. 用户按清单编号提交实际结果后，再汇总本报告中的真实安装、截图、AI、权限恢复、性能、兼容性与风险，并给出最终发布建议。

本轮新增两个文档；审计工具/结果仅写入独立 `dist/macos-acceptance`。自动化前后 git 状态一致；后续写入本报告与清单是本次明确要求的文档变更，未改业务代码、依赖、发布配置或现有未提交内容。

**当前暂停等待人工结果。未授权公开发布，不上传官网、GitHub Releases、对象存储，不触发自动更新。**

## 8. 用户反馈：首次录屏权限引导阻断及最小修复提案

用户反馈：首次使用缺少录屏权限时，应立即弹窗引导；进入系统设置后，应出现当前应用，无需用户自行添加。用户实际测试的 APP 版本/启动路径尚待确认；下述代码缺口已在当前源码及冻结 arm64 ZIP 内主进程代码中确认。读取 ZIP 前重新核对其 SHA-256，一致；临时提取的 ASAR 哈希也与冻结基线一致，没有修改 APP。双架构 ASAR 的一致性见第 3 节。

### 已确认的根因

1. `src/main/index.ts` 的首次请求仅在 `permission === 'not-determined'` 时调用 desktopCapturer。Electron 44.4.1 将 screen 状态查询委托给 Chromium；对应 Chromium 152.0.7977.78 实现仅将屏幕权限映射为 Allowed/Denied。因此首次未授权也进入 denied 分支，不能以 not-determined 区分“从未申请”和“用户拒绝”。参考 [Electron 44.4.1 源码](https://raw.githubusercontent.com/electron/electron/v44.4.1/shell/browser/api/electron_api_system_preferences_mac.mm)、[对应 Chromium 实现](https://raw.githubusercontent.com/chromium/chromium/152.0.7977.78/chrome/browser/permissions/system/system_media_capture_permissions_mac.mm)。
2. 快捷键/菜单的 `announceError()` 只向主窗口发 capture:error，没有显示并聚焦主窗口。Renderer 会设置权限弹窗状态，但窗口在后台/隐藏时用户看不到。
3. `permissions:open-screen-settings` 仅调用系统设置 URL，没有先触发系统录屏权限申请。权限卡还把手动添加应用作为常规引导，未建立主动申请→系统登记→用户开启的流程。

### 等待批准的最小修改范围

- 主进程/平台权限逻辑：把检查前置到截图入口；未授权立即显示明确的权限引导，覆盖普通截图、AI、快捷键、菜单和续拍入口。权限错误与普通截图失败分开处理，重复触发不叠加弹窗。
- 为“打开录屏设置”增加一次用户主动触发的权限申请步骤，优先复用现有 Electron 主应用请求链路，随后跳转系统设置。不能依赖 screen 的 not-determined，不能调用不受支持的 askForMediaAccess('screen')。不要通过 Swift Helper 单独申请导致错误的权限主体；如 Electron 链路无法满足登记验收，再提交最小原生桥接方案，不能直接扩大改动。
- 权限卡：主操作引导用户开启列表中的当前正式应用，不把手动浏览添加作为正常流程；保留系统未显示条目时的故障说明。系统控制权限列表及开关，不能保证以代码强写任意环境的列表，也不会自动开启权限。
- 从系统设置返回时重新检测；明确显示已授权、仍未授权或需按系统要求重启。避免继续使用过期的已授权缓存。不得未经确认重启应用或清理资料。
- 补针对性 Mock 回归：首次 screen 返回 denied、后台快捷键提示可见、重复触发去重、按钮先请求再打开设置、拒绝/恢复以及 Windows 路径不受影响。Mock 不能证明真实 TCC 列表登记成功，仍需用户在合适测试账号/设备复验。

预计修改 `src/main/index.ts`、`src/main/platform/index.ts`、`src/renderer/src/permissions/ScreenPermissionCard.tsx` 及直接相关测试；需要时只新增一个集中权限流程辅助文件。保持已有页面样式、Bundle ID、Helper 路径、截图架构、Entitlements 和依赖。

Apple 提供权限检查/请求 API，由系统处理用户授权，见 [Apple DTS 对支持 API 的说明](https://developer.apple.com/forums/thread/839069?answerId=898801022)。Electron 的 askForMediaAccess 仅支持 camera/microphone，见[官方文档](https://www.electronjs.org/docs/latest/api/system-preferences#systempreferencesaskformediaaccessmediatype-macos)。自动登记的实际主体及显示行为必须通过正式应用首次授权实机验收，不在本次静态审计中宣称已实现。

本次只更新问题记录和修复提案，**未修改产品源码、未执行真实权限申请、未重新构建/签名/公证**。批准源码修复不自动授权正式再打包；冻结产物继续保持原样，后续新候选另行确认。
