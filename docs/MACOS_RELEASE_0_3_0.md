# macOS 0.3.0 本地签名与公证验收

**本地两种架构的签名、公证和安装文件完整性验收通过；尚未公开发行。** 剩余依赖告警与功能验收边界见后文。

构建与公证：2026-10-17；最终文件复核与报告收尾：2026-10-18。工作区：`Snipvia-public-baseline`，分支 `codex/jev-vision`，构建起始 HEAD 为 `ce46e1fff25ac7abae4f0e85f76393990042ceb8`；包含已保全的未提交 Phase 2、Phase 3 和 Jev 功能。本次获得本地正式签名、公证与版本 `0.3.0` 的明确授权；不包含 Git 推送、修改可见性或创建 GitHub Release。

## 本次变更

| 文件 | 变更与验证 |
| --- | --- |
| `package.json` | 版本从 0.2.3 调整为用户确认的 0.3.0，不改依赖版本。 |
| `docs/MACOS_RELEASE_0_3_0.md` | 记录实际签名、公证、恢复、校验与尚未完成的验证。 |
| `docs/RELEASE_NOTES_0_3_0.md` | 记录免费、免登录、自配模型、可选 Jev、数据兼容及已知限制。 |
| `scripts/opensource/generate-notices.mjs` | 纳入精确版本、校验过内容的明确许可补充；未知缺失项仍由正式打包检查阻断。 |
| `scripts/opensource/license-supplements.cjs` | 核对 lazy-val 声明、作者、全部发布文件及补充文本的 SHA-256；版本或内容变化不静默放行。 |
| `scripts/opensource/licenses/lazy-val-1.0.5.json`、`.txt` | 保留 npm SHA-512 完整性、上游提交、SPDX 标准文本来源与哈希；明确补充文本不是上游原 LICENSE，不编造版权年份或版权行。 |
| `THIRD_PARTY_NOTICES.md` | 说明有来源记录的许可补充及其法律核实边界。 |
| `tests/unit/license-supplements.test.ts` | 验证正确版本、声明变化、内容变化及未知包/版本边界，共 4 项。 |
| `eslint.config.mjs` | 仅补充许可构建工具的 CommonJS 规则范围。 |

截图、预测、AI、Agent 及存储业务源码本轮未修改。原有 `com.snipvia.desktop`、最低 macOS 14.0、用户数据路径与 Keychain 存储保持原配置。没有清理、重置或覆盖现有工作区功能，没有修改旧仓库或私有仓库。

## 构建与签名边界

使用 Node.js 24.15.0、pnpm 11.1.3、Electron 44.4.1、electron-builder 26.15.3、@electron/osx-sign 1.3.3 与 @electron/notarize 2.5.0。执行现有正式入口 `node scripts/macos-release/release.cjs --execute`，并始终使用 `--publish never`。仅调用本机钥匙串保存的 Developer ID 与公证 Profile，不导出证书私钥、密码或 Token。

正式配置使用 Team `F76JCDMA4Y`、Hardened Runtime、安全时间戳与最小 Entitlements；逐个签名 Mach-O 和代码 bundle，验证 Swift Helper 含 arm64 与 x86_64。APP 公证后 Staple；DMG 单独签名、公证和 Staple；ZIP 检查其解压出的 APP。最终目录仅在所有架构签名、Apple 公证、Gatekeeper、磁盘映像和解压完整性验证均通过后生成。

首次运行目录：`dist/macos-release/0.3.0-2026-10-17T09-54-25-656Z-6ad5f49e/`。最终交付目录见下表之前的路径；首次运行的失败现场和中间文件不作为交付文件。

<!-- ARTIFACT_RESULTS_START -->
初次运行完成 arm64 全部验收，Intel Renderer Helper 签名遇到 `A timestamp was expected but was not found` 后安全停止。原输出和失败记录完整保留；未关闭安全时间戳、未降级签名、未覆盖失败目录。随后通过本地恢复脚本验证 740 个构建输入哈希未变化，在独立目录重试 Intel 签名与公证；重新核验并复用已公证 arm64 成品，没有重新提交 arm64 公证。恢复脚本保存在最终构建目录的 `recovery-procedure.cjs`，日志在 `.dev-runtime/release-0.3.0/recovery.log`。

最终验收目录：`dist/macos-release/0.3.0-x64-retry-2026-10-17T10-03-59-482Z-73569fe3/verified/`。四个文件的 SHA-256 已于 2026-10-18 再次独立复核一致；`latest-mac.yml` 中的版本、文件大小与 SHA-512 均匹配最终冻结文件。

