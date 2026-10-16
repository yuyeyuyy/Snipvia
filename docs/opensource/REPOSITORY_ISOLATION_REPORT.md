# Snipvia 仓库历史隔离报告

日期：2026-10-16。依据：维护者已确认“旧库保留私有归档，建立干净同名仓库，先保持私有”。本次仅处理仓库身份、Git 交接、文档和验证，不改动截图、AI 或其他业务实现。

## 交付结果

| 仓库 | 身份与用途 | 可见性 |
| --- | --- | --- |
| [Snipvia](https://github.com/yuyeyuyy/Snipvia) | 新仓库，ID `1421836625`；`main` 和 `codex/local-first-phase1` 使用独立客户端历史 | Private，未归档 |
| [Snipvia-legacy](https://github.com/yuyeyuyy/Snipvia-legacy) | 原仓库改名，ID 仍为 `1372547347`；完整保留旧混合历史、PR、标签及 Release | Private，已归档，只读 |
| [Snipvia-server](https://github.com/yuyeyuyy/Snipvia-server) | 服务端、控制台、官网、后台契约、部署资料、锁文件及专用测试 | Private，未归档 |

新旧仓库名称虽然曾相同，仓库 ID 不同。旧仓库没有被强推、删除或转为公开；新仓库没有通过 fork、import 或复制旧 `.git` 建立，没有迁入旧标签、PR 或 Release。

私有项目 `main` 保持 `a5f9cc0029623b682907b37193d2f12cd8f44195`，本次没有改动。Phase 1 的无账号运行、直接用户模型预测、旧 Cookie 不读取、原有本地功能与权限边界维持不变。

## 客户端历史边界

新客户端根提交为 `1e058214961fbd0225f6145f359f931995e6543d`，Phase 1 实现提交为 `c40d29d77d6b6db7cb8a7d2cdf3032b6e3acf19c`。本次另有一项仅更新交接文档的提交；`main` 和 Phase 1 分支指向同一交付版本。

从新远程另行建立镜像，验证所有可达提交的树与全部本地 Git blob：

- 只有上述独立客户端根，没有对象 alternates，原私有 HEAD `c414cdd991733ffb8bb4ee88dd53cdb22a691744` 对象不存在。
- 任一可达树中均没有 `apps/server/`、`apps/console/`、`apps/website/` 或 `packages/console-contracts/` 源码，也没有实际 `.env`、数据库或私钥/证书文件。
- 新仓库没有旧标签、Release 或 PR；原仓库的远程引用完全一致，原 Release、资产和 PR 的 ID 保持不变。
- 既有凭据模式扫描结果为 0。模式扫描不能证明绝对没有秘密；二进制素材未完成逐张隐私与授权审查。
- 当前工作区的交付文件与独立客户端候选逐一比较，内容相同。没有用原 HEAD 覆盖原有未提交功能。

验证的精确提交、对象计数、文件哈希、远程仓库元数据和扫描记录保存在受保护的本地检查点 `../Snipvia-migration-backups/20261016-repository-isolation/`，不提交到任一远程。

## 本地工作目录与后续开发

| 本地目录（相对原项目） | 当前 Git 状态与用途 |
| --- | --- |
| `../Snipvia-public-baseline/` | 干净的客户端工作目录，当前分支 `main`，`origin` 为新 `Snipvia`；后续客户端开发与推送从此目录进行 |
| `../Snipvia-private-candidate/` | 私有工程工作目录，`origin` 为 `Snipvia-server` |
| 原 `Snipvia/` | 工作文件和未提交状态原样保留，HEAD 仍为旧 `c414cdd`；仅将 `origin` 改为私有只读的 `Snipvia-legacy`，防止误把旧历史推入新库 |

原目录 `.git` 没有被替换或清理，因此它不是新公开候选的 Git 推送源。原目录中被忽略的实际环境和运行数据继续留在原位，不能把整个目录打包上传。独立客户端工作目录包含迁移前未提交功能的文件内容，这些功能已随根快照与 Phase 1 提交保全。

新客户端 `origin` 的 fetch 指向新仓库分支，保留 `--no-tags` 配置；需要版本标签时应显式读取新仓库标签。没有从旧仓库拉取历史来“合并”新基线。

## 验证与发布边界

本次业务源码、原生代码、测试和依赖没有变化。沿用 Phase 1 已完成的 lint、typecheck、build、58 个文件的 929 项单元测试，以及独立候选同一次运行的 8 项关键 Electron 验收。完整 Electron 旧状态断言的修正和复验范围见 [Phase 1 报告](PHASE1_REPORT.md)，未将有条件跳过的测试算作通过。本次没有为仓库元数据和文档变更重复运行这些业务测试。

新增验证包括：新旧仓库 ID 与 Private 状态、私有归档标志、所有远程引用、旧协作/Release 元数据、新远程独立镜像与 `git fsck`、全部可达树检查、凭据模式扫描、源码一致性和可离线恢复的 bundle 校验。

源码更新源继续为 `yuyeyuyy/Snipvia`。新仓库当前仍 Private 且没有 Release，匿名客户端无法从中获取正式更新；这不是已完成的线上发布。新免费版仍需选定新版本、签名/公证、发布和真实更新验收。旧安装包的 `Snipvia-releases` 更新源、原安装包及生产服务均未操作。旧账号版客户端仍可能依赖后台，不能据此停服。

## 数据保全与回滚

本次检查点：`../Snipvia-migration-backups/20261016-repository-isolation/`，目录权限为 `0700`。

| 恢复材料 | 内容 |
| --- | --- |
| `source-git/`、`client-git/`、`private-git/` | 操作前三个工作目录的完整 Git 元数据，含索引、refs、reflog 和配置 |
| `original-remote.git/`、`original-remote.bundle` | 改名前远程 Git 镜像及所有广告引用；经完整性检查 |
| `client-before-isolation.bundle` | 操作前独立客户端历史，不依赖旧私有历史 |
| `new-client-remote.git/`、`new-client-final.bundle` | 从新远程复验的最终独立客户端历史 |
| `original-*.json`、`*-refs.txt` | 原仓库身份、分支、标签、PR、Issue 与 Release 元数据 |
| `*-manifest.json`、`final-verification.json` | 操作前后文件哈希与最终验证结果 |

首次分离与 Phase 1 前的完整源码快照仍分别保存在 `20261016-local-separation/` 和 `20261016-phase1/`，各自的 `restore.py` 默认仅校验，显式恢复时要求不存在的新目录，拒绝覆盖原工作区。

本地 Git bundle 可以离线恢复到新目录，例如：

```sh
# 在 Snipvia 原目录运行；目标必须尚不存在。
git clone --branch main \
  ../Snipvia-migration-backups/20261016-repository-isolation/new-client-final.bundle \
  ../Snipvia-client-recovery
```

bundle 不包含 GitHub Issue、PR 或安装包资产；这些继续保存在未删除的私有归档仓库，JSON 仅用于核对元数据。恢复出的本地仓库默认 origin 指向 bundle，推送前需另行检查远程配置。

如果以后要撤销远程名称切换，先保全新仓库后续工作，将新仓库改为另一个可用私有名称，再对旧库取消归档并恢复原名称。同步调整本地 origin 和更新源，再验证下载链接。不要删除新库来腾名，也不要把两套不相关历史强行合并；此回滚尚未执行。原 `source-git/` 可供恢复原远程配置与索引，但必须在新目录操作，避免覆盖后续工作。

## 后续门槛

仓库历史隔离已完成，可以审阅新的私有客户端基线。当前仍不建议立即 Public：根包仍为 `UNLICENSED`，正式 LICENSE/NOTICE、贡献归属、字体/图标/图片的授权及隐私复核尚待维护者确认。历史隔离通过不代表这些问题已经解决。

本次没有创建 Public 仓库、改变任何既有仓库可见性、发布安装包、部署、停服、删除生产资源、修改旧客户端更新源或开展 Phase 2。
