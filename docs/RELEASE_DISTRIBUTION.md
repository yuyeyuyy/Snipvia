# 当前分发状态

[v1.0.0 已正式发布](https://github.com/yuyeyuyy/Snipvia/releases/tag/v1.0.0)，源码标签指向 `6207bd83256ccb5b6390ea02a0446e6ee3d92e35`。后续发行文档提交不改变此指向。

| 平台 | 分发与已验证范围 |
| --- | --- |
| macOS Apple Silicon / Intel | DMG、ZIP；Developer ID 签名、Apple 公证 Accepted、Staple、Gatekeeper、最终元数据与哈希通过 |
| Windows x64 | 未签名 NSIS EXE；成功 CI 中完成源码回归、实际安装、合成截图/复制/收纳及卸载 |

8 个远程资产的字节数和 SHA-256 均已核对；见[公开发布收据](review/V1_0_0_PUBLICATION.json)与[完整验收记录](review/V1_0_0_RELEASE.md)。没有上传本机诊断、CI trace、私有源码或密钥，没有覆盖旧 v0.3.2。

更新源以 `src/shared/release-source.json` 为准，仍为 `yuyeyuyy/Snipvia`。macOS 的公开 `releases/latest/download/latest-mac.yml` 已实际下载并与冻结清单逐字节核对，版本为 1.0.0；不依赖官网或账号服务。Windows 保留检查更新、手动下载与安装，尚无签名自动安装更新。

本机 macOS 原生 SCK 专项仍出现超时后回退 Electron，不能列为原生路径通过；用户对签名候选连续截图反馈正常且速度可接受。Intel 真机、多屏/混合 DPI 与所有第三方粘贴/拖放目标尚未全面验收。详细限制及后续复核条件见发行记录，不以静态包体或合成测试代替。

[公开更新说明](RELEASE_NOTES_v1.0.0.md)与[安全修复记录](review/V1_0_0_SECURITY_FIX.md)已归档。后续修复使用新版本号，不覆盖正式资产、不改写标签或 Git 历史。
