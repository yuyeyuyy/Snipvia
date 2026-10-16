# Snipvia 私有服务代码分离报告

日期：2026-10-16。依据：[重构方案](REFACTOR_PLAN.md) 与本轮明确授权的 A–H 分离步骤。

## 结论与实施边界

**本地代码分离完成，可以进入维护者复核；公开源码与停用生产服务仍为 No-Go。**

服务端、管理控制台、官网、后台契约、部署配置和专用测试已完整保存在独立私有候选。桌面工作区已解除对这些 workspace 源码和构建的依赖，另行建立不继承旧 Git 对象库的客户端基线。两个候选均没有 Git 远程配置，没有执行推送、发布、签名、公证、部署、仓库可见性变更或生产资源删除。

本轮没有实施免登录产品改造：登录、会员限制、账号 Cookie 和原服务端预测请求仍按原逻辑运行。截图引擎、AI Provider、Agent、Swift、IPC、Renderer 和自动更新的业务实现保持原样。原工作区已有的大量未提交功能以本轮开始时的文件内容为准保全，不能只用原 HEAD 判断是否保留。

## 本地交付与历史隔离

以下目录相对于原项目目录 `Snipvia/`：

| 目录 | 内容与用途 | Git 边界 |
| --- | --- | --- |
| 当前 `Snipvia/` | 分离后的桌面工作区、规划及本报告 | 原 HEAD 和原历史未改写，仍有旧服务端历史；禁止作为公开推送源 |
| `../Snipvia-private-candidate/` | 独立私有 pnpm workspace | 保留原 12 个提交和原 Git 对象、reflog；新增 1 个迁移提交，共 13 个可达提交；无远程 |
| `../Snipvia-public-baseline/` | 经过扫描的独立客户端源码快照 | 全新对象库、1 个无父提交的根提交，分支 `codex/client-baseline`；无远程和对象 alternates |
| `../Snipvia-migration-backups/20261016-local-separation/` | 本轮开始前的恢复材料、扫描工具及验证日志 | 仅限本机恢复；目录权限 `0700`，不得发布 |

原工作区及备份中的原 Git 配置没有被改动。私有候选的继承远程配置已移除；保留的历史引用不代表已连接远程。没有创建或连接任何 Public 仓库。

## A：改动保全

原 HEAD：`c414cdd991733ffb8bb4ee88dd53cdb22a691744`。

快照包括 894 个已跟踪和未忽略的未跟踪文件，每个文件保存 SHA-256 与权限；包括本轮前的规划文档。另保留完整 `.git` 副本、二进制 unstaged/staged 补丁、状态和 refs 清单。恢复工具已逐一复核这些哈希。

实际 `.env`、依赖、编译产物、证书、数据库、用户数据和其他 Git 忽略项没有复制进候选仓库。原工作区中的这些文件没有被删除或移动；例如 `apps/server/.env` 仍留在原位置。备份只覆盖源码和 Git 元数据，不能当作生产数据库备份。未执行 `reset --hard`、`clean` 或历史重写。

## B–C：归属和迁移差异

精确到文件的迁移及修改列表见 [separation-manifest.json](separation-manifest.json)。共迁移 193 个既有文件；先验证副本保全和私有构建，再逐一移除原工作区的白名单源码，没有递归删除带环境文件的应用目录。

