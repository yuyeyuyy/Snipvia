# Snipvia Phase 3 验证报告

## 验证结论

验证日期：2026-10-10，Asia/Taipei。环境：Apple Silicon、macOS 27.0.1、Xcode 26.5、Node.js 24.15.0、pnpm 11.1.3、Electron 44.4.1、electron-builder 26.15.3。

**Phase 3 验证完成，具备进入 Phase 4 的技术条件。**

第三阶段两个 P1 阻塞已按用户批准的最小范围修复。配置解析、schema、完整 lint、类型检查、生产构建、939 项单元测试、Swift Helper 编译/自检、37 项隔离发布 Mock、双架构 APP/DMG/ZIP 构建与内容核对、实际 arm64 打包应用运行检查均通过。

该结论仅表示可在用户再次明确批准后执行第四阶段的受控签名与公证，不表示已经通过 Apple 公证、Gatekeeper 分发验收或 Intel 真机运行。**本阶段没有执行 Developer ID 签名、公证提交、Staple、正式发布入口或官网上传。完成本报告后停止。**

## 两个阻塞的根因、修复范围与差异

### 配置继承与重复目标

实际检查 electron-builder 26.15.3 的 app-builder-lib 配置实现与 builder-util-runtime/objects.js：

- deepAssign 把函数也视为对象，使用 Object.getOwnPropertyNames 合并两个 beforePack 函数，尝试写只读 length，导致验证配置解析失败。
- 数组使用 Set(previous.concat(current)) 合并；目标项是不同对象，即使含义相同也不能去重，导致继承后的 arm64 目标与新双架构目标同时存在。

最小修复：通过打包库已安装的 js-yaml 读取原 YAML，正式配置用对象展开一次性组合原字段，验证配置再浅层组合正式配置。两个配置均设置 extends:null，禁止再次进入该深合并继承链。

正式 beforePack、sign、afterSign 的全部逻辑原样保留；验证 beforePack 的禁签名、禁公证、输出隔离和身份自动发现关闭检查保留。没有删除 Hook、改变 Swift 构建脚本或绕过原生编译、资源复制。本次按原命令完成 native:test 和 build，再测试打包。

| 项目 | 修复前 | 修复后 |
| --- | --- | --- |
| 正式配置复用基础配置 | extends YAML | 读取 YAML 后浅层组合 |
| 验证配置复用正式配置 | extends 正式配置，深合并函数失败 | 对正式配置浅层组合，替换验证 Hook |
| 正式目标 | 四个对象，含重复 arm64 项 | 两个对象：DMG、ZIP，各含 arm64/x64 |
| 验证默认目标 | dir | 保持 dir；此次 CLI 显式指定 DMG、ZIP |
| 正式 Hook 与签名机制 | 已配置 | 完整保留 |
| 测试签名/公证 | 声明禁用但配置无法加载 | 实际解析与 Hook 执行均确认禁用 |

### CJS lint

64 条错误均由 TypeScript 推荐规则同时作用于新 CJS 文件导致：no-require-imports 以及 require/module 未定义。

仅对两个新增配置和 scripts/macos-release 下五个 CJS 文件增加配置覆盖：

- sourceType: commonjs。
- require/module 为只读全局。
- 仅该范围允许 CommonJS require 导入。

没有关闭全项目 ESLint、添加 eslint-disable、排除 scripts，或放宽 TypeScript/React 业务规则。完整 pnpm lint 为 **0 error、0 warning**。

### 本任务修改文件

| 文件 | 作用 |
| --- | --- |
| [electron-builder.macos-release.cjs](../electron-builder.macos-release.cjs) | 原 YAML 的单次组合、消除重复目标 |
| [electron-builder.macos-validation.cjs](../electron-builder.macos-validation.cjs) | 避免 Hook 深合并，保留全部测试保护 |
| [common.cjs](../scripts/macos-release/common.cjs) | 增加读取原 YAML 的最小辅助函数 |
| [eslint.config.mjs](../eslint.config.mjs) | 新 CJS 文件的最小范围覆盖 |
| 本报告 | 最终证据、限制与后续建议 |

原 electron-builder.yml、package.json、pnpm-lock.yaml、业务功能、图标、Bundle ID、产品名称及原开发/体验包命令没有被本任务修改；没有升级任何依赖。构建会生成原有忽略目录 out、packages/console-contracts/dist、build/native 的中间文件，这是现有命令的正常输出。

## 自动化测试结果

本轮日志、临时 Mock、检查器与测试副本：/private/tmp/snipvia-phase3-final-hf5089zx/。

