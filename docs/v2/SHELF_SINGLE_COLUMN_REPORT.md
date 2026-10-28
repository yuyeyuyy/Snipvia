# 收纳区单列与悬浮操作改造记录

## 本次行为

- 展开为右侧单列纵向滚动，图片无面板底色、外框；左侧中部提供合并复制和导出 PNG。
- 每张图左上复制、右上删除，按钮固定 36 DIP；拖动排序，支持边缘自动滚动和 Alt+方向键排序。移除图片下方的小工具栏。极窄截图的透明交互面最小宽 128 DIP，使复制、选择和删除互不遮挡；最小尺寸下图堆和展开入口保持在视口内。
- 点击多选后才显示图片上的勾选按钮；多选输出选中图片，普通模式输出全部。收起时图堆上方保留合并复制和导出 PNG。
- 半透明玻璃、语义边框和阴影加强按钮悬浮感，Light / Dark / System 沿用已有 Token。
- 左下角拖动调整大小，顶栏提供宽高滑块及恢复默认。默认 420×660 DIP；宽 280–960、高 300–1600 DIP，按屏幕工作区限制实际窗口。
- 原图预览保留；定住当前截图移至合并选项。清空仍由 Main 的原生确认保护。

## 文件范围

| 文件 | 变更 |
| --- | --- |
| src/renderer/src/collection/ScreenshotShelf.tsx | 单列、图片悬浮操作、多选、拖动、尺寸控件及有界命中区域 |
| src/renderer/src/collection/shelf.css | 透明布局、固定按钮尺寸、玻璃效果、滚动与拖动样式 |
| src/renderer/src/components/Icon.tsx | 沿用矢量图标系统，增加操作图标 |
| src/shared/collection.ts | 单列几何、尺寸状态与窄接口 |
| src/shared/shelf-preferences.ts | 新增尺寸默认值及严格参数 schema |
| src/main/windows/ShelfWindow.ts | 保持右上锚点的原生窗口调整、手势期间鼠标事件持有 |
| src/main/storage/ShelfPreferencesStore.ts | 独立原子偏好存储，损坏文件保护 |
| src/main/index.ts | 初始化尺寸偏好、仅 Shelf 可调用的 resize / interaction IPC |
| src/preload/index.ts | 两个窄接口桥接 |
| tests/unit/collection-geometry.test.ts | 单列间距、比例、屏幕限制及锚点 |
| tests/unit/shelf-preferences.test.ts | 保存恢复、严格校验及损坏文件保全 |
| tests/integration/v2-continuous.spec.ts | 原排序、多选、贴图和清空用例适配新入口，保留原断言 |
| tests/integration/shelf-column-headless.spec.ts | 真实 Main/Preload/Renderer 离屏交互回归 |

设计和开发文档同步说明新行为；[收起](../ui/v2/shelf-column-collapsed-light.png)、[浅色展开](../ui/v2/shelf-column-expanded-light.png)、[深色展开](../ui/v2/shelf-column-expanded-dark.png)为合成截图预览。

## 数据、安全与截图边界

尺寸只写入既有 userData 下新增的 shelf-preferences.json，不改变应用身份、userData 路径、旧设置、快捷键、截图索引或凭据。拖动中的窗口预览不写盘；结束提交采用临时文件加 rename，权限 0600；损坏或未知结构保留原文件并拒绝覆盖。

resize / interaction IPC 保持主 frame 与 Shelf 角色校验，尺寸是有限整数且严格拒绝额外字段；不开放任意窗口控制。现有截图字节、输出 revision、导出目录及合并 PNG 校验保留。

同步前，原工程 277 个现存文件哈希及 5 个暂存文件的二进制 diff 均与开工快照一致。Main 的 startCapture、enqueueOutput、cleanupOverlay、registerShortcuts、setupCaptureEngine、resolveCapturedFrameImage 六个函数逐一提取 AST 源文本，前后 SHA-256 一致。CaptureOverlay、原生 Helper、输出队列与 PNG Worker 源文件未改动。本轮不重新声称或测量物理快捷键延迟。

## 验证记录

隔离副本使用相同源码和既有依赖进行验证：

- ESLint 通过。
- TypeScript 类型检查通过。
- Vitest 37 个文件 / 190 项通过，保留既有有效测试。
- electron-vite Main / Preload / Renderer 编译通过。
- 离屏收纳专项 1 项通过：单列位置、36 DIP 按钮、复制、拖动排序、按需多选、选中导出、删除、收起合并及全部导出；尺寸滑块、拖动、重启恢复；非法 IPC 与错误角色拒绝；透明背景；浅/深色截图；窄截图三按钮互不遮挡及最小窗口图堆可见。原生窗口全程不可见，剪贴板和导出选择器使用测试替身，输出使用真实合成 PNG。
- 指定工作区 pnpm build 通过，包含类型检查、三进程构建及 122 个生产依赖版本声明生成（未发现缺少许可证文件的生产依赖）。依赖中的两处 PURE 注释产生构建警告，不阻止构建。
- 指定工作区截图入口/输出隐藏回归 2 项通过：连续会话先选区后到帧、独立输出顺序、失败剪贴板重试。构建产物未修改作为测试替身，替身在临时 bootstrap 中注入。
- 尺寸边界专项首次复测遇到一次 60 秒超时及清理超时；相同源码随后原样复跑在 5.8 秒通过。未放宽阈值或跳过断言；单次超时原因尚未定位，保留此记录，不作为真机稳定性结论。

本轮没有运行可见桌面测试、真实截图压力测试、打包、签名或远程发布。真实鼠标跨显示器拖动、混合 DPI 及 Windows 原生窗口交互仍需对应平台试用；离屏模拟不能代替这些检查。

## 本地恢复

用户确认收纳区无未导出截图并允许重载后再同步。恢复快照位于忽略目录 .dev-runtime/shelf-single-column/：before-sha256.json、before-index.patch、before-worktree.patch、before-files/ 及 sync-manifest.json。只恢复 manifest 记录的本轮路径，并先比较当前文件与 afterSha256；若后来又有修改，应合并而非覆盖。新增文件仅在哈希仍一致时移出工作区。不要 reset、clean 或覆盖既有暂存内容。

原 Collection 是内存数据，退出重启仍不恢复；本轮没有增加截图持久化。尺寸偏好可以单独保留，不需要为恢复界面删除任何旧数据。