| 内容 | 处理 | 证据及保全方式 |
| --- | --- | --- |
| `apps/server/` | 迁入私有候选 | 全部源码、配置模板、Docker、网关、systemd、安装更新与备份工具；SQL 建表和迁移逻辑仍在 `src/store.ts` 等原文件中，未拆散数据库实现 |
| `apps/console/` | 迁入私有候选 | 包括未提交的活动、资格管理、主题及页面功能 |
| `apps/website/` | 迁入私有候选 | 包括原未跟踪的完整官网、静态资源和部署配置 |
| `packages/console-contracts/` | 迁入私有候选 | 用户、活动、资格、管理接口、预测设置与限额等完整后台契约 |
| 私有脚本 | 迁入私有候选 | `package-console-image.sh`、`package-website-image.sh`、`console-e2e-server.mts`、`benchmark-console-decisions.mjs`、`test-console-image.mjs`、`test-website-image.mjs` |
| 私有测试 | 迁入私有候选 | 7 个 `console*.test.ts`、`console.spec.ts`、`console-totp.ts` 和 `playwright.console.config.ts` |
| 私有文档与图片 | 迁入私有候选 | `CONSOLE_*`、`WEB_CONSOLE_*`、`WEBSITE_*`，后台 benchmark、官网镜像验证及相应 UI 图片；完整清单见 manifest |
| 原锁文件及清单 | 另行归档 | 私有候选 `archive/pre-separation/` 保留原根 package、workspace、lock、README 和关键架构文档；两个工作区另有各自有效锁文件 |
| 截图、编辑、AI、笔记、预测、Agent、Swift、平台适配及更新 | 留在客户端 | 包括本轮前所有相关未提交和未跟踪源码；没有以旧 HEAD 覆盖当前内容 |

### 真实共享依赖的处理

1. 控制台原来直接引用桌面 `Icon.tsx`、`WorkspaceHeader.tsx` 和 `tokens.css`。私有候选在 `shared-ui/` 保留三个文件的独立副本，更新控制台导入、Docker COPY 与 `.dockerignore`；没有新增跨仓库软链接或双版本产品架构。
2. 客户端只抽取所需契约到 `src/shared/account-protocol.ts`、`prediction-protocol.ts`、`prediction-failure.ts`。资格判断、失败消息、请求/响应严格校验与边界值保留原定义；没有把后台管理、订单或数据库模型搬入公有候选。
3. 现有运行时文件只调整三个文件的 import：`src/main/account/AccountService.ts`、`src/main/analysis/PredictionError.ts`、`src/shared/screenshot-chat-access.ts`。没有改方法体或网络目的地。
4. 桌面测试原来通过 `tests/helpers/desktop-account.ts` 启动真实 Fastify/SQLite 后台。现在由 `tests/helpers/account-fixture.ts` 提供内存、合成 HTTP 响应，保留账号失效、资格撤销、竞态和预测错误等客户端断言。此夹具没有生产认证、数据库、发信或管理 API，不能证明真实服务端的安全性。
5. 私有 `console-typesafe.test.ts` 原来反向导入桌面 AccountService、路由器及类型。`tests/fixtures/desktop-compat/` 保留必要桌面兼容快照，服务端协议回归可独立执行，不依赖邻接客户端仓库。它只用于测试，不参与服务端运行或部署。

### 构建边界

客户端 `package.json` 已移除全部 `console:*`、`website:*` 脚本，`build` 不再先构建后台契约；workspace 仅含根项目，Vitest 不再配置后台契约 alias。客户端锁文件不再含 `better-auth`、`better-sqlite3`、`nodemailer` 或私有 workspace importer。

私有根清单只包含私有构建和回归所需依赖及脚本，构建顺序仍为 contracts → server → console，另行构建 website。私有根没有 Electron 安装钩子或 Electron 运行时依赖。共享展示组件所需 React，以及测试所需 QR 解码和辅助函数已经补齐。

独立候选的目录树均没有引用原工作区的 `node_modules` 或源码软链接。依赖安装使用本机 pnpm 缓存，安装产物不进入 Git。

## D–F：验证记录

验证环境：macOS，Node.js `24.15.0`，pnpm `11.1.3`。日志保存在快照目录的 `validation/` 中。

