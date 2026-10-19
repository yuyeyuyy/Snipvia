# 源码与安装包分发

## 0.3.2 当前分发方式

客户端源码及新安装包统一使用 [yuyeyuyy/Snipvia](https://github.com/yuyeyuyy/Snipvia)。服务端、管理后台和官网不在此仓库内。源码采用 Apache License 2.0，安装包及依赖保留各自声明。历史记录中“源码私有”和 `Snipvia-releases` 描述的是旧账号版分发阶段。

0.3.2 的联合发行白名单为：Apple Silicon / Intel 两种架构的四个 DMG / ZIP、一个 Windows x64 EXE、`latest-mac.yml`、`SHA256SUMS.txt`、`WINDOWS_INSTALL_GUIDE.md`。Windows 明确标记未签名预览，不能借 macOS 公证宣称 Windows 已签名或真机验收通过。

五个二进制、更新元数据与安装说明的 SHA-256 汇入公开校验文件，Mac 更新清单仍只引用四个经过签名公证的 Mac 文件。源 `verified/` 及已冻结二进制保持原样。不得上传内部 verification.json、BUILD_METADATA.json、构建日志、源码备份、证书容器或用户资料作为 Release 附件；GitHub 自带源码归档对应本版源码提交。

源码推送与 tag 只指向已检查的独立客户端历史，不强推、不镜像上传旧归档仓库。Release 先创建草稿，上传白名单，核对 GitHub 端大小和 SHA-256，齐全后再公开为最新版。仓库可见性本轮由维护者手动更改；发布程序不得自行更改。

`scripts/macos-release/publish.cjs` 仍是 Mac 专用六文件发布器，保持原白名单保护。不能用它覆盖含 Windows 附件的同版本联合 Release；联合发行按上述八文件清单显式操作，并保存本地发布计划和校验结果。

旧账号版仍使用旧更新源，本次不修改旧仓库或追溯替换旧二进制；旧版用户先手动安装 0.3.2。Windows 继续检查版本并手动安装，不启用尚未配置签名验证的自动更新。

详细平台和安全边界见 [0.3.2 说明](RELEASE_NOTES_0_3_2.md)、[打包记录](RELEASE_0_3_2.md)。0.3.0 / 0.3.1 历史包继续保留。

## 以下为旧账号版分发历史

> 2026-10-16 Phase 1 更新：当前源码的版本检查、下载和新发布目标已统一改为 `yuyeyuyy/Snipvia`。本文中旧发行记录与旧渠道说明仅用于历史过渡；新免费版尚未发布，旧安装包不会因源码变更自动切换渠道。详见 [Phase 1 报告](opensource/PHASE1_REPORT.md)。

## 仓库职责

- 源码工程 `Snipvia` 保持私有，管理 Electron / React / TypeScript、平台测试、服务端、依赖与受信签名构建。
- [Snipvia-releases](https://github.com/yuyeyuyy/Snipvia-releases) 公开提供安装包、更新说明、最终哈希清单和发行校验器。Git 中只有分发资料与校验工具，安装包作为 Release 资产上传。
- `src/shared/release-source.json` 是客户端版本检查、下载、正式 Mac 打包和公开发布器的单一仓库配置。发布凭据只供本机 GitHub CLI 或受信发布任务使用，客户端不携带 Token。

## 本次迁移

公开仓库由空仓库初始化，新增 README、安装 / 更新 / 维护指南、安全反馈说明、Issue 模板、资产校验器与校验工作流。

当前迁移 `v0.2.1` 的六个原发行资产：Mac DMG、Windows EXE、两份安装说明、原发行说明与 SHA-256 清单。迁移前将本地文件哈希与原私有仓库 GitHub 资产 `digest` 逐一比较；发布前再次核对目标资产哈希与大小。原 Release 保留，迁移不删除历史。

这批资产保持原签名、功能与平台边界：Mac 仅 Apple 芯片、临时签名且未公证；Windows 未代码签名。本版本没有自动更新。后续 UI 与更新功能在源代码中完成，不代表旧包已包含；包含新更新源的新正式包需要提高版本号并重新构建。

## 后续正式 Mac 发布

1. 提高项目版本号，完成相关测试与真机验收。
2. 按原授权流程运行正式签名 / 公证构建，得到新的 `verified/`。
3. 检查公开发布计划：

```bash
pnpm release:publish --directory dist/macos-release/<新目录>/verified --notes <公开更新说明.md>
```

4. 明确授权该版本公开发布后，使用同一命令加 `--execute`。它创建或继续内容一致的草稿、上传白名单文件、核对远程 SHA-256 / 大小，最后发布为最新正式版。旧报告、错误更新仓库、公证未通过、文件改动、疑似凭据说明与已发布同版本都会拒绝。

Mac 发布白名单只有两种架构的 ZIP / DMG、`latest-mac.yml` 和 `SHA256SUMS.txt`；不上传 `verification.json`、日志、源码或私人资料。Windows 保持原内部构建 / 测试流程与手动更新边界，不因迁移仓库就开启未配置的签名自动更新。

## 公开 Actions

公开仓库的 `Release validation` 使用固定官方 Actions 提交与 Node 24.15.0，仅授予 `contents: read`。Push 执行五项合成校验器测试；正式 Release 或手动指定 Tag 时下载资产并检查版本、文件白名单、SHA-256、SHA-512 与大小。`v0.2.1` 作为迁移手动包显式允许无自动更新清单。

此工作流不拉取私有源码、不运行应用安装包、不使用模型 / SMTP / Apple 凭据。Linux 文件校验不能替代 Mac 签名、公证或平台功能验收。

## 验证记录

2026-10-12 完成迁移，公开仓库最后提交 `967dd78`；[v0.2.1](https://github.com/yuyeyuyy/Snipvia-releases/releases/tag/v0.2.1) 已正式发布，六个目标资产的大小与 SHA-256 全部与原发行一致。证据见[迁移 JSON](ci/public-release-migration-2026-10-12.json)。

本机大文件上传超时后，使用 GitHub 云端仅搬运原两份安装包。云端只保存短时、单文件下载地址，没有保存私有源码访问 Token；搬运后清理本次两个下载 Secret 和单次工作流，保留迁移证明与常用发行校验任务。

| 验证 | 实际结果 |
| --- | --- |
| 本地检查 | 构建、类型检查、Lint、1001 项单元测试通过 |
| 更新 Electron 回归 | 隔离窗口、模拟更新和新分发地址回归通过 |
| 公开校验器 | 5 项合成测试通过 |
| 原始文件迁移 | 原 / 目标 GitHub 资产 digest 与本地文件逐一核对，通过 |
| 匿名真实客户端 | 未携带 Token，读取公开最新版本 0.2.1，当前 0.2.1 正确显示无需更新 |
| 云端搬运 | [38222206135](https://github.com/yuyeyuyy/Snipvia-releases/actions/runs/38222206135) 成功 |
| 正式 Release 校验 | [38222924739](https://github.com/yuyeyuyy/Snipvia-releases/actions/runs/38222924739) 下载并校验全部资产成功 |
| 最后提交的公开 CI | [38223160857](https://github.com/yuyeyuyy/Snipvia-releases/actions/runs/38223160857) 成功 |
| 官网配置 | 下载地址已改到公共安装资产，官网源码构建通过；未部署官网 |

匿名客户端结果见[JSON](ci/public-release-client-check-2026-10-12.json)。本次没有新签名、公证或构建新版发行包，没有执行公开新版本的实际安装测试；它验证分发源迁移与版本读取，不能替代下一版正式安装验收。

修改包括 `src/shared/release-source.json`、版本检查服务、正式打包 / 发布脚本、更新测试与文档，以及官网的下载配置。源码工作区改动保留本地，没有推送到公开仓库。

先前 [Mac 实机升级报告](MACOS_UPDATE_TEST.md) 验证了本机签名升级链路；其中私有仓库匿名 404 属于迁移前结果。本次不重复签名或 Apple 公证，不改动原冻结产物，也不发布合成测试包。

## 2026-10-12 Mac v0.2.2 正式发行

[v0.2.2](https://github.com/yuyeyuyy/Snipvia-releases/releases/tag/v0.2.2) 已发布，提供 Apple 芯片 / Intel 的 Developer ID 签名、公证 DMG 与 ZIP、最终更新清单和 SHA-256 清单。公开文件哈希匹配本机冻结文件，公开 Actions 实际下载校验通过；匿名客户端版本检查与更新清单读取通过。

从旧版需要先手动安装一次 v0.2.2，之后可使用应用内检查、下载与确认重启更新。本次只发布 Mac，Windows 保留 v0.2.1 预览版。签名、公证、测试与剩余平台边界见[正式发行报告](MACOS_RELEASE_0_2_2.md)。官网源码下载配置同步，本次未部署官网。

## 2026-10-14 Mac v0.2.3 正式发行

[v0.2.3](https://github.com/yuyeyuyy/Snipvia-releases/releases/tag/v0.2.3) 已发布，包含 AI 对话工作区、图片输入、笔记与预测分支的确认编辑，以及新的聊天布局。Apple 芯片 / Intel 两种架构均完成正式签名、公证与安装资产验收，六个远程资产哈希和匿名更新清单匹配；公开发行校验实际下载六个文件并通过。

真实隔离 v0.2.2 客户端已验证能发现新版与说明，v0.2.3 正确显示已是最新版。v0.2.2 用户可在设置 → 关于检查、下载并确认重启更新；更早版本先手动安装新版。公开仓库说明提交为 `411b412`，私有源码没有推送，Windows 保持 v0.2.1。完整证据与硬件验收边界见[发布报告](MACOS_RELEASE_0_2_3.md)。
