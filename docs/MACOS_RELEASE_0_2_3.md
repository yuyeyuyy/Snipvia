# macOS v0.2.3 发布验证

日期：2026-10-14（Asia/Taipei）。本次只更新 Mac，Windows 保留 v0.2.1。

## 当前状态

Apple 芯片与 Intel 的 APP、DMG 和 ZIP 已全部完成 Developer ID 签名、公证、Staple、Gatekeeper 和逐文件验证。[v0.2.3 已公开发布](https://github.com/yuyeyuyy/Snipvia-releases/releases/tag/v0.2.3)，六个资产的大小与 SHA-256 全部匹配冻结文件；匿名更新清单、真实隔离客户端版本检查及公开发行 Actions 通过。v0.2.2 用户可在应用内检查、下载并确认重启更新。

## 已完成的构建与验收

- 版本 0.2.3，macOS 14+，Bundle ID `com.snipvia.desktop`，Team `F76JCDMA4Y`。
- arm64、x64 独立 APP；每份验证 14 个 Mach-O 和 9 个代码包，Helper 为 Universal。
- 两种架构的 `app.asar` SHA-256 均为 `339a71f317aa06c4e226f4a824568821821105ae19bfda093e99487b8e547ed6`。
- 复用既有严格签名 Hook、Hardened Runtime、最小 Entitlements 和公开更新源。没有放宽签名、公证或最终发布白名单。
- 当前源码的类型检查、Lint、1045 项单测与 41 项 Electron 回归通过；原有 11 项平台 / 真机条件跳过未改动。
- 版本提高后再次执行 51 项发布 / 更新相关单测，通过。
- 实际 arm64 签名安装包使用临时用户目录与合成图片，验证页面打开、图片导入预览、笔记创建编辑保存、会话恢复重命名、Light / Dark / System；见[实际包验收 JSON](ci/release-0.2.3-packaged-check-2026-10-14.json)。
- 实际签名 ASAR 的 Agent 命令依赖与独立 Node 脚本测试 1 项通过；没有连接生产账号或调用模型。
- 公开发行校验器的 5 项合成测试通过。

## 公证上传故障定位与恢复

常规加速上传，以及使用 `--no-s3-acceleration` 的提交均报告 `HTTPClientError.deadlineExceeded` / `abortedUpload`。上传未完成的任务在 Apple 历史中显示 `In Progress`，不能据此视为审核通过。已保留签名产物，不重复签名 arm64 APP；Intel APP 通过独立目录构建后使用同一正式签名 Hook 完成验证。

基础 HTTPS 检查中，S3 域名在直连与代理下均返回 403（匿名请求预期的权限错误），说明基础连通性存在；不代表大文件上传成功。实际 notarytool 使用本机 `127.0.0.1:7897` 代理，进程级 HTTP_PROXY 设置不能覆盖其任务历史请求的系统路由。仅凭连接到本机代理不能判定最终路由。

后续通过 Clash 的真实连接页确认，S3 上传匹配 `DomainRegex(.+)`，链路为「海外固定（静态ip） / 静态ip」。活动规则筛选没有公证域名，重新激活订阅后仍然没有。只读检查发现：用户规则文件确实已经包含三个 Apple DIRECT 域名，但该订阅的自定义脚本用 `config.rules = rules` 重建列表，覆盖了此前的用户规则。Apple 详细日志中鉴权和创建任务均返回 200，随后 S3 上传超时。

曾准备保留三个原有 DIRECT 规则的脚本提案；自动审批拒绝持久改写网络路由，故未执行脚本修改。用户随后自行调整配置并要求重试。重试时真实连接匹配 S3 域名 DIRECT，135 MB 文件约 17 秒上传成功，Apple 返回提交 ID `8510b0d5-9935-4712-9006-f42908a1305e`。本次没有关闭系统代理或改写代理脚本。

恢复流程逐一完成 APP / DMG 的 Accepted、Staple、Gatekeeper，检查 ZIP 解压后的 APP，再冻结四个安装文件并生成最终更新哈希。公开发布器只接受两种架构全部通过的完整报告。

## 最终公证与安装资产

| 架构 | APP 提交 ID | DMG 提交 ID | 结果 |
| --- | --- | --- | --- |
| arm64 | `8510b0d5-9935-4712-9006-f42908a1305e` | `dd342b26-bddb-424e-90e8-136d18f7558c` | Accepted |
| x64 | `192332be-1782-468d-8f25-1f593902a77f` | `d8e8c122-fbef-4dbe-9778-ea18f2696227` | Accepted |

| 文件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `Snipvia-0.2.3-arm64.dmg` | 139367576 | `c2d9b70ad41b51a4970d476dceb030e0e4ec7fc0a1c4eedf0ce1a9a12e6d28be` |
| `Snipvia-0.2.3-arm64.zip` | 139831147 | `1fad3a8eff3a9b7a1e262594472e483b78c0423d6f178ae2423694e68299a529` |
| `Snipvia-0.2.3-x64.dmg` | 146153316 | `4b2e0d37cde7b0b81f9f6941aca7afd1ce0920de5f3923147c960ec6e36fb357` |
| `Snipvia-0.2.3-x64.zip` | 146633881 | `4481f3299a29718a86f0e9b63b5162fd9fd0ab5b5783b603152c4dc89f425df1` |

基于最终冻结资产的公开校验器通过，白名单只含上述四个文件、`latest-mac.yml`、`SHA256SUMS.txt`。ASAR 检查确认两个版本都启用自动更新，项目资源仅包含编译输出与 package.json；分发资料已提交到公开仓库 `411b412`，私有源码没有推送。

## 公开发布与客户端验证

- GitHub 标准大文件上传在代理链路超时。改用仅发布进程绑定物理网卡、官方 DNS 解析地址与正常 HTTPS / HTTP 1.1 上传，不更改持久代理设置，不放宽 TLS 校验。Intel 传输触发短超时后继续未完成文件，保留已经哈希验证的资产。
- 六个远程资产逐一核对大小与 SHA-256，通过；匿名下载的 `latest-mac.yml` 与最终冻结文件逐字节相同，见[公开发布证据](ci/release-0.2.3-publication-2026-10-14.json)。
- [公开 Release 校验任务](https://github.com/yuyeyuyy/Snipvia-releases/actions/runs/38539645546)成功，实际下载并校验六个资产；[公开说明提交校验](https://github.com/yuyeyuyy/Snipvia-releases/actions/runs/38537218135)也通过。
- 真实签名 v0.2.2 与 v0.2.3 客户端使用临时目录、匿名查询实际公开 API：旧版发现新版本并显示说明，新版正确显示已是最新版；两者签名更新能力均已启用，见[客户端证据](ci/release-0.2.3-client-check-2026-10-14.json)。验收脚本首次错误地要求「已是最新版」也返回更新说明，修正这一脚本预期后两项通过；产品代码未因此修改。
- README 与官网源码下载配置已同步到 v0.2.3，官网类型检查通过；本次没有部署官网。

更新内容见[公开发布说明](RELEASE_NOTES_0_2_3.md)。Intel 真机、多显示器、混合 DPI、真实模型服务调用及用户安装位置中的实际升级未新增验证。