| 执行项 | 本轮通过 | 本轮失败 | 跳过 | 证据 |
| --- | ---: | ---: | ---: | --- |
| node --check，新增 CJS | 7 | 0 | 0 | syntax.json |
| plutil -lint，全部权限文件 | 5 | 0 | 0 | 实际退出 0 |
| 当前打包库配置加载/schema | 2 | 0 | 0 | config.log；标识、图标、资源描述、Helper 映射与原 YAML 相同 |
| pnpm lint | 1 | 0 | 0 | lint.log；0 error、0 warning |
| pnpm typecheck | 1 | 0 | 0 | typecheck.log |
| pnpm build | 1 | 0 | 0 | build.log；main、preload、renderer 完成 |
| pnpm test，在本机执行 | 939 | 0 | 0 | unit.log；58 个文件全部通过 |
| pnpm native:test | 1 组 | 0 | 0 | native.log；包含双架构编译与协议自检 |
| node --test，发布隔离 Mock | 37 | 0 | 0 | mock.log |
| 选定现有 Electron 集成测试 | 4 | 0 | 0 | integration.log，30.4 秒 |
| 现有 packaged ASAR/Node 测试 | 1 | 0 | 0 | packaged.log，实际测试 APP，5.7 秒 |
| 新增临时 packaged UI 检查 | 1 | 0 | 0 | packaged-ui.log，实际测试 APP，2.8 秒 |
| 包内 Swift Helper 自检 | 1 组 | 0 | 0 | packaged-helper.log |
| 两套测试 APP 被正式验收拒绝 | 2 | 0 | 0 | negative.log；在票据操作前拒绝 |
| Developer ID 要求表达式语法 | 1 | 0 | 0 | requirement.log；csreq 编译成功 |
| 本地发布预检 | 1 | 0 | 0 | preflight.log；未验证远程 Profile |

四项现有集成用例来自 capture-window-visibility、desktop、screenshot-editor：覆盖 Electron 与模拟 ScreenCaptureKit 截图、取消/预览/窗口行为、安全 IPC、Mock AI 图片对话/取消、主要页面及编辑流程。临时副本仅重定向截图输出，原断言不变，避免覆盖未提交的 docs/ui 图片。

### 首轮失败与复测记录

不将首轮失败改写为通过：

- 上一轮执行沙箱内单元测试为 923 通过、16 失败，集中于系统沙箱初始化；原 agent-commands 组本机复测 22/22 通过。证据保留于 /private/tmp/snipvia-phase3-l3k7r_rs/unit.log 和 unit-commands-host.log。本轮完整本机测试实际为 939/939。
- 上一轮集成测试因 loopback listen EPERM 四项失败，本机复测四项通过；本轮也实际复测通过。
- 本轮首个 arm64 打包尝试被临时拦截器的环境检查中止：builder 依赖收集子进程会清空 CSC 变量。仅修正仓库外拦截器对该子进程的误报，实际签名/公证拦截仍保留，然后在另一全新目录重试成功。证据为 arm64-pack-first-guard-failure.log；失败目录保留，没有清理。
- 临时 UI 检查首轮以字符串前缀比较用户目录失败，并在清理时超时。规范化路径复测实际显示 rawPrefixMatches=false、realPrefixMatches=true，确认是 /var 与 /private/var 的表示差异，实际存储隔离成立。
- 临时 UI 第二轮错误期待设置弹窗；快照显示当前产品是完整设置页面。只修改临时测试定位器为实际“设置”标题后通过，没有修改业务 UI 或削弱隔离断言。两个失败日志及 trace 均保留。

未执行全量 test:smoke、真实屏幕/多显示器/耐久性能测试；采用范围明确的现有合成烟测。未将这些未执行项计入通过数量。

## 双架构 APP、DMG、ZIP 结果

分别执行原 electron-builder 命令，加载修复后的验证配置：

```sh
pnpm exec electron-builder --config electron-builder.macos-validation.cjs --mac dmg zip --arm64 --publish never -c.directories.output="<全新 arm64 测试目录>"
pnpm exec electron-builder --config electron-builder.macos-validation.cjs --mac dmg zip --x64 --publish never -c.directories.output="<全新 x64 测试目录>"
```

构建前已使用原 native:test、build 完成准备。测试输出分别为：

- arm64：dist/macos-validation/phase3-final-arm64-822e3866ed/
- x64：dist/macos-validation/phase3-final-x64-b68dc44c7a/

