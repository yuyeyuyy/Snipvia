# Snipvia 0.3.0 联合发布验收

正式发布时间：2026-10-18T10:28:32+08:00（Asia/Taipei）。

[v0.3.0 正式 Release](https://github.com/yuyeyuyy/Snipvia/releases/tag/v0.3.0) 已设为最新稳定版，Release ID 为 `416174053`。维护者手动将仓库改为 Public 后，发布程序复核可见性、草稿说明、附件与源码，再将原草稿转为正式发布。未自动修改仓库可见性。

版本标签 `v0.3.0` 固定对应客户端源码提交 `70d87adc3d0bd974e448bb1f6c17dd4dbf9260d8`。发布后补充的本验收文档不改变标签、业务代码或二进制；没有重建、重签、公证或替换冻结安装包。

## 已验证结果

| 验证项 | 结果与边界 |
| --- | --- |
| 无凭据仓库访问 | 匿名 HTTPS API 返回 200，仓库为 Public |
| 最新正式版 | 匿名 `releases/latest` 返回 v0.3.0、正确 Release ID，draft / prerelease 均为 false |
| 标签与源码 | 匿名 tag API 返回上述源码提交，未移动或覆盖旧标签 |
| 8 个附件 | GitHub 返回的完整文件大小与 SHA-256 均与冻结产物一致 |
| 匿名小附件下载 | `latest-mac.yml`、`SHA256SUMS.txt`、`WINDOWS_INSTALL_GUIDE.md` 全文下载，逐字节比对通过 |
| 匿名安装包下载 | 五份二进制分别返回 206，前 64 KiB 与冻结文件一致；没有将抽样说成重新完整下载验证 |
| 签名 Mac 安装版 | Apple Silicon 实际签名应用，在临时空白用户目录中通过 Renderer → Preload → IPC → Main 执行更新检查，返回 `up-to-date`、current/latest 均为 0.3.0、`downloadSupported: true`、无错误 |
| 数据与隐私边界 | 未配置登录和模型 Key，未使用正式用户目录，未截图，未下载或安装更新；测试临时目录已清理 |

安装版验收脚本首次因 macOS `/var` 与 `/private/var` 别名的字符串比较失败；改为真实路径比较后通过。修正只涉及忽略目录中的验收脚本，不涉及产品代码。

## 附件与校验

| 附件 | 大小（bytes） | SHA-256 |
| --- | ---: | --- |
| [Snipvia-0.3.0-arm64.dmg](https://github.com/yuyeyuyy/Snipvia/releases/download/v0.3.0/Snipvia-0.3.0-arm64.dmg) | 141540939 | `972944ff0d69978621d7e58d14bbc6e8440f9dfd1a6cbb1368923b44cd66bd08` |
| [Snipvia-0.3.0-arm64.zip](https://github.com/yuyeyuyy/Snipvia/releases/download/v0.3.0/Snipvia-0.3.0-arm64.zip) | 141957254 | `b27c9a1448c934ef227681759dcf3596798ed1b3fc98d76b6b9c65d3de76e2ef` |
| [Snipvia-0.3.0-x64.dmg](https://github.com/yuyeyuyy/Snipvia/releases/download/v0.3.0/Snipvia-0.3.0-x64.dmg) | 148328043 | `c0ac8b7e429915b39cd208835d2fcc5b76b6bede49429d0601c16516a46d7513` |
| [Snipvia-0.3.0-x64.zip](https://github.com/yuyeyuyy/Snipvia/releases/download/v0.3.0/Snipvia-0.3.0-x64.zip) | 148760418 | `cd7fdd155a1e55be6d00bfefb7451cf2761e6a66211cabb926389dafb50b6e3e` |
| [latest-mac.yml](https://github.com/yuyeyuyy/Snipvia/releases/download/v0.3.0/latest-mac.yml) | 964 | `070480d021fd8e25a314c8554b62e278783963e0649bb16e77e66647461cf012` |
| [Snipvia-Setup-0.3.0-x64.exe](https://github.com/yuyeyuyy/Snipvia/releases/download/v0.3.0/Snipvia-Setup-0.3.0-x64.exe) | 118687707 | `eae9d7cc714daa5465d02f14a8acb790e8cea759dbaea166732233bc2470f56a` |
| [WINDOWS_INSTALL_GUIDE.md](https://github.com/yuyeyuyy/Snipvia/releases/download/v0.3.0/WINDOWS_INSTALL_GUIDE.md) | 1405 | `ea85127a41d468da3a6806b25a32606e7c8680010ceffb28f6d53a0467bd51ba` |
| [SHA256SUMS.txt](https://github.com/yuyeyuyy/Snipvia/releases/download/v0.3.0/SHA256SUMS.txt) | 450 | `a3b1264163b7313545c285f4761860d875d1863192afcd0cdf277a4fab1f9286` |

## 平台状态与既有风险

- macOS Apple Silicon / Intel 使用 Developer ID 签名和 Apple 公证通过的既有产物；本轮只验证已冻结产物的公开分发。签名、公证、Gatekeeper 与既有运行检查见 [macOS 打包验收](MACOS_RELEASE_0_3_0.md)。Intel 真机验收仍未完成。
- Windows x64 为**未签名预览版**，尚未完成 Windows 真机安装/卸载、DPAPI、真实截图及升级验收；保持手动下载安装，不开放未配置签名的自动替换。见 [Windows 打包验收](WINDOWS_RELEASE_0_3_0.md)。
- `node-forge@1.4.0` 的 1 项 high 和构建依赖既有告警仍未修复；发布说明保留有限可达性分析及风险，不把它们写成已解决。
- 本轮补充发布记录后，使用 Node v24.15.0 / pnpm 11.1.3 再次执行 lint、typecheck、63 个文件共 981 项单元测试，均通过；既有完整 Electron 套件为 41 通过、11 跳过、3 失败。本轮公开访问及安装版更新检查不能替代全套平台验收，也没有删测或跳过失败用例以取得通过结果。见 [发布前检查](ci/release-0.3.0-preflight-2026-10-18.json)。
- 旧账号版仍使用原更新渠道，需手动安装 0.3.0 后进入新渠道。本轮没有修改旧渠道、私有服务仓库、生产服务、用户目录或历史数据。
- 第三方许可与 lazy-val MIT 补充的边界保持不变，见 [发行说明](RELEASE_NOTES_0_3_0.md)。

## 证据与回滚边界

[脱敏机器记录](ci/release-0.3.0-publication-2026-10-18.json) 包含公开 URL、附件哈希、匿名验证范围及实际安装版检查结果。没有加入本地绝对路径、凭据、签名容器、原始 OCR、用户截图、运行日志或源码备份作为 Release 附件。

原冻结安装包、本地发布前快照和工作区恢复记录继续保存在本地忽略目录。后续修复应使用新补丁版本，不覆盖 v0.3.0 已发布的安装包或移动其标签；若需暂停分发，可单独撤回本版 Release，而不改写源码历史或删除用户数据。
