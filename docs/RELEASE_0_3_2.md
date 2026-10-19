# Snipvia 0.3.2 打包与发布

2026-10-19（Asia/Taipei），[v0.3.2](https://github.com/yuyeyuyy/Snipvia/releases/tag/v0.3.2) 已正式发布为 Latest，标签固定源码提交 bdcf296553996d7e60829a886bb1d5d6a2b540a4。旧 v0.3.1 的八项资产 ID、大小与完整哈希保持不变，未改写旧标签或历史。

## 新功能已加入实际安装包

- 主窗口右上角「反馈」弹窗显示 QQ 群号 **643251313**。
- 「复制群号」经现有 Main 校验的复制接口运行，成功后显示「已复制」。
- AI 对话左下角重复设置入口已移除，右上角齿轮保留。
- Windows 继续使用用户指定的透明 ICO，应用、安装器及运行时资源一致。

实际签名 ARM 应用在隔离临时数据目录完成上述三项界面确认，复制使用 Main 写入替身，不触及真实剪贴板、用户数据或模型服务。三个平台包的 Renderer 文件与本轮编译输出逐字节一致，并检查版本、新功能文本和被删除的入口。

## 按要求复用验收

遵照用户「不用再跑验证，只验证新功能有没有加上」要求，本轮没有运行 lint、Vitest、完整 Electron 或平台功能回归。此前反馈与复制的成功/失败/重开、草稿、主题和窄窗口检查已完成且源码哈希匹配，直接复用。

桌面只编译一次，Windows 与两种 Mac 架构共用输出；Swift Helper 使用原有哈希凭据复用。构建命令自带类型检查和依赖通知生成，未单独增加测试门槛。

新 Mac 安装包执行必需的 Developer ID、时间戳、Hardened Runtime、Entitlements、Apple Accepted、Staple、Gatekeeper 和容器完整性检查。Windows 新 EXE 执行既有 PE/图标/NSIS 静态完整性检查；这些是新发行物的身份与完整性记录，不重跑业务套件。

## 发布与更新

八项资产：两种架构各一份 DMG/ZIP、Windows x64 EXE、latest-mac.yml、SHA256SUMS.txt、WINDOWS_INSTALL_GUIDE.md。上传前冻结哈希，先上传草稿，逐项核对 GitHub 端大小与完整 SHA-256，齐全后设为 Latest。

匿名确认公开仓库、标签、八个下载链接及 latest/download/latest-mac.yml。文本文件全文匹配，二进制仅检查前 64KiB；完整哈希使用 GitHub 上传 digest 对照。未重复运行旧客户端更新探针，也未下载安装更新。

Windows 仍是未签名预览，真实设备和安装升级未验证。Intel 真机、混合 DPI 与真实模型未在本轮补做；既有[依赖告警](opensource/dependency-security.json)未由本次界面更新修复。

## 记录与恢复

- [发布说明](RELEASE_NOTES_0_3_2.md)、[包与新功能记录](ci/release-0.3.2-packaging.json)、[远端发布记录](ci/release-0.3.2-publication.json)。
- 包装前十三项改动的源码归档、补丁及逐文件哈希：.dev-runtime/release-0.3.2/before-packaging.*。
- 原始 Mac/Windows 构建输出、实际新功能探针和验收复用记录：.dev-runtime/release-0.3.2/；冻结发布白名单、草稿与匿名检查：.dev-runtime/publication-0.3.2/。
- 源码已推送公开客户端 main；不访问或修改旧恢复目录、私有仓库和生产服务。回退可使用保留的旧安装包与源码提交，不删除用户设置或笔记。