| 对象 | 检查 | 结果 |
| --- | --- | --- |
| 私有候选 | 独立锁文件生成、offline frozen 安装 | 通过；构建前先以 `--ignore-scripts` 安装缓存依赖，后续真实数据库回归通过 |
| 私有候选 | `pnpm typecheck` | contracts、server、console、website 以及根测试/兼容夹具类型检查通过 |
| 私有候选 | `pnpm build` | 服务端、控制台和官网全部通过 |
| 私有候选 | `pnpm lint` / `pnpm test` | 通过；7 个测试文件，109 项测试 |
| 私有候选 | `CONSOLE_BROWSER_CHANNEL=chrome pnpm console:test:e2e` | 4 项浏览器验收通过，使用临时服务和数据库 |
| 原桌面工作区 | `pnpm lint` / `pnpm typecheck` / `pnpm build` | 通过 |
| 原桌面工作区 | `pnpm test` | 正常主机权限下 59 个文件、936 项通过；外层受限沙箱内初跑有 16 项 Agent 子沙箱初始化失败，未修改业务代码规避 |
| 原桌面工作区 | 完整 `pnpm exec playwright test` | 初跑 40 通过、11 条件跳过、1 超时；补齐测试确认模拟后该 1 项独立复验通过，未把多次运行描述为一次全绿 |
| 原桌面工作区 | `pnpm native:test` | arm64/x86_64 Swift 编译、通用二进制和合成图片协议测试通过 |
| 全新客户端候选 | `pnpm install --offline --frozen-lockfile` | 通过，包含 Electron postinstall；无需私有 workspace |
| 全新客户端候选 | `pnpm lint` / `pnpm build` / `pnpm test` | 通过；构建含类型检查，936 项单元测试通过 |
| 全新客户端候选 | 8 项关键 Electron 冒烟 | 账号恢复与撤销、截图资格、图片附件、模型配置、对话取消、预测失败与手动提问全部通过 |
| 全新客户端候选 | `pnpm native:test` | 双架构编译与合成协议测试通过 |

完整桌面冒烟发现的遗漏位于 `tests/integration/chat-images.spec.ts`：重启应用后调用 `models.testVision`，未模拟已存在的原生费用确认弹窗而超时。本轮只为测试添加返回确认的 dialog mock，产品费用确认及模型行为没有改变。

浏览器/Electron 验证产生的文档截图另外保存为验证产物，随后恢复迁移前图片，避免夹带无关图像变更。没有运行 Docker 镜像构建、服务器重部署、Windows 真机安装、签名、公证、线上更新下载或真实屏幕耐久实验。11 项跳过不计为通过。现有 Windows CI 和发布脚本保留，但本机结果不能证明 Windows 真机可用。

## G：源码、历史、凭据及授权检查

摘要见 [security-scan.json](security-scan.json)，依赖元数据见 [dependency-licenses.json](dependency-licenses.json)。扫描脚本和脱敏明细保存在本地快照 `audit/`，不将原始凭据输出到报告。

### 历史与私有代码边界

- 原 Git 对象库逐一扫描 1,923 个文本 blob，另计 1,162 个二进制/大对象；使用 `cat-file --batch-all-objects`，范围包含 refs、reflog 和不可达对象。
- 私有候选提交后扫描 1,935 个文本 blob，另计同样 1,162 个二进制/大对象。47 次模式命中均为已复核示例 SMTP 地址或合成测试/压测值，没有新凭据指纹；未发现可确认的有效生产凭据。
- 全新客户端候选单独扫描源码与其完整 Git 对象库，凭据模式命中为 0。所有可达提交树均没有 `apps/`、`packages/console-contracts/`、私有脚本及后台专用测试。
- 客户端只有一个无父提交的根提交，不复制旧 `.git`、pack、refs、reflog 或 alternates，因此旧服务端提交不可达。原工作区旧历史依然存在于原位置和受保护备份中，不具备公开条件。
- 文件白名单检查排除实际环境文件、私钥/证书、数据库和运行数据；这些材料没有进入两个候选提交。

`apps/server/.env:14` 的 `SMTP_URL` 存在非空、带凭据的本地配置。它是忽略文件，未复制、暂存或提交；没有联网验证其有效性。请维护者确认所属邮箱与历史共享范围，如曾泄露或共享则撤销/轮换。不能因源码历史扫描未命中而认定该本地密码安全。

