# 收纳区照片布局、居中预览与自动贴边验收

日期：2026-10-25。开发基线：refactor/snipvia-v2，HEAD 3cf4498404d769ef6bcf75a1269b67dcb036f8e6。本轮仅修改收纳 UI、窗口编排、对应偏好和测试，未提交、推送、打包或发布。

## 实际行为

| 需求 | 当前实现 |
| --- | --- |
| 收起图片过小 | 去掉侧栏与固定空行；最近五张照片按比例充分使用宽度，允许预览放大小尺寸源图 |
| 体积小、透明的悬停按钮 | 照片底部三个 28 DIP 图标；展开时单图左上复制、右上删除也仅悬停或键盘聚焦显示；保留 title、aria-label 和焦点环 |
| 去掉左下角按钮 | 移除尺寸拖柄、三点菜单及尺寸浮层 |
| 展开后向下延展 | 单列按各图真实比例布局，常规间距 12 DIP；高度随内容增加到设置上限，之后滚动；顶栏加宽不改变保存值 |
| 图片居中放大 | 点击照片后，现有 Shelf 原生窗口扩到当前工作区，以 340ms 动画放大到中心；原图解码后替换缩略图；再点图片、空白或 Esc 以 240ms 返回 |
| 闲置自动贴边 | 默认离开 1800ms 后向右收起，只保留原生 22×84 DIP 窗口中的小手柄；点击拉出；可关闭自动收起或调整等待时间 |
| 尺寸管理进入设置 | 设置 → 收纳区提供宽度、高度上限、自动收起、等待时间、合并参数与确认清空，沿用现有分组行 |

全部复制仍为独立原图，一次提交整个 Collection；多选只影响合并和导出。复制、导出成功后显示一秒对号，取消不显示成功，错误保留明确提示。拖动排序、Alt+方向键、多选、原贴图以及确认清空保留。

## 模块与文件

| 文件 | 变化 |
| --- | --- |
| src/shared/collection.ts | 按比例布局、内容高度、居中/贴边几何，新增状态与窄接口；保留原尺寸与输出接口 |
| src/shared/shelf-preferences.ts | 兼容宽高配置，新增贴边及合并参数的严格 schema |
| src/main/storage/ShelfPreferencesStore.ts | 内存补全旧配置、原子保存、损坏/未知文件拒绝覆盖 |
| src/main/windows/ShelfWindow.ts | 复用单窗的预览、贴边状态机；presentation ACK、超时和新截图取消；输出/拖动期间保持交互 |
| src/main/index.ts | 新窄 IPC 的角色和参数校验；复用有界缩略图生成；配置变更通知设置页 |
| src/preload/index.ts | 仅转发相应窄接口 |
| src/renderer/src/collection/ScreenshotShelf.tsx | 照片布局、悬停操作、动态排序与输出交互保持 |
| src/renderer/src/collection/ShelfPreview.tsx | 新增中心预览，解码后显示、可中断动画和 Blob URL 清理 |
| src/renderer/src/collection/shelf.css | 小型半透明图标、透明边缘、照片尺寸、居中场景与边缘手柄 |
| src/renderer/src/settings/ShelfSettings.tsx | 新增分组偏好，整数范围校验，原生确认清空 |
| src/renderer/src/settings/SettingsPanel.tsx | 接入收纳设置 |
| src/renderer/src/settings/v2-settings.css | 复用语义 Token 的数值输入样式 |
| src/renderer/src/components/AppShell.tsx | 设置导航新增收纳区 |
| src/renderer/src/components/Icon.tsx | 复用图标体系补充加宽和定住矢量 |
| tests/unit/collection-geometry.test.ts | 更新动态高度期望，覆盖比例、旋转边缘、小图、工作区及贴边 |
| tests/unit/shelf-preferences.test.ts | 补充旧尺寸无写盘加载、新参数保存与未知字段保护 |
| tests/unit/shelf-window.test.ts | 六项状态测试：空闲、交互保持、迟到 ACK、预览恢复、截图取消、挂起期间关闭贴边 |
| tests/integration/shelf-column-headless.spec.ts | 更新原操作/输出断言，并增加居中动画、贴边、设置重启和透明边缘 |
| tests/integration/v2-continuous.spec.ts | 按中心预览与设置入口适配旧测试，保留排序、Pin 引用和清空取消断言 |
| tests/integration/transparent-shelf.spec.ts | 按动态高度与中心预览更新期望，保留 alpha、焦点和命中测试 |
| tests/integration/capture-opacity-real.spec.ts | 明确关闭自动贴边以隔离原有零透明度截图测试；仍为显式 opt-in |
| docs/UI_DESIGN_LANGUAGE.md、docs/TECHNICAL_DESIGN.md、docs/DEVELOPMENT.md | 同步当前交互、窗口状态与偏好边界 |

