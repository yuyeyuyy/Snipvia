# macOS 正式签名、公证与分发

> 2026-10-16 Phase 1 更新：当前源码的版本检查、下载和新发布目标已统一改为 `yuyeyuyy/Snipvia`。本文中旧发行记录与旧渠道说明仅用于历史过渡；新免费版尚未发布，旧安装包不会因源码变更自动切换渠道。详见 [Phase 1 报告](opensource/PHASE1_REPORT.md)。

## 当前实施状态与阶段边界

本流程面向官网直接下载的 macOS 14+ 应用，使用 Developer ID Application 签名，分别生成 arm64、x64 DMG 和 ZIP，不进行 Universal 合并，不发布到 Mac App Store。

2026-10-10 完成第二阶段配置编写，尚未运行静态检查、构建验证、正式签名、公证或发布打包。配置不代表已通过 Apple 公证或双架构功能验收。

阶段边界如下：

1. 第一阶段：只读检查与方案。
2. 第二阶段：修改配置、脚本和文档；只读诊断钥匙串；不签名、不公证、不上传。
3. 第三阶段：经确认后运行静态检查、测试、合成截图烟测和明确禁用签名、公证的构建验证。
4. 第四阶段：再次确认后执行正式签名、Apple 公证、Staple 与发布产物验收。上传官网仍是单独操作，脚本不会自动上传官网。

## 签名身份与已解决的环境问题

本机识别的身份为 `Developer ID Application: chen houbiao (F76JCDMA4Y)`，指纹为 `BFF84DE0E09178F88BABE1BAD7C60F6B0FFECD8F`。公开证书有效期为 2026-10-10 至 2031-09-17。

以下为修复前的只读诊断记录：

| 检查 | 结果 |
| --- | --- |
| `security find-identity -p basic` | 找到 Developer ID Application 和 Installer，均报告 `CSSMERR_TP_NOT_TRUSTED` |
| `security find-identity -v -p codesigning` | 0 个有效身份 |
| 私钥配对 | `SecIdentityCopyPrivateKey` 成功，`kSecAttrCanSign=true` |
| 钥匙串 | 位于 `login.keychain-db`，在用户搜索列表内；已解锁、可读 |
| 访问控制元数据 | 读取成功，5 条 ACL；没有修改 ACL |
| 用户、管理员信任覆盖 | 未发现自定义信任设置 |
| 公开证书 `codeSign` 策略 | 证书链验证通过 |
| 公开证书 `basic` 策略 | 报告 `MissingIntermediate`，无法找到下一张中间证书，构建信任链失败 |

此前阻塞是基础信任链无法找到中间证书，不是已发现私钥缺失。用户已处理环境问题；2026-10-10 本次只读复查 `security find-identity -v -p codesigning` 返回上述 Developer ID Application 身份及 `1 valid identities found`。当前签名身份阻塞已解除。实际 `/usr/bin/codesign` 使用私钥的授权仍需第四阶段验证。