| 验证 | arm64 | x64 |
| --- | --- | --- |
| APP 构建 | 通过 | 通过 |
| Electron 主程序 | arm64 | x86_64 |
| Electron Framework | arm64 | x86_64 |
| 其他打包 Mach-O | 13 个单架构文件匹配目标 | 13 个单架构文件匹配目标，无 arm64-only 依赖 |
| Swift Helper | 一个，含 arm64/x86_64 | 一个，含 arm64/x86_64 |
| DMG 生成与 hdiutil verify | 通过 | 通过 |
| DMG 只读挂载、内容/架构检查 | 通过 | 通过 |
| ZIP 生成、unzip 完整性检查、解压检查 | 通过 | 通过 |
| DMG/ZIP 内 APP 信息、ASAR、全部 Mach-O 哈希与独立 APP 一致 | 通过 | 通过 |
| 真机运行 | 本机实际启动验证通过，限制见下文 | 未执行 Intel 真机验证 |

每套 APP 实际扫描到 **14 个 Mach-O、9 个 bundle**。ASAR 及 unpacked 依赖扫描没有遗漏的 Mach-O。Helper 固定路径为 Contents/Resources/native/snipvia-capture-helper；native 目录中只有该文件。

应用标识、版本、资源检查通过：

- CFBundleIdentifier=com.snipvia.desktop，CFBundleName=Snipvia，CFBundleDisplayName=截然。
- 版本 0.2.1，最低 macOS 14.0。
- icon.icns、Assets.car、Icon 声明以及两种托盘图标均存在。
- 屏幕录制与 Apple Events 用途描述保持原样。
- DMG 包含 Snipvia.app、Applications 链接、背景与卷图标；ZIP 包含完整 APP。

测试产物记录如下，**不是正式分发产物**：

| 文件 | 字节 | SHA-256 |
| --- | ---: | --- |
| Snipvia-0.2.1-arm64.dmg | 140005439 | 54be971041f905975ec6496224974749728355deba0f565a78b29504f426c0fb |
| Snipvia-0.2.1-arm64.zip | 140435414 | 97d1a147328f1594766920654f5621b2e82d33ec748c471d763c5266b3e32ef0 |
| Snipvia-0.2.1-x64.dmg | 143714709 | be77e48cd809b5f584b6d855a364f66dd9953d20342c75a791a0ecea7f861ab1 |
| Snipvia-0.2.1-x64.zip | 144181819 | a863f3e4dfb14f0f8f81ddc2393d46a3c9264e13e520826dd8875da38def61b9 |

这些测试哈希只用于第三阶段证据，不是第四阶段 Staple 后的最终发布哈希。没有复制到正式发布目录或生成正式 verified 成功目录。

## Swift Helper 专项结果

原编译流程分别编译 arm64-apple-macosx14.0、x86_64-apple-macosx14.0 后合并。file/lipo 对编译产物和六份 APP 内容均确认两种切片。

原 Helper 自检与实际 APP 内 Helper 自检均通过：ping、会话标识隔离、合成图片 OCR、未知命令拒绝、取消中断、dispose。编译产物与包内资源保持兼容，资源路径/数量正确。

发布钩子没有改动，其原生扫描包含实际 Helper；每个文件按最小权限选择，Helper 使用空权限字典和固定签名标识。签名库源码的由深到浅顺序与 Mock 检查通过。本阶段未实际用 Developer ID 验证该顺序；第四阶段签名后必须再做真实严格递归验证。

CaptureEngine 原生失败后的 Electron fallback、取消不触发 fallback、请求/会话隔离和显示器映射相关单元测试通过。集成测试的 ScreenCaptureKit 为合成后端；没有请求真实屏幕像素或更改 TCC 授权。

## 签名、公证未被触发的证据

1. 实际加载的测试配置明确为 identity=null、sign=null、notarize=false、forceCodeSigning=false、dmg.sign=false、afterSign=null；beforePack 验证这些字段及独立输出路径。
2. 子进程环境移除 APPLE_*、CSC_*、正式发布授权标记和调试变量；仅设置 CSC_IDENTITY_AUTO_DISCOVERY=false。没有把密码或 API Key 传给 builder。
3. 仓库外 Node 进程拦截器拒绝非 Ad-hoc codesign、公证工具、Staple 和钥匙串修改调用。两架构打包工具记录共 26 条，无正式签名、公证、Staple 或阻断事件。依赖收集子进程仍加载相同拦截器。
4. 两份打包日志实际记录 skipped macOS code signing，原因为 identity explicitly is set to null。没有进入真实正式签名 Hook或公证 Hook。
5. 两套 DMG 均实际未签名；APP 的所有 Mach-O 未发现本项目 Team ID 或本项目 Developer ID Authority。保留的 Electron/Swift linker Ad-hoc 签名不是本机 Developer ID 签名。
6. 两套测试 APP 均被正式验收拒绝，验证没有进入票据检查。本阶段没有运行真实 release.cjs --execute、旧 dist:release、Staple 或 Gatekeeper 正式产物验收。
7. 37 项发布 Mock 中，外部能力完全替换为 Fake，验证错误身份/团队、凭据环境隔离、签名/构建/公证/Staple/验收失败中止和最终哈希顺序。Mock 不等于真实 Apple 调用成功。