未新增依赖、窗口种类或页面壳。六个 Main 关键函数 startCapture、enqueueOutput、cleanupOverlay、registerShortcuts、setupCaptureEngine、resolveCapturedFrameImage 的函数文本 SHA256 与本轮修改前一致；CaptureOverlay、CaptureEngine、原生 Helper、PNG Worker 和输出队列文件也未改动。

## 验证记录

- Node 24.15.0，pnpm 11.1.3。
- pnpm lint：通过。
- pnpm typecheck：通过。
- pnpm test：39 个文件、203 项通过。
- electron-vite build：隔离副本通过。
- pnpm build：同步后的原工作区完整通过，包含类型检查和依赖声明生成；122 个生产依赖版本，未检测到缺少许可证文件。
- capture-entry-headless：通过，延迟取帧时仍可先框选及进入下一次截图。
- capture-output-headless：通过，输出脱离框选、保持顺序，剪贴板失败可重试且不重新取帧。
- shelf-column-headless：最终通过（15.3s）。覆盖 8 张图、12 DIP 间距、独立原图复制顺序/字节、单图复制/删除/排序、多选导出、合并、取消与失败、IPC 拒绝、设置保存、重启恢复、中心预览及 340ms 动画、22×84 DIP 贴边、拉出、细长图和清空取消/确认。
- 全部上述专项使用临时 userData、合成图片、模拟剪贴板/对话框、禁用全局快捷键并强制隐藏原生窗口；没有持久化真实屏幕截图或操作真实剪贴板。
- 离屏照片/预览 PNG 的四边 Alpha 最大值为 0；边缘手柄按设计贴右侧，不适用四边透明断言。
- 曾有一次合并回归串行执行到离屏重启退出时超时；改回合成指针/焦点输入后的专项完整退出并重新启动通过。未放宽超时或删除断言；离屏 Chromium hover 输入的退出稳定性仍是测试环境限制，不能据此证明真实应用存在/不存在退出问题。

未运行可见窗口的全套 smoke、真实录屏、Windows、多显示器/混合 DPI 或跨应用多图粘贴验收；旧专项只做接口适配，不宣称执行通过。没有重新做已验证的截图性能真机计时，不能把本轮结果当成端到端性能结论。

## 兼容与安全

app.getPath('userData')、App ID、Bundle ID、快捷键及原 settings.json 均保持原值。旧 shelf-preferences.json 的 width/height 在内存补默认参数，启动不改文件；首次显式修改偏好才原子写入完整格式。损坏/未知字段文件保留并拒绝覆盖。未读取/迁移凭据、旧记录或已保存截图。

新 IPC 继续验证窗口角色、主 frame、UUID、有限来源矩形和 presentation；设置写入限定 Main 设置窗，预览/动画/拉出限定 Shelf。sandbox、contextIsolation、文件和网络边界保持原实现。预览复用单窗，不增加屏幕采集内容；下一次截图取消预览和迟到 ACK。Collection 仍只保存在本次运行，退出/重载不恢复，清空仍需确认。

## 截图

下列均为合成内容；黑色区域在 PNG 中实际透明。悬停图用键盘聚焦配合合成指针触发，焦点环为无障碍状态，并非照片边框。

- [收起闲置](../ui/v2/shelf-edge-collapsed-idle.png)
- [收起悬停](../ui/v2/shelf-edge-collapsed-hover.png)
- [展开 Light](../ui/v2/shelf-edge-expanded-hover.png)
- [展开 Dark](../ui/v2/shelf-edge-expanded-dark.png)
- [中心预览](../ui/v2/shelf-edge-centered-preview.png)
- [边缘手柄](../ui/v2/shelf-edge-edge-tab.png)

## 工作区保护与恢复

同步前重新核验原工作区 293 个文件及 Git 暂存补丁未发生变化。已有清理改动与五个暂存文件保持不变，不执行 reset、clean 或重新暂存。用户已确认截图保存并允许重载。

本地保护目录为 .dev-runtime/shelf-edge/（Git 忽略）：before-sha256.json、before-index.patch、before-worktree.patch、before-files/ 和 sync-manifest.json。before-files 保存本轮覆盖文件的工作区原始内容，sync-manifest 记录修改前后哈希和新增文件；只按这份清单恢复，先核对当前文件仍等于对应 after 哈希，若有后续改动先单独保全，不能直接覆盖。新增文件也只有在哈希一致时才能移出工作区。原有未提交功能不以 HEAD 覆盖。

若已保存新版收纳设置后需要回到旧代码，先保全 shelf-preferences.json 原文件，再在应用退出状态按已验证的 width/height 生成旧格式副本；不要删除原配置或用户截图。普通回滚本轮界面无需改动其他用户数据。
