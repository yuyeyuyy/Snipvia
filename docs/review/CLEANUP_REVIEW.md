# V2 代码 review 导航与清理结果

基线：`3cf4498`，分支 `refactor/snipvia-v2`。工作目录仅为 Snipvia-public-baseline。所有更改保留为未提交 diff，未推送、打包、正式签名、公证或发布，没有改写历史或删除用户数据。

## 清理结果

已完成用户确认的 A→D 清单，连同前一轮文档清理，共删除 **375 个文件（约 41.42 MiB）**：344 个旧文档/截图/独立原型，31 个闲置源码、旧工具及测试夹具。删除清单逐项保存基线 SHA-256：[文档/原型](removed-documentation.json)、[源码/工具/夹具](removed-code.json)。依赖变化只移除 Temporal、其独占依赖 jsbi 和闲置 jsqr，没有升级其余版本。

| 阶段 | 实际更改与证据 |
| --- | --- |
| A 独立闲置模块 | 删除 shared/schedule-calendar.ts、schedule-time.ts、model-endpoint.ts 及对应单测；删除 evaluate-web-search.mjs 和 MCP server 夹具。删除前只有对应旧单测导入，无生产调用。A 组类型检查通过。 |
| B 设置与契约 | storage/settings.ts 收敛为快捷键/主题兼容，不再导入模型/预测 schema 或 safeStorage。删除 providers.ts、api-key.ts、screenshot-understanding.ts 和旧模型测试；contracts.ts 仅保留当前截图/权限/IPC 契约。 |
| B 外观/界面/诊断 | 删除 chatFontSize 广播和 CSS 变量、Pin 的 localOnly/chatActive 字段、未使用图标及 Agent/模型/笔记样式、50 个旧功能性能事件。截图、SCK、收纳指标及禁止旧流程回归的断言保留。 |
| C OCR | Swift 删除 Vision/OCR 分支与辅助函数；TS 删除 recognizeText 与 OCR header 字段；构建不再链接 Vision；删除只服务 OCR/日程的 15 个夹具。Swift CaptureService 主体逐字节不变。协议检查现在确认 OCR 命令被拒绝，保留取消/会话隔离。 |
| D 工具/依赖/CI | 删除三个朋友体验/assemble 旧分发脚本、固定 0.2.1→0.2.2 更新实验及三个对应命令；其三份专用 V1 说明随之移除。Windows CI 改为真实存在的当前测试，去掉指向不存在测试的旧安装/卸载流程；官方签名、公证、发布、更新模块不变。 |

没有删除当前截图、编辑、收纳、旧记录读取/导出、安全校验或更新功能的有效测试。单测从历史 227 项变为 168 项，是删除退役模型/日程/凭据迁移测试并重写当前兼容测试的结果。4 个退役单测文件已成组删除；当前边界测试不是通过跳过来消除失败。

## 旧数据与安全边界

- `settings.json` 中的旧模型、预测、profile、加密 Key 和未知字段原位保留。兼容读取只提取旧截图快捷键与主题，不解密或访问 `credentials.json/key`。
- 保存主题重新读取最新 JSON，只改 `appearance.mode`，采用独占临时文件和原子 rename；损坏根对象或无法合并的外观数据拒绝覆盖。有效旧自定义快捷键不做旧版默认值迁移。
- 新安装只保存主题对象，不生成旧模型默认值；新安装的 Ctrl+1/Ctrl+3 与独立 `capture-preferences.json` 保持原行为。
- `tests/fixtures/legacy-settings.ts` 是合成兼容测试数据，替代生产默认模型依赖，不进入产品构建。旧历史、日程、笔记索引和只读导出逻辑保持原代码。
- userData、App ID/Bundle ID、sandbox、contextIsolation、主 frame/角色与 IPC 校验保持不变。32 个核心文件与基线逐字节一致，详细路径见[验证记录](validation.json)。

## 建议阅读顺序与文件级修改

