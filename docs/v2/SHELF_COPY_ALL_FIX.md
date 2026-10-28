# 全部复制：原生多文件修复

日期：2026-10-25。工作区：Snipvia-public-baseline。只修复收纳区“全部复制”；截图取帧、快捷键、单张复制、合并和导出逻辑未改，不提交或推送。

## 故障原因与实现

用户反馈任何位置均无法按多图粘贴，而 Finder 多选图片复制正常。Main 原本已取整个 Collection 的有序 ID，并非只取多选项。问题在剪贴板格式：Electron 44.4.1 使用同一个 ScopedClipboardWriter 处理所有条目，多个 image/png ClipboardItem 不会构成多个文件。旧测试只断言传入数组长度，未覆盖系统实际文件列表。

本次在 Main 写每张未重编码原图到 userData/clipboard-files 的私有批次目录，用单个 text/uri-list 条目提交所有文件 URL，再回读数量和顺序；不符时返回错误，不让按钮显示成功。全部复制始终取整个 Collection，合并/导出继续遵循原选择逻辑。平台格式映射由当前 Electron 提供，无新增依赖。

来源：[Electron 44.4.1 剪贴板写入](https://github.com/electron/electron/blob/v44.4.1/shell/browser/api/electron_api_clipboard.cc)、[文件格式处理](https://github.com/electron/electron/blob/v44.4.1/shell/browser/api/electron_api_clipboard_item.cc)、[原生文件剪贴板接口](https://github.com/electron/electron/blob/v44.4.1/docs/api/clipboard-item.md)。

## 引用与隐私边界

- 复制期间持有来源，拒绝重复并发，清空集合不会中断正在准备的文件。
- PNG/JPEG 原字节、扩展名和集合顺序保留；文件名带序号和截图 ID，不含用户内容。
- 目录 0700、文件 0600（Windows 依赖系统 ACL），512 MiB 总量限制；重复复制同一批完整图片复用缓存。
- 已被系统剪贴板引用的批次不会清理，清空集合/退出不删除已提交文件，避免延迟粘贴失效。其他批次超过 30 分钟在下一次全部复制时清理；没有下一次复制可能长期留存，副本未加密。
- 未提交失败回滚新批次；已提交但回读异常保留文件。磁盘不足或剪贴板拒绝仍保留来源并显示错误。
- 不将磁盘路径交给 Renderer，不新增 IPC 权限，不读取真实截图或调用网络服务。隐私说明同步更新。

## 本轮文件

| 文件 | 变化 |
| --- | --- |
| src/main/storage/CollectionClipboard.ts | 原生多文件列表、独立缓存生命周期、回读检查、失败回滚 |
| src/main/index.ts | 传入当前 userData 下的 clipboard-files 路径；不改变 userData |
| tests/unit/collection-clipboard.test.ts | 原字节/顺序/权限、保留引用、并发、丢项、回滚、缓存复用/空间和参数边界 |
| tests/integration/shelf-column-headless.spec.ts | 真实按钮/IPC 经文件列表模拟接收 8 张原图，数量/顺序/哈希、失败提示、清空及重启后文件有效；修复重启后离屏绘制清理 |
| scripts/test-collection-clipboard-native.mjs | macOS 显式 opt-in 合成图片测试入口 |
| tests/fixtures/native-clipboard-probe.swift | 用 AppKit 原生文件接收独立验证，内存保全和恢复剪贴板 |
| docs/TECHNICAL_DESIGN.md、docs/PRIVACY.md、docs/DEVELOPMENT.md | 文件复制格式、缓存边界与复现命令 |

## 验证记录

- 隔离副本 lint、typecheck 通过；40 个单测文件、217 项测试通过（全部复制专项 7 项）。
- electron-vite build 通过；收纳区离屏 Electron 回归 1 项通过，11.7 秒。8 张图片在多选 2 张的情况下仍全部复制，原字节和顺序一致，清空及重启后复制文件仍有效；原有排序、拖出、导出、贴边及设置断言保留。
- 回归首次发现 macOS /var 与 /private/var 路径别名比较失败，改为 realpath 比较；随后发现重启后的离屏绘制未停止导致测试清理超时，补齐第二次退出清理后通过。未删除或跳过断言。
- 真实 macOS 剪贴板专项通过：AppKit 读出 3 个独立文件 URL，逐个复制到临时接收目录，SHA-256 与原始 PNG 相同；来源进程退出后仍有效，测试结束恢复原剪贴板。只使用合成图，原剪贴板所有格式仅存内存，不输出或落盘。
- Windows 的 CF_HDROP 映射来自当前 Electron 接口；本轮没有 Windows 真机，不标记 Windows 或每款聊天输入框已验收。目标应用必须支持文件/附件粘贴，纯文本输入框可能不接收文件。

同步后的常规构建与保护检查记录在本机 .dev-runtime/shelf-copy-all/validation.json。

## 恢复

同步前按 before-sha256.json 核对原工作区 313 个文件及暂存区，改变的文件另存 before-files/，sync-manifest.json 记录旧/新哈希；全部位于本机 .dev-runtime/shelf-copy-all/，不进入 Git。恢复时仅在当前哈希等于清单新哈希的情况下逐文件恢复旧版本，新增文件仅在哈希匹配时移除；不要 reset/clean 或覆盖后来改动。撤回修复前先复制其他内容替换系统剪贴板，再酌情清理本轮 clipboard-files；旧版代码不提供多文件复制。

开发版允许自动重载。暂存内容、原有截图/设置、账号隔离历史及其他既有改动保留；未打包、签名、发布或推送。
