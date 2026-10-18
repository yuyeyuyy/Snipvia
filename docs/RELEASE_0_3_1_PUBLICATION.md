# Snipvia 0.3.1 公开发布记录

2026-10-18（Asia/Taipei），经用户明确授权，[v0.3.1](https://github.com/yuyeyuyy/Snipvia/releases/tag/v0.3.1) 已正式发布并设为 Latest。源码标签对应 bcbe19afab07c200464205e2e0923dee535682d7；本次不改变仓库可见性，不改写 Git 历史或调整私有服务。

## 资产与更新渠道

八项资产均已上传：macOS arm64 / x64 的四份 DMG/ZIP、Windows x64 EXE、latest-mac.yml、SHA256SUMS.txt 和 WINDOWS_INSTALL_GUIDE.md。大小与完整 SHA-256 全部匹配冻结候选及 GitHub asset digest。

匿名访问验证了公开仓库、最新 Release、固定标签和八个下载链接。三个文本资产全文匹配；五个二进制前 65536 字节匹配，完整哈希由 GitHub 端 digest 核对。匿名 latest/download/latest-mac.yml 同样与冻结文件完全一致。

使用已发布的 0.3.0 ARM 签名应用，在隔离临时数据目录检查更新，实际得到 available / latestVersion=0.3.1 / downloadSupported=true。没有下载安装更新、触发真实截图、调用模型或使用正式用户数据。

## 验收复用与平台限制

本轮复用 [0.3.1 打包验收](RELEASE_0_3_1.md)，未重新编译、签名、公证或重跑业务功能测试。只核对冻结文件哈希及本次新增的发布状态、匿名下载和更新渠道。

macOS 两种架构已签名、公证；Intel 真机、实际安装升级仍待验收。Windows 为未签名预览版，真实设备运行和升级仍未验证。Windows 保持手动下载安装；不生成未签名自动替换更新渠道。

v0.3.0 Release 的八项资产 ID、名称、大小和 SHA-256 与发布前完全一致；没有删除或覆盖旧版本。已知依赖告警沿用现有 [安全记录](opensource/dependency-security.json)。

## 可追溯记录

- [发布说明](RELEASE_NOTES_0_3_1.md)。
- [机器记录](ci/release-0.3.1-publication.json)：Release ID、标签提交、八项远端资产摘要及检查边界。
- 本地忽略目录 .dev-runtime/publication-0.3.1/ 保存冻结发布计划、草稿校验、匿名下载结果和隔离更新探针。
- README 下载入口、当前笔记自动保存说明已同步至 0.3.1；本次只更新文档，不改变已发布安装包。
