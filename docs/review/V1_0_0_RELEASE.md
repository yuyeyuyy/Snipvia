# v1.0.0 发行验收与发布记录

日期：2026-10-30。发行源码为 `6207bd83256ccb5b6390ea02a0446e6ee3d92e35`，后续发行文档提交不改变标签指向或安装包。

## 发行结果

发布时间：`2026-10-30T04:17:26Z`。已通过公开 `/releases/latest/download/latest-mac.yml` 入口下载并核对版本、完整字节及 SHA-256；标签直接指向上述发行源码。

发布地址：[截然 Snipvia v1.0.0](https://github.com/yuyeyuyy/Snipvia/releases/tag/v1.0.0)。macOS Apple Silicon、Intel 与 Windows x64 在同一个正式 Release 分发；旧 v0.3.2 未覆盖。最终公开资产、字节数和 SHA-256 见[发布收据](V1_0_0_PUBLICATION.json)。

macOS 提供两种架构各自的 DMG、ZIP，以及独立 `latest-mac.yml` 和 SHA-256 清单。Windows 提供未签名 NSIS EXE 与独立 SHA-256 清单，保留检查更新及手动安装，不宣称已有签名自动安装更新。没有公开诊断日志、CI trace、内部构建元数据或签名凭据。

## 已验证结果

| 范围 | 实际结果 |
| --- | --- |
| 依赖与许可证 | Electron 44.9.1；完整审计 615 条依赖记录，已知漏洞为 0；122 个生产依赖版本，0 个缺少许可证文件 |
| 源码检查 | lint、typecheck、build 通过；macOS 52 个单测文件、296 项通过；Windows 52 个文件、289 项通过、7 项依平台未执行 |
| macOS 完整集成回归 | 31 通过、13 个依环境未执行，不能据此声称已完成所有真实屏幕专项 |
| Windows 源码桌面回归 | 14 通过、1 个仅适用 macOS 的 SCK 用例未执行 |
| Windows 安装版 | 临时目录实际安装、正式 EXE 启动、版本/运行时/图标/快捷键/隔离接口检查、合成截图取消/复制/收纳及卸载全部通过 |
| macOS 正式包 | 完整 Xcode 27.2；arm64/x64 APP、DMG、ZIP 签名、公证 Accepted、Staple、Gatekeeper 及最终元数据/哈希检查通过 |
| 原生辅助进程 | Universal Helper 重建、协议取消/释放/退役命令拒绝、浏览器 worker 检查通过 |
| macOS 多文件剪贴板 | 3 张合成 PNG 的数量、原字节和退出后读取验证通过，恢复原剪贴板；未记录用户剪贴板内容 |
| 人工连续截图 | 用户试用签名候选，明确反馈“两次都正常，速度可接受”；该轮候选之后只有测试和 CI 改动，`src/`、`native/`、依赖与正式打包逻辑未改变 |

Windows 运行证据：[成功 CI 40999082293](https://github.com/yuyeyuyy/Snipvia/actions/runs/40999082293)。公开 EXE 来自此任务的 `windows-unsigned-internal` 产物 12952876551，源提交与 macOS 冻结报告相同；没有以本地交叉构建代替安装验证。

## 本轮实际修复

- 依赖升级和开发运行时替换见[安全修复记录](V1_0_0_SECURITY_FIX.md)，没有更改截图、收纳或旧数据业务逻辑。
- `scripts/prepare-release-build.mjs`：Windows 通过 Node 启动当前 pnpm CLI，保留字面参数数组，避免 `.cmd` 不能直接执行及 shell 注入。
- `scripts/verify-windows-build.mjs`：按宿主分隔符访问 ASAR、统一禁止资源路径匹配、先确认 7-Zip 能解 NSIS；保留负载/卸载器/源字节与图标检查。
- `.gitattributes`、相关单测：固定许可证 LF、跨平台 realpath/只读位夹具及可恢复的模拟 macOS SCK 平台，不降低生产安全校验。
- `tests/integration/windows-release.spec.ts`：使用正式 Main 上下文的 Node 内置模块接口；等待惰性收纳窗口加载；补齐安装版本身的合成工作流测试。
- `tests/integration/capture-window-visibility.spec.ts`：按现有 Windows 错误呈现策略检查失败时显现 Main，仍验证正常截图不闪烁。
- `tests/integration/v2-settings.spec.ts` 与 Windows workflow：加入不含图片、凭据和网址的阶段诊断；安装专项在构建通过后独立运行，任何有效检查失败仍阻止资产上传。
- `tests/integration/v2-continuous.spec.ts`：合成截图输出到忽略的 `test-results/`，不改写已跟踪文档图片。

## 未解决项和验收边界

1. **macOS 原生截图专项未通过。** 正式包在本机出现 SCK `capture` 500ms 超时后回退 Electron；不能把回退截图计作原生后端成功。独立诊断将预算临时提高到 10 秒仍未返回，输入线程与 RunLoop 对照也未证明能修复，未合入这些实验、未改原有 500ms 保护。初始化成功、录屏列表开启以及人工能截图，均不能证明原生路径通过。根因仍待定位，不宣称已经修复。
2. 用户在上述限制已告知的情况下完成常用截图人工试用并确认正常；本次发行保留现有自动回退，以已验证的功能可用性为依据，不承诺全设备原生性能。后续应在单一 App 实例、实际安装路径和明确权限责任下复核 SCK，并记录冷/热捕获耗时；不能靠增加超时掩盖问题。
3. Windows 旧数据兼容用例先前曾间歇超时；增加阶段诊断后的两次流程均通过，包括完整重启和数据未变断言。没有删测试、添加自动重试或任意扩大超时；尚无足够失败阶段证据确认唯一根因。
4. Intel 真机、多屏/混合 DPI、所有第三方多文件粘贴和拖放目标尚未全面验收。Windows CI 的合成帧及静默安装不等于这些硬件和第三方场景已通过。
5. 收纳截图仍仅驻留当前应用运行期间，重要截图应先导出；本次未添加持久化或云服务。

## 数据、回滚与发行保护

- 未修改正式 App ID、Bundle ID 或实际用户数据目录；本轮人工试用使用独立验收数据目录。原截图、旧记录、设置和密钥未删除，系统 TCC 数据库未重置。
- 保留 `d377977` 功能基线、所有正常提交和本机 `.dev-runtime/v1-security/` 恢复备份；诊断副本与实验 Helper 均未进入 Git 或安装包。
- 发布前复用现有源码/标签校验、草稿资产白名单和远程 SHA-256 检查，额外核对 Windows 成功 CI、下载产物来源与本地 SHA-256。全部 8 个文件完整后才取消草稿。
- 后续修复从发行标签建立分支并使用新版本号，不覆盖 v1.0.0 资产或改写历史。回退代码或开发运行时前先保存当前截图和用户数据；不能把旧安全依赖版本作为长期解决方案。
