# 收纳区点击展开与高度修复

日期：2026-10-25。

## 修复内容

- 收起的图堆：点击图片只向下展开，不进入原图预览。
- 展开列表：再点击单张图片才居中预览，关闭后返回列表；多选、拖动、复制和导出沿用原实现。
- 展开高度不再由图片数量截短：新配置默认使用当前屏幕工作区高度的 3/4，内容超出后滚动。在“设置 → 收纳区”可切换为自定义 300–1600 DIP，高度始终限制在工作区内。
- 删除浮层的临时加宽按钮；宽度只在设置调整，范围仍为 280–960 DIP。
- “4/3 屏幕高”会超出工作区，本轮按屏幕高度的 3/4 实现，已在说明与控件中明确。

## 配置与接口兼容

新增 heightMode: screen | fixed。缺少该字段的旧配置以 fixed 在内存加载，保留原有高度和选项；不会在启动时改写文件。旧 resize 接口保留并明确使用固定高度；其他 IPC、数据路径、截图逻辑和安全策略不变。新默认值只适用于新配置；已有保存尺寸可在设置选择“屏幕高度的 3/4”，也可继续使用原值。

临时加宽入口从 UI 删除；旧窄接口及状态暂保留兼容，不改变既有契约。当前 UI 不再调用该入口，专项断言顶栏不存在加宽/恢复宽度按钮。

## 文件清单

- src/shared/shelf-preferences.ts：高度模式 schema。
- src/main/storage/ShelfPreferencesStore.ts：旧配置保留固定高度，原子保存沿用。
- src/shared/collection.ts：展开视口采用配置高度，不按内容截短。
- src/main/windows/ShelfWindow.ts：传入高度模式；截图挂起/恢复路径未改。
- src/renderer/src/collection/ScreenshotShelf.tsx：先展开后预览，删除加宽按钮，按实际视口布局。
- src/renderer/src/collection/shelf.css：收起图片的展开指针语义。
- src/renderer/src/settings/ShelfSettings.tsx：高度模式、自定义高度与宽度文案。
- tests/unit/collection-geometry.test.ts、shelf-preferences.test.ts、shelf-window.test.ts：单图高度、工作区边界、默认/固定模式、旧配置无写盘加载。
- tests/integration/shelf-column-headless.spec.ts：实际 Renderer 的两步点击、按钮移除、屏幕默认高度、设置尺寸与重启恢复。
- docs/UI_DESIGN_LANGUAGE.md、TECHNICAL_DESIGN.md、DEVELOPMENT.md：更新当前行为。

## 验证

- 类型检查、Lint：通过。
- 单元测试：39 文件、206 项通过。
- 隔离 electron-vite build：通过。
- 完全隐藏的 Shelf 集成测试：通过（16.4s），包含默认 3/4 高度、设置保存宽度/自定义高度、先展开后预览、复制/导出/多选/排序/删除、取消与失败、透明边界、贴边/拉出及设置重启恢复。
- 使用临时 userData、合成图片和模拟剪贴板/对话框；没有真实屏幕或用户数据采集。
- 未改动截图入口、取帧、快捷键、编码和输出队列；沿用上轮相同输入的相关验证，不重复执行性能或真机测试。
- 原工作区 pnpm build：通过，包含类型检查、生产构建和依赖声明生成；122 个生产依赖版本，未检测到缺少许可证文件。
- Windows 与混合 DPI 仍未真机验收；3/4 以当前显示器 workArea 的 DIP 高度计算，不应用两次 DPI 缩放。

## 界面与恢复

[收起](../ui/v2/shelf-expand-collapsed-hover.png) · [展开](../ui/v2/shelf-expand-expanded-hover.png) · [深色](../ui/v2/shelf-expand-expanded-dark.png)。均为合成图，透明背景可能在 PNG 查看器中显示为黑色；键盘焦点环不是照片边框。

本地隔离及恢复目录：.dev-runtime/shelf-expand/，受 Git 忽略。before-sha256.json 和 before-index.patch 保全了本轮开始时 303 个源码文件及原有暂存内容；同步前再次比较，任何后续修改必须保留。实际覆盖文件的原始内容保存于 before-files/，同步清单记录于 sync-manifest.json。恢复时仅处理该清单，并核对当前 after 哈希；新增或后续改动不能被直接覆盖。未执行提交或推送。

用户已确认图片保存并授权重载；18 个交付文件已同步，开发版 Main 已重建并重启。未重复执行相同输入的单元/专项测试。
