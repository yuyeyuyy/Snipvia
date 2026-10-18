# Windows 0.3.1 透明图标重包

2026-10-18（Asia/Taipei），按用户指定改用 `UI/Snipvia-Win-transparent.ico`，已重新打包并更新 [v0.3.1 Windows 下载](https://github.com/yuyeyuyy/Snipvia/releases/download/v0.3.1/Snipvia-Setup-0.3.1-x64.exe)。

## 实际变更与验证

- Windows 应用图标、NSIS 安装器与 `resources/Snipvia.ico` 使用指定 ICO。源文件 SHA-256 为 `6fe028ad2e05c2b0166ba48bee390e0b84760de093b3395cca83ae04efe08bd0`。
- 应用 EXE 和安装器内的 16、24、32、48、64、128、256px 共七个图标帧，与源 ICO 每个 PNG 帧的字节哈希逐一相同；运行时资源文件也完全一致。
- 定向 lint、构建内类型检查、PE 版本和权限、ASAR、NSIS 解包、卸载器存在性、内嵌文件哈希通过。
- 新旧 `app.asar` 完全相同，SHA-256 均为 `9a3a630b596640a9c336f5adaf11e06efc772cf124bd0e771c27ee95e4ac6d02`。截图、AI 和笔记业务代码未改变，复用已有功能验收，没有重跑单元与 Electron 功能套件。
- 新安装器为 118388573 字节，SHA-256：`90a9c4894151ea319017c51218d34407bb1b5da39ee12109e7ce6d76ce512bbd`。
- Windows 仍为未签名预览版，没有将本次静态校验宣称为 Windows 真机或安装升级验收。

## 线上替换与追溯

先对线上旧 EXE、安装说明、SHA256SUMS 按原哈希保全本地副本；新三项以临时名称上传，核对 GitHub 完整 digest 后才切换正式名称。匿名验证新 EXE 前 65536 字节和两份文本全文，再清理线上旧备份名称。本地旧包与回滚副本保留。

本次同步更新 Windows 安装说明中的新哈希及联合校验清单；最终仍为八项发行资产。macOS 四个安装包和 `latest-mac.yml` 的资产 ID、大小与 SHA-256 均保持不变，不重复签名、公证或功能验收。

版本号仍为 0.3.1；已经安装 Windows 0.3.1 的用户可手动重新下载安装包。原发布标签保留 `bcbe19afab07c200464205e2e0923dee535682d7`，没有改写历史；Windows 图标与构建配置对应[提交 cb2cbf9d326c231787cb3e20b1ce4b1d544f9e03](https://github.com/yuyeyuyy/Snipvia/commit/cb2cbf9d326c231787cb3e20b1ce4b1d544f9e03)，Release 说明已明确记录平台重包来源。

## 本地记录与恢复

- 新包：`dist/windows-internal/internal-y6OsCS/`，包含实际构建元数据与 Windows 单文件校验清单。
- 本地回滚副本：`.dev-runtime/windows-icon-20261018/old-assets/`；替换计划保存旧资产 ID、大小、哈希和原 Release 正文。原 0.3.1 候选目录未覆盖。
- 用户本轮开始时已暂存的 ICO、Git 状态与补丁均已保全；源文件按原字节提交，未删除旧 ICO。
- [当前资产与机器验证记录](ci/release-0.3.1-windows-icon.json)。