| 架构 | APP 公证 ID | DMG 公证 ID | 结果 |
| --- | --- | --- | --- |
| arm64 | `c42ffa5d-53cc-4b21-9d4f-482c1d4b9298` | `652cdef2-bad6-4ba2-ac53-df6d0aef3dbc` | Accepted；APP / DMG / ZIP 解压内容与 Gatekeeper 验证通过 |
| x64 | `9a48e507-a980-475b-a655-5f928739c3ec` | `cf2f94f1-35d6-45b7-9460-2d07e20416a3` | Accepted；APP / DMG / ZIP 解压内容与 Gatekeeper 验证通过 |

| 文件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| [Snipvia-0.3.0-arm64.dmg](../dist/macos-release/0.3.0-x64-retry-2026-10-17T10-03-59-482Z-73569fe3/verified/Snipvia-0.3.0-arm64.dmg) | 141540939 | `972944ff0d69978621d7e58d14bbc6e8440f9dfd1a6cbb1368923b44cd66bd08` |
| [Snipvia-0.3.0-arm64.zip](../dist/macos-release/0.3.0-x64-retry-2026-10-17T10-03-59-482Z-73569fe3/verified/Snipvia-0.3.0-arm64.zip) | 141957254 | `b27c9a1448c934ef227681759dcf3596798ed1b3fc98d76b6b9c65d3de76e2ef` |
| [Snipvia-0.3.0-x64.dmg](../dist/macos-release/0.3.0-x64-retry-2026-10-17T10-03-59-482Z-73569fe3/verified/Snipvia-0.3.0-x64.dmg) | 148328043 | `c0ac8b7e429915b39cd208835d2fcc5b76b6bede49429d0601c16516a46d7513` |
| [Snipvia-0.3.0-x64.zip](../dist/macos-release/0.3.0-x64-retry-2026-10-17T10-03-59-482Z-73569fe3/verified/Snipvia-0.3.0-x64.zip) | 148760418 | `cd7fdd155a1e55be6d00bfefb7451cf2761e6a66211cabb926389dafb50b6e3e` |

<!-- ARTIFACT_RESULTS_END -->

## 测试记录与实际边界

| 验证 | 结果 |
| --- | --- |
| `pnpm lint` | 通过。 |
| `pnpm typecheck` | 通过。 |
| `pnpm test` | 63 个文件、981 项测试通过。 |
| 正式流程中的 `pnpm native:build` | 双架构 Swift Helper 编译通过。 |
| 正式流程中的 `pnpm build` | 通过；276 个生产依赖版本，未核实的许可文本缺失项为 0，其中 lazy-val@1.0.5 使用明确标注的补充文本，并非找到了原文件。 |
| `pnpm exec playwright test tests/integration/local-first-compatibility.spec.ts --reporter=list` | 2 项通过：无 Key 断网启动、本地笔记/编辑/历史/IPC，以及 v0.2.3 数据、系统加密 Key、预测和 Agent。使用临时目录、合成截图和模拟模型，不读取实际用户数据或调用付费模型。 |
| 之前完整 Electron 套件 | Jev 完成时为 41 通过、11 原有条件跳过、3 失败；本轮未重跑完整套件，也未删除或跳过有效测试。两个窗口可见性用例及一个 CodeMirror 时序用例失败；旧基线也复现其中两项，当前版本单独重跑 4 项通过。完整套件不能记为通过。 |
| Jev 既有集成验证 | 两项在之前完整套件通过，覆盖独立 Key、图片请求、分支路由、失败取消、用户模型回退与损坏配置保护；实际 Jev 服务可用性和预测准确率需用户真实模型验收。 |

<!-- PACKAGED_SMOKE_START -->
| 实际签名包检查 | 结果与限制 |
| --- | --- |
| arm64 包内检查 | 6,277 个 ASAR 条目，检查的私有应用、旧账号源码及根环境文件路径均不存在；Main / Preload 与本次编译输出字节相同。0.3.0、Jev 固定端点、自动更新启用、项目及 Electron 通知均存在；276 项生产依赖通知包含明确标注的 lazy-val 补充。 |
| x64 包内检查 | 版本、自动更新、Jev、编译输出、许可通知和私有源码边界通过；生产依赖通知完整性检查通过。 |
| arm64 实际应用启动 | Playwright 启动正式签名应用，在临时数据目录验证无 Key 设置、Jev 配置、本地笔记和无旧账号接口；启动的三个窗口均为 `sandbox=true`、`contextIsolation=true`、`nodeIntegration=false`。通过。 |
| x64 调试自动化 | Playwright 在 inspector 已连接后仍出现 30 秒启动超时，记录为未通过，保留这项结果。 |
| x64 直接启动探针 | 使用本机已安装 Rosetta，不带 inspector 启动同一签名应用；约 13.2 秒 app ready、22.4 秒 Main 页面加载、24.9 秒三个可复用窗口准备完成。通过，不能据此认定调试超时原因已经修复，也不能替代 Intel 真机或性能验收。 |