没有为了启动 UI 而执行额外 codesign --sign -；实际未正式签名的 arm64 测试 APP 已能直接运行。本地创建产物没有经过真实下载的 quarantine/Gatekeeper 路径，这部分留待第四阶段。

## 本机运行与发布质量

实际 arm64 打包 APP 的现有专用测试通过，验证：

- APP 正常启动并由测试关闭。
- ASAR 内沙箱依赖可加载，自身 Electron Node 运行时能在临时工作区执行受控命令。
- 真实页面显示“截然”、AI 笔记、历史和设置；没有页面异常。
- app.isPackaged=true，真实 userData 路径规范化后确实位于本次临时目录。
- renderer 无 require，主窗口的错误来源 capture.frame 请求被拒绝。
- capture/pin 页面资源与 preload 正常预加载。
- [本机打包应用页面截图](/private/tmp/snipvia-phase3-final-hf5089zx/packaged-ui.png)。

物理快捷键、真正的截图权限申请、真实 ScreenCaptureKit 捕获、真实供应商 AI 和生产账号未操作。普通截图框选、预览、AI 浮窗在现有合成集成测试中通过，不能据此宣称上述真实场景已经通过。

每套 ASAR 有 5974 个条目。未发现 .env、.git、.ssh、私钥/证书私钥导出/钥匙串文件名；应用 out 中未发现匹配的完整私钥块或常见长 API Key 模式。项目生产 out 无 Source Map；依赖保留 879 个第三方 Source Map。是否剔除第三方 map 属于后续包体/分发策略，本次不扩大过滤规则。模式扫描不是对所有可能秘密格式的形式证明。

本任务未写业务源文件或覆盖正式产物。内容基线检测到本轮授权的四个修复文件变化，同时检测到以下其他路径变化：scripts/test-console-image.mjs、docs/CONSOLE_DOCKER_DEPLOYMENT.md、scripts/package-console-image.sh、apps/server/deploy/Dockerfile.updater、apps/server/deploy/Dockerfile、.dockerignore。本任务没有写这些路径，未恢复或清理并发改动。package.json 与 pnpm-lock.yaml 本来已有未提交修改，但与本轮内容基线一致，没有被本任务改写。

## 剩余风险与状态分类

| 级别 | 状态 | 项目与要求 |
| --- | --- | --- |
| P0 | 未发现 | 未发现第三阶段越界正式操作、敏感文件打包或凭据日志泄露 |
| P1 | 已解决 | beforePack 深合并失败、重复目标、64 条 CJS lint 错误 |
| P1 | 当前无未解决技术阻塞 | 双架构构建、内容检查、本机测试与发布保护已通过 |
| P2 | 需要人工验证 | Intel 真机运行、物理快捷键、真实录屏权限、多显示器行为 |
| P2 | 第四阶段未执行 | Developer ID 签名、时间戳服务器、真实公证/Staple/Gatekeeper、离线票据 |
| P2 | 第四阶段签名后复验 | 最小 Entitlements 对截图、OCR、AI、命令、自启及 Apple Events 的兼容性 |
| P2 | 需要固定输入 | 工作区仍有并发未提交修改；正式构建前记录并冻结所选源码输入 |
| P2 | 后续策略 | 第三方 Source Map 879 个；原 dist:release 仍为历史临时签名入口 |

## 第四阶段执行建议与停止点

技术准备已满足：版本固定、有效 Developer ID 本地预检、用户确认的 Profile、双架构可构建、资源与 Helper 可用、发布失败保护和验收拒绝机制通过。

第四阶段必须在用户再次明确批准后按以下顺序执行：

1. 固定本次正式构建输入，复核身份和钥匙串 Profile 可用性。
2. 独立正式目录中逐架构构建，由内到外 Developer ID 签名所有代码，验证团队、证书、运行时、最小权限和安全时间戳。
3. APP 公证 Accepted 后 Staple，真实签名与 Gatekeeper 验收。
4. 最终 DMG 签名、公证、Staple，再验收 DMG 与 ZIP 中的 APP。
5. 最终变更完成后生成 SHA-256 和 verified 目录，检查签名应用功能。
6. 补充真实下载、默认 Gatekeeper、离线票据、TCC 及 Intel 真机验收记录。官网上传仍需单独授权。

**本次工作止于第三阶段验证与报告，不执行上述第四阶段步骤。**