若未来复发，可由用户在钥匙串访问中核查 Developer ID G2 中间证书，从 [Apple 官方 PKI 页面](https://www.apple.com/certificateauthority/) 的 Developer ID - G2 获取公开证书。不要删除现有证书、重新签发证书，或把证书改成“始终信任”来绕过问题。本项目脚本不会自动导入证书、修改信任、解锁钥匙串或放宽私钥访问控制。

必要时只读复查：

```sh
security find-identity -v -p basic
security find-identity -v -p codesigning
```

正式流程仅接受第二条命令列出的、与指定 Team ID 相符的有效 Developer ID Application 身份。

## 独立配置与现有流程

| 文件 | 用途 |
| --- | --- |
| [electron-builder.macos-release.cjs](../electron-builder.macos-release.cjs) | 继承原配置，强制正式签名、公证及两种架构 |
| [electron-builder.macos-validation.cjs](../electron-builder.macos-validation.cjs) | 第三阶段用；显式禁止签名、公证，仅生成应用目录 |
| [common.cjs](../scripts/macos-release/common.cjs) | 有效身份筛选、版本锁定、凭据环境隔离、原生代码清单及产物验证 |
| [hooks.cjs](../scripts/macos-release/hooks.cjs) | 构建前强制检查、自定义嵌套代码签名、APP 公证后验收 |
| [preflight.cjs](../scripts/macos-release/preflight.cjs) | 本地发布预检；不上传、不调用公证提交 |
| [release.cjs](../scripts/macos-release/release.cjs) | 第四阶段正式发布入口；必须显式传入 `--execute` |
| [verify.cjs](../scripts/macos-release/verify.cjs) | 独立验收 APP、DMG 或 ZIP |
| [test-update.cjs](../scripts/macos-release/test-update.cjs) | 经授权的隔离 Mac 原生更新测试；只签名独立测试包，不公证或公开发布 |
| [publish.cjs](../scripts/macos-release/publish.cjs) | 独立公开分发入口；默认检查计划，明确执行后才上传草稿并发布 |

原 [electron-builder.yml](../electron-builder.yml)、开发启动器、体验包及原 `pnpm dist:release` 保持原样；原 `dist:release` 仍是历史临时签名打包方式，不是本文的正式 macOS 发布入口。

公开发布目标为 `yuyeyuyy/Snipvia-releases`，统一配置在 `src/shared/release-source.json`。源码构建和 Apple 公证保持在受信私有环境；公开仓库仅校验分发文件。新验收报告包含 `updateRepository` 与 `autoUpdateEnabled`，公开上传器拒绝旧源报告。签名构建不自动上传 GitHub，正式发布使用[独立上传命令](UPDATE_CHECK.md#更新源和发布要求)。

正式输出位于 `dist/macos-release/<版本>-<UTC 时间>-<随机标识>/`，每次创建新目录，不删除或覆盖旧产物。全部架构验收通过后，先将官网分发的 DMG、ZIP、最终 SHA-256 和验证报告写入 `verified.pending/`，校验副本哈希，并基于最终冻结文件生成 `latest-mac.yml` 后原子改名为 `verified/`。失败时不会生成完整验收目录。不要分发 pending、父目录中的临时产物或原 builder 更新元数据；DMG Staple 后其哈希已变化。2026-10-12 已加入[最终元数据与手动下载 / 重启更新流程](UPDATE_CHECK.md)，此前冻结目录保持原样。

验证构建输出到 `dist/macos-validation/<时间戳>-<随机标识>/`，不会使用已有 `dist/mac*` 或 `dist/release-*`。

2026-10-12 已完成独立 Apple Silicon 测试包的真实下载、原生替换与重启验收，详见 [Mac 更新实机报告](MACOS_UPDATE_TEST.md)。该测试不改变正式发布的签名 / 公证门槛，不替换现用应用或原冻结发行包，也没有上传新版本。

Bundle ID `com.snipvia.desktop`、产品名称 `Snipvia`、显示名称“截然”、图标 `UI/Snipvia-2-mac.icon`、最低系统版本及原有资源映射全部继承。DMG 在原默认布局上开启签名，不改变拖拽安装布局。

## electron-builder 26.15.3 与最小权限

保持 electron-builder 26.15.3 和现有锁文件，不安装或升级依赖。签名脚本通过 electron-builder 的依赖解析路径复用已安装的 `@electron/osx-sign 1.3.3`；公证复用其内置 `@electron/notarize 2.5.0`。预检检查这些版本；升级时必须重新审核内部解析路径及 API。

v26 的 `identity`、`hardenedRuntime`、`entitlements`、`entitlementsInherit`、`timestamp` 等直接位于 `mac` 下；`mac.sign` 是自定义签名函数，`mac.notarize` 是布尔值。不要套用 v27 的嵌套签名对象格式。[v26 官方文档](https://www.electron.build/v26/docs/mac/)

正式配置通过有效身份的指纹选择证书，避免 v26 不接受带证书类型前缀的 `mac.identity` 名称限制。配置缺少预检指纹时使用失败哨兵值，绝不继承 `identity: '-'`。同时启用 `forceCodeSigning`、`type: distribution`、严格验证，签名失败立即退出，不提供临时签名或无签名降级。

| 代码 | 正式 Entitlements |
| --- | --- |
| Electron 主进程 | `allow-jit`、`automation.apple-events` |
| Electron Helpers | `allow-jit` |
| Swift Helper、Framework、其他原生代码 | 空权限字典 |

签名函数按实际文件指定权限，关闭自动追加权限。Swift Helper 不是 JavaScript 运行时，不继承 JIT 权限；使用固定代码签名标识 `com.snipvia.desktop.capture-helper`。不添加不存在的屏幕录制 entitlement，不启用 App Sandbox，不更改屏幕录制或 Apple Events 的用途说明。

移除正式权限中的 `allow-unsigned-executable-memory`、`disable-library-validation`；原开发权限文件保持不变。现代 Electron 的 JIT 使用 `allow-jit`，本项目没有启用浏览器原生插件功能。[Electron 公证说明](https://github.com/electron/notarize#prerequisites)

这组最小权限尚需第四阶段签名应用真机验证。必须检查截图、ScreenCaptureKit、OCR、AI 流式响应、代理命令、Apple Events、自启与 Electron Helper 启动；出现功能问题时停止分发并定位所需权限，不自动放宽或降级签名。

## 用户本机配置

当前默认使用已批准的 Team ID `F76JCDMA4Y`、身份指纹 `BFF84DE0E09178F88BABE1BAD7C60F6B0FFECD8F` 与钥匙串 Profile `snipvia-notary`。这些是公开标识，不是密码或私钥；Team ID 不允许通过环境变量更换为其他团队。用户已确认 Profile 保存及凭据验证成功；本阶段未再次调用远程凭据验证。

可显式设置相同的公开标识及 Profile 名称，不在项目内创建凭据文件：

```sh
export SNIPVIA_RELEASE_TEAM_ID=F76JCDMA4Y
export SNIPVIA_NOTARY_PROFILE=snipvia-notary
```

默认精确选择当前身份指纹。将来同团队证书轮换时，可设置 `SNIPVIA_SIGNING_IDENTITY` 为已获批准的新完整身份名称或指纹；仍须通过有效 Developer ID Application 筛选。签名证书在自定义钥匙串时，可设置 `SNIPVIA_SIGNING_KEYCHAIN` 为绝对路径；它必须已在用户搜索列表中。公证凭据在自定义钥匙串时设置 `SNIPVIA_NOTARY_KEYCHAIN` 为绝对路径。也接受 v26 的 `APPLE_KEYCHAIN_PROFILE` 和可选 `APPLE_KEYCHAIN`，推荐使用前述项目专用变量。

没有公证 Profile 时，由用户在本机终端交互式创建：

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  xcrun notarytool store-credentials "snipvia-notary"
```

按安全提示输入账号、Team ID 和 App 专用密码，不把密码放在命令行参数、Shell 历史、项目文件或聊天中。已有 API 凭据也可预先安全保存到 Profile；项目流程不直接读取 `.p8` 文件。

v26 内置公证先检查 Apple ID/API 环境变量，再检查钥匙串 Profile。正式入口为子进程移除 `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_API_*`、`CSC_*` 和调试日志变量，再仅设置 `APPLE_KEYCHAIN_PROFILE` 及可选 `APPLE_KEYCHAIN`。工具失败时包装脚本不回显参数、环境或原始错误载荷；验证报告仅保存公共签名标识、统计、提交 ID、状态及产物哈希。

`.gitignore` 增加私钥、证书私钥导出及钥匙串文件保护。忽略规则不是秘密存储机制，也不会移除已经跟踪的文件；任何凭据材料都应放在仓库外。

## 第三阶段验证计划

以下命令需第三阶段批准后运行：

1. 对新增 CJS 配置和脚本执行 `node --check`，对三个正式权限文件执行 `plutil -lint`。
2. 用当前 app-builder-lib 加载继承配置并验证 schema，检查标识、图标、资源、目标架构和签名字段，确认验证配置中签名、公证全为禁用状态。
3. 检查失败路径：缺少有效身份、Team ID 不匹配、凭据变量干扰、缺少明确执行参数、临时签名产物不得通过正式验收。凭据缺失或失效的远程验证留到第四阶段；第三阶段不调用 Apple 公证服务。
4. 运行 `pnpm lint`、`pnpm typecheck`、`pnpm test`；报告已有未提交工作带来的失败，不覆盖它们。
5. 运行 `pnpm native:build`、`pnpm build`，再用验证配置对两种架构执行无签名应用目录构建。
6. 运行采用临时存储与合成截图的 `pnpm test:smoke`；检查两种架构 Electron 主程序、Framework、Swift Helper 及图标资源。Intel 真机功能验证仍需单独记录。

无签名构建示例：

```sh
CSC_IDENTITY_AUTO_DISCOVERY=false \
  DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  pnpm exec electron-builder --config electron-builder.macos-validation.cjs \
  --mac --dir --arm64 --x64 --publish never
```

本地预检使用已配置的默认身份和 Profile，失败不触发签名：

```sh
node scripts/macos-release/preflight.cjs
```

## 第四阶段正式执行与验收

仅在第四阶段明确批准后运行：

```sh
node scripts/macos-release/release.cjs --execute
```

流程首先检查有效签名身份、团队及锁定的工具版本，再只读验证 Profile 可访问 Apple 公证服务。随后分别构建 arm64、x64 APP，按由内到外的顺序签名全部 Mach-O、嵌套 APP、Framework 和 Swift Helper；不使用全应用 `codesign --deep` 签名。`--deep` 仅用于验证。

每个原生代码切片检查 Developer ID 证书要求、Team ID、安全时间戳、Hardened Runtime 和匹配的最小权限。Electron 主程序及 Framework 必须匹配目标架构，Swift Helper 必须包含两种架构。磁盘映像不适用 Hardened Runtime，但必须有 Developer ID 签名、安全时间戳和有效公证票据。

内置 v26 流程使用 Profile 公证 APP 并 Staple，`afterSign` 对 APP 执行签名、票据和 Gatekeeper 验收，之后才生成签名 DMG 与 ZIP。最终 DMG 通过 `notarytool submit --wait` 获得 `Accepted` 后才 Staple；拒绝、超时、网络错误或任何验证失败均中止。

| 产物 | 验收 |
| --- | --- |
| APP | 严格递归签名与逐文件/逐架构检查，`stapler validate`，Gatekeeper execute |
| DMG | 签名、时间戳、`hdiutil verify`、`stapler validate`、Gatekeeper primary-signature；只读挂载并复验其中 APP |
| ZIP | ZIP 完整性与路径检查；临时解压并验收其中已 Staple 的 APP，不对 ZIP 签名或 Staple |

可独立复验：

```sh
node scripts/macos-release/verify.cjs --app /绝对路径/Snipvia.app --arch arm64
node scripts/macos-release/verify.cjs --dmg /绝对路径/Snipvia-0.2.1-arm64.dmg --arch arm64
node scripts/macos-release/verify.cjs --zip /绝对路径/Snipvia-0.2.1-x64.zip --arch x64
```

验证脚本默认校验 `F76JCDMA4Y`，不需要私钥或公证密码。Gatekeeper 必须报告 `accepted` 和 `source=Notarized Developer ID`。DMG 会只读挂载；ZIP 会在解压前检查包外符号链接，再临时解压；临时验证文件结束后清理，现有工作区与发布目录不清理。

最终发布还需在 Gatekeeper 默认启用、应用通过实际下载获得 quarantine 的 Apple Silicon 和 Intel Mac 上验证首次安装、离线票据、首次启动、截图及权限流程。检查成功后才能在发行说明中宣称相应架构已经验收。[Apple 公证流程](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)