| 入口 | Review 重点 |
| --- | --- |
| [Main](../../src/main/index.ts) | 只换最小设置读取入口，移除旧 Pin 状态；截图、快捷键与 IPC 编排保留 |
| [设置兼容](../../src/main/storage/settings.ts) / [单测](../../tests/unit/settings.test.ts) | 不解释旧模型，不读凭据，未知字段/并发外部修改/损坏文件/600 权限与重启 |
| [当前契约](../../src/shared/contracts.ts) / [IPC 输入单测](../../tests/unit/contracts.test.ts) | 仅保留当前类型；坐标、session 校验仍在 |
| [外观服务](../../src/main/appearance.ts) / [共享外观](../../src/shared/appearance.ts) / [Preload](../../src/preload/index.ts) | 仅移除对话字号；主题与透明窗口 bootstrap/身份校验保留 |
| [Swift Helper](../../native/screen-capture-kit-helper/main.swift) / [TS 桥](../../src/main/capture/screen-capture-kit-backend.ts) | diff 仅为 OCR 删除，CaptureService、故障回退和传输保护不变 |
| [原生构建](../../scripts/build-native-helper.sh) / [协议测试](../../scripts/test-native-helper.mjs) / [轻量 SCK](../../tests/integration/v2-sck-light.spec.ts) | 双架构构建、取消、退役命令拒绝、失败元数据诊断 |
| [Icon](../../src/renderer/src/components/Icon.tsx) / [EditorIcon](../../src/renderer/src/capture/editor/EditorIcon.tsx) / [controls.css](../../src/renderer/src/design/controls.css) | 删除无当前使用的旧功能图标和选择器，现有黑白灰与控件结构保留 |
| [事件契约](../../src/shared/performance.ts) / [记录器](../../src/main/performance/screenshot-performance.ts) / [单测](../../tests/unit/performance.test.ts) | 移除旧 AI/历史指标，Quick/Collect/Shelf 与截图诊断保留 |
| [package.json](../../package.json) / [锁文件](../../pnpm-lock.yaml) / [Windows CI](../../.github/workflows/windows-internal.yml) | 仅删除 3 个旧命令和 2 项闲置直接依赖；CI 不再调用不存在的测试 |
| [主题集成](../../tests/integration/appearance.spec.ts) / [旧数据集成](../../tests/integration/v2-settings.spec.ts) / [编辑测试](../../tests/integration/screenshot-editor.spec.ts) / [性能测试](../../tests/integration/performance.spec.ts) / [编辑单测](../../tests/unit/screenshot-editor.test.ts) / [外观单测](../../tests/unit/appearance.test.ts) | 使用合成旧配置，保留原功能断言，移除仅属于退役能力的断言 |
| [路由](../../src/main/capture/CaptureModeRouter.ts) / [Store](../../src/main/storage/ScreenshotStore.ts) / [Collection](../../src/main/storage/ScreenshotCollection.ts) / [Shelf](../../src/main/windows/ShelfWindow.ts) / [集成](../../tests/integration/v2-continuous.spec.ts) | 当前核心未修改，作为对照阅读 |
| [更新服务](../../src/main/updates/UpdateCheckService.ts) / [安装边界](../../src/main/updates/ElectronUpdateInstaller.ts) | 实现及有效测试保留；官方 release 工具除旧实验外全部原样保留 |

[验证 JSON](validation.json) 的 `changedTrackedBusinessAndBuildFiles` 给出全部业务/构建 diff 路径，删除文件另见哈希清单。README、结构/架构、隐私、开发、验证与平台说明已按当前状态更新。旧许可、素材权属和依赖审计 JSON 是历史快照；当前构建的生产许可证清单位于 `out/licenses`，没有删除版权原文。

## 验证结果与未验事项

| 检查 | 实际结果 |
| --- | --- |
| 离线锁更新 + 冻结安装 | 通过；下载数 0，锁 diff 只删除三包及关联记录，未执行安装脚本 |
| `pnpm lint` / `pnpm typecheck` | 通过；初次 lint 发现清理后的闲置 import，删除后复验通过 |
| `pnpm test` | 30 文件 / 168 项通过 |
| `pnpm build` | 通过；生成 122 个 production 包版本声明，0 个缺失许可证文件；保留两条既有 zod Rollup 注释警告 |
| `DEVELOPER_DIR=/Library/Developer/CommandLineTools pnpm native:test` | arm64/x86_64 Universal 编译与协议测试通过 |
| `pnpm exec playwright test` | 复用紧前同源码构建，21 项通过 / 11 项既有 opt-in 未执行，未计为通过 |
| 轻量真实 SCK | **两次失败，未通过验收**：期待 SCK，但回退 Electron；诊断实际原因是“用户拒绝了应用程序、窗口、显示器捕捉的TCC”，timeoutCount=0。Electron 查询 granted 不能证明 Helper 获准。保留元数据及原始失败记录，没有改断言/500ms 超时、系统权限或正式签名，没有留存真实屏幕像素或写系统剪贴板。 |
| UI | 检视本次合成的设置 Dark 与 Shelf Light，黑白灰/结构保持；测试重写的 3 张 tracked 图片已恢复基线，新的合成证据只留 test-results |
| Windows/安装包/多屏/性能 | 本轮没有触发 Windows CI、构建安装包、真机混合 DPI 或高负载测试。Phase 2 间歇 Collect Overlay 尾延迟仍是已知边界；此次清理没有修复或证明其改善。 |

真实 SCK 需要在确认本次实际 Helper/开发应用的 macOS 授权后原样重跑轻量测试；不应 reset TCC、复用另一二进制的结果，或把 Electron fallback 记为新 Helper 的成功。当前代码可供 review，**不能据此宣称新的原生包已经具备发布资格**。

## 回滚与本地边界

前一轮宽范围命令曾被自动审批拒绝且未执行；本轮收到用户对精确 A→D 清单的明确确认后，才执行分阶段清理。没有绕过该拒绝，也没有把未通过项目写成通过。

- 清理前完整源码：`.dev-runtime/review-cleanup-3cf4498/source.tar`。
- 代码清理前（含本轮文档状态）：`.dev-runtime/review-cleanup-3cf4498/before-code-cleanup.tar`。
- 清理前双架构及 Universal 二进制：`.dev-runtime/review-cleanup-3cf4498/native-before-ocr-removal/`；只作恢复，不用它冒充新源码的验证结果。
- 单文件原始内容：`git show 3cf4498:相对路径`。先将 archive 解压到新临时目录比较，再按需恢复，禁止 reset --hard、git clean 或覆盖未知改动。
- `sck-light-attempt1.json` / `sck-light-attempt2.json` 的原始元数据留在上述本地备份目录，SHA-256 见验证 JSON。真实屏幕像素未持久化；本次合成 UI 位于 `test-results/review-cleanup-ui/`。
- `node_modules`、`out`、`dist`、`build/native`、`.dev-runtime`、测试输出均为忽略目录。没有为减小源码 review 体积删除用户产物或恢复资料。未操作 legacy/server/原恢复仓库，未提交或推送。