两种架构的启动检查均使用原有 `--snipvia-packaged-test` 与独立临时目录；该模式暂停全局快捷键注册和启动更新检查。没有实际截图、真实模型请求或真实用户数据迁移。临时数据已清理；未安装到系统应用目录。
<!-- PACKAGED_SMOKE_END -->

构建有依赖注释位置的 Rollup 提示，以及 electron-builder 的重复依赖引用提示，未作为构建错误；不据此声称已完成依赖漏洞修复。Intel 真机、多显示器/混合 DPI、真实系统权限、用户安装目录中的实际升级与 Windows 发布验收未在本轮补做。

## 尚未消除的风险

1. `node-forge@1.4.0` 仍在生产依赖图中，存在 [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) 高危告警，2026-10-17 查询仍无正式修复版本，[上游 PR #1152](https://github.com/digitalbazaar/forge/pull/1152) 仍未合并。单独复核当前 macOS 路径：`ProcessSandbox.ts` 禁止网络且不设置 `tlsTerminate` / `mitmProxy`；安装的 SDK 仅在配置 TLS 终止时创建 MITM CA，两个 forge 导入模块未发现签名验证调用，证书签名调用 Node 原生 crypto。这是有限静态可达性证据，不是漏洞修复或绝对不可利用证明。本轮只准备本地签名候选；公开分发前仍须解决或明确复核剩余风险。没有为消除审计告警而禁用 Agent 安全保护或引入未发布的加密补丁。
2. 构建工具间接依赖 `sprintf-js@1.1.3` 仍有中危告警，不在生产依赖图中；继续跟踪上游。已有 [依赖安全清单](opensource/dependency-security.json) 的风险记录保持原样。
3. lazy-val 补充依据 [精确上游提交的 MIT 声明](https://github.com/develar/lazy-val/blob/b69ad4119f1b19bdab13c61ee2fcc88d46b89071/package.json)、完整性核对的 npm 发布包及 [SPDX MIT 标准文本](https://github.com/spdx/license-list-data/blob/v3.27.0/json/details/MIT.json)。不把作者字段断言为原版权通知，不将补充等同新增授权或独立法律审查；将来获得上游原文时应优先核对。
4. 更新源配置为 `yuyeyuyy/Snipvia`，安装更新开关保留。本次不创建 Release、上传安装包或改变仓库可见性；更新入口是否对匿名客户端可用，需要在单独获准发布时检查。现有旧账号版的实际更新链路不能仅凭新包的更新配置认定已切换成功。

## 本地证据与回滚

- 打包前完整源码、逐文件 SHA-256、工作区状态及二进制 diff：`.dev-runtime/release-0.3.0/20261017T095209Z/`，735 个原有文件完整保全。回滚应先将归档解到另一个目录比对，再按文件恢复本轮改动；禁止 `git reset --hard` 或 `git clean`。不要覆盖后续用户改动。
- 实际构建输入哈希：`.dev-runtime/release-0.3.0/build-input-sha256.json`，740 个文件。签名操作的输出均在独立时间戳目录，未覆盖旧版本安装包。
- 构建日志、兼容集成日志、包内检查与安全可达性记录：`.dev-runtime/release-0.3.0/`；这些是本地忽略文件，不会自动提交或发布。
- 最终四个 Apple 提交均为 Accepted：`.dev-runtime/release-0.3.0/notary-history-final.json`；最终 `verified/verification.json`、`SHA256SUMS.txt` 与 `latest-mac.yml` 保存代码验证结果和冻结文件哈希。
- 最终源码归档和逐文件清单：`.dev-runtime/release-0.3.0/source-final.tar.gz`、`source-final-manifest.json`。本轮原有 735 个文件全部保留，实际修改仅为前述四个已存在文件，新增六个源文件/文档。
- Jev 完整测试原始结果和基线对照：`.dev-runtime/jev/checks-complete.json`、`electron-complete-results.json`、`comparison-results.json`。保留失败证据，不用单独重跑覆盖完整套件结论。
- 本次关闭了用于用户试用的开发进程以避免并发写入 `out/`；不安装到 `/Applications`、不修改正式用户数据、不变更生产服务。

上次最终报告写入曾因自动审批服务额度耗尽而未执行；该中断未影响已公证安装包。2026-10-18 按用户继续指令完成本地文件复核和报告收尾，未重新提交 Apple 公证或执行 Git 远程操作。