扫描属于模式与高熵赋值检查，不能覆盖所有秘密格式；二进制资源未逐图 OCR 或逐像素检查，未检查系统钥匙串和生产主机，也没有验证任何凭据。报告不承诺“绝对无秘密”。

### 授权仍需人工完成

- 根 `package.json` 仍声明 `UNLICENSED`，仓库没有正式选定的 LICENSE / NOTICE。本轮没有擅自应用 Apache 2.0。
- 669 个已安装桌面依赖（含开发依赖）已生成许可证元数据清单。主要为 MIT / ISC / Apache / BSD；特别记录 `caniuse-lite` 的 `CC-BY-4.0`、`argparse` 的 `Python-2.0`、`node-forge` 的双许可证 `(BSD-3-Clause OR GPL-2.0)`。需要结合最终打包内容核实通知、署名和许可证选项，不能仅凭 package 字段作出法律结论。
- `UI/`、`build/` 图标及衍生资源、`docs/ui/` 和 `prototypes/` 图片没有完整的来源与再分发授权清单；需要维护者确认作者、生成/购买条款及是否含个人截图。未发现必须随源码打包的第三方字体文件，但这不能替代资源授权核验。
- Electron/Chromium 与原生发布材料的第三方 notices、贡献者授权及项目名称/商标权限仍需发布前确认。

这些问题阻止直接公开发布，但不阻止本次仅限本地的候选保存。GitHub Release 更新源码及独立发布渠道保留；本轮只执行模拟更新测试，没有实际访问或变更线上 Release。

## H：回滚与下一步

### 安全恢复到新目录

在原项目根目录执行以下命令，只验证备份，不改任何文件：

```sh
python3 ../Snipvia-migration-backups/20261016-local-separation/restore.py
```

需要恢复时，指定**尚不存在**的目标目录：

```sh
python3 ../Snipvia-migration-backups/20261016-local-separation/restore.py \
  --target ../Snipvia-restored-review
```

恢复工具先验证 894 个文件哈希，再复制原工作区源码、原 Git 元数据、index、refs 和 reflog；目标已存在时拒绝覆盖。未跟踪文件仍以原文件内容恢复。依赖、实际环境和运行数据没有进入快照，需要分别恢复开发依赖，并从仍保留的原位置人工配置本机数据。不要把真实环境文件加入恢复目录的 Git。

如果要原位回滚，应先额外保全本轮后的新增改动，再基于 manifest 对照恢复；本轮没有自动执行原位覆盖、清理或历史回退。私有候选仍有原历史及迁移提交，公有基线是独立副本；任一候选都不需要销毁才能恢复原项目。

### 验收与等待事项

| 验收项 | 状态 |
| --- | --- |
| 三个私有应用、后台契约、部署工具和专用测试完整保留 | 通过，原文件与迁移白名单逐项核验；仅列明的路径适配有内容变化 |
| 客户端候选没有私有应用源码或可达私有历史 | 通过；只适用于全新客户端基线，不适用于原工作区 `.git` |
| 双方可独立安装、类型检查和构建 | 通过 |
| 未提交功能没有丢失，截图与 AI 逻辑未变 | 通过文件保全比对、业务 import 级差异检查及回归验证 |
| 完整本地回滚材料 | 通过，恢复工具默认校验且拒绝覆盖已有目标 |
| 免登录、免费、可选 Jev 与纯用户模型预测 | 待后续确认实施；本轮没有声称已实现 |
| 停止官网、后台、原服务端部署 | 未执行；当前客户端尚有账号与预测依赖，应在相关重构验收后单独确认 |
| Public 仓库、远程推送、正式许可证和安装包发布 | 未执行；等待维护者确认及授权/真机验收 |

本轮到此停止。下一阶段需由维护者明确确认；不得把“候选分离完成”理解为已批准公开仓库或停用生产系统。
