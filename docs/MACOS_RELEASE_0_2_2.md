# macOS v0.2.2 发布验证

日期：2026-10-12（Asia/Taipei）。本次仅发布 Mac；Windows 沿用已发布的 v0.2.1 预览版。

## 当前状态

两种架构已完成签名、公证、Staple 与发行文件验收；[v0.2.2 已公开发布](https://github.com/yuyeyuyy/Snipvia-releases/releases/tag/v0.2.2)。六个 GitHub 资产的大小与 SHA-256 全部匹配最终冻结文件。

## 发行配置

- 版本：0.2.2；最低 macOS 14；Apple 芯片 arm64、Intel x64 独立构建。
- Bundle ID：com.snipvia.desktop；Developer ID Team：F76JCDMA4Y；Hardened Runtime 与最小 Entitlements 已验证。
- 每种架构验证 14 个 Mach-O、9 个代码包；原生截图 Helper 保持 Universal 二进制。
- 包内 snipviaAutoUpdate 为 true，公开更新源为 yuyeyuyy/Snipvia-releases，客户端不含 GitHub Token。
- APP、DMG、ZIP 中的 APP 都通过严格签名验证、公证票据验证与 Gatekeeper。
- 最终 SHA-256 / SHA-512 在 DMG Staple 完成后生成；本地公开发行校验器通过。

## Apple 公证结果

| 架构 | APP 提交 ID | DMG 提交 ID | 结果 |
| --- | --- | --- | --- |
| arm64 | `9cee90cd-c7d8-42dc-8a43-63e9b25738c1` | `44842ce1-eab6-4cde-b4fc-9fc321ee097b` | Accepted |
| x64 | `70541541-17e6-4925-8f22-04a53c82ff6f` | `6dc56109-65af-422c-a26c-b176517846c6` | Accepted |

最初的 notarytool 发生 SIGBUS；Apple 第一次不完整上传记录未作为成功依据。恢复时核对签名产物，使用分开的提交 / 查询步骤并关闭 S3 加速；用户调整代理规则后，两次 DMG 完成上传和审核。APP 获得 Accepted 后再 Staple，使用 electron-builder 的 prepackaged 路径生成最终 DMG / ZIP，没有重新签名已公证 APP。

关闭 S3 加速的端点选择见 [Apple 官方公证工作流](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)。本地审计输入与日志保留在本次构建目录，不公开上传。

## 最终安装资产

| 文件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `Snipvia-0.2.2-arm64.dmg` | 139332249 | `acc3be14428e8bd3674df7d1561b6732a7c1e8379171366f5b5f3c27d5cd6de5` |
| `Snipvia-0.2.2-arm64.zip` | 139793672 | `15f555835a2fbc9576d716b6254939addf4c1f66aefa27bf82f22b99bbbe5484` |
| `Snipvia-0.2.2-x64.dmg` | 146143477 | `65f6ebeaff93b6be501dd07f5564139235fce30d72606b22c48a9dcfecf3dfe4` |
| `Snipvia-0.2.2-x64.zip` | 146596832 | `366a50e1fc5e878934b70d8c0108dd8a6fdcd4c6307316dc509c10c2e849cd64` |

清单日期：`2026-10-12T11:09:38.231Z`。公开资产白名单为上述四个安装文件、latest-mac.yml 和 SHA256SUMS.txt。

## 测试与边界

- Lint、类型检查、1001 项单元测试通过。
- 桌面 Electron 回归：37 项通过；11 项按现有真实硬件 / 平台条件跳过，没有删除测试或扩大跳过条件。
- 新更新状态导致四个旧测试使用泛化 status 定位时冲突；收窄到设置保存提示后，四个用例重跑通过。
- 公开发行校验器 5 项合成测试通过；本次最终文件的白名单、版本、SHA-256、SHA-512 和大小验证通过。
- [公开 Release 校验工作流](https://github.com/yuyeyuyy/Snipvia-releases/actions/runs/38241625250)成功，实际下载并核对全部六个发行文件。
- 隔离 Electron 客户端匿名读取真实公开 API：0.2.2 正确显示无需更新，0.2.1 版本夹具正确显示新版本与说明。夹具只验证版本比较，不表示旧安装包已拥有更新功能；见[客户端证据](ci/release-0.2.2-client-check-2026-10-12.json)。
- 匿名下载公开 latest-mac.yml，与本地冻结文件完全一致；见[公开发布与哈希证据](ci/release-0.2.2-publication-2026-10-12.json)。
- [此前实际 Mac 原生升级测试](MACOS_UPDATE_TEST.md)验证了独立签名测试包 0.2.1 → 0.2.2 的下载、明确重启安装与笔记保留。本次公证 / 分发验收不表示重新执行了用户安装目录中的实际升级。
- Intel 真机、多显示器、混合 DPI 和真实模型请求未新增人工验收。

## 代码与资料

本轮调整 package.json 版本、签名文件筛选、四个回归测试定位及发布说明。私有源码工作区保留，不推送到公开仓库。公开仓库提交 8b21e8e 更新 README、安装指南、版本说明；Release 只上传六个白名单资产。官网源码的 Mac 下载链接同步到 v0.2.2、Windows 仍为 v0.2.1，官网类型检查通过，本次没有部署官网。
