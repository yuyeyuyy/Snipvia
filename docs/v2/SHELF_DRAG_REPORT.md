# 收纳区顶栏输出、原图拖出与悬停拉出

日期：2026-10-25。基于 refactor/snipvia-v2 / 3cf4498 的实际未提交工作区，未提交或推送。

## 完成内容

- 展开列表的全部复制、合并复制、导出 PNG 放到顶栏，与多选、收起、隐藏并排；收起时仍在照片悬停层。保留小型半透明图标与成功一秒对号。
- 展开窗口默认是当前屏幕 workArea 高度的 3/4，图片少也不缩短。缺少 heightMode 的旧宽高文件在内存采用 screen，旧高度数值仍保留为自定义值；已显式保存的 fixed 模式不变。解决旧 300px 高度继续限制新列表的问题，不改写原文件。
- 普通拖动照片启动原图文件拖出；Alt 拖动与 Alt+方向键用于内部排序，避免同一个手势同时排序和拖出。拖动完成不误触发图片预览。
- 悬停边缘手柄即可拉出，点击与键盘入口保留；重复拉出请求幂等。
- 修复拉出时打开设置：Shelf 手柄是非聚焦表面，activate 判断改为实际命中位置与拉出状态，取消“必须先聚焦”的错误前提；鼠标在其他位置激活应用仍能打开设置。
- 收起时重置旧滚动偏移，防止照片上的悬浮输出按钮错位。

## 原生拖放及隐私边界

按 [Electron 原生文件拖放接口](https://www.electronjs.org/docs/latest/tutorial/native-file-drag-drop/)：Renderer 的 dragstart 经 Preload 通知 Main，Main 调用 webContents.startDrag。原图作为普通 PNG/JPEG 文件交给操作系统；目标需支持文件拖放，普通纯文本输入框不因此获得图片接收能力。

Main 严格校验 Shelf 主 frame、UUID/revision、集合成员及展开/可交互状态；Renderer 不能提供任意路径。原图字节只在用户开始拖动时写入系统临时目录中的随机私有子目录，不重新编码截图，也不写入保存图库或历史。图标单独按比例限制在 96×96 DIP。默认 128 项 / 256 MiB；同图复用，闲置 30 分钟的文件在下一次拖出准备时清理，正常退出尝试清理本进程目录（目标仍占用时由系统临时目录机制清理）。拒绝缓存符号链接、非普通文件和大小不符；异常保留原始截图。清空 Collection 不立即删拖放文件，避免目标延迟读取失败。

目录/文件使用 0700/0600（Windows 实际仍由系统 ACL 控制）。崩溃后可能留下临时图片，由系统临时目录机制清理；没有扫描或删除其他应用目录。拖放不是加密或持久图库，也没有新增上传行为。详见 [隐私边界](../PRIVACY.md)。

## 文件记录

| 文件 | 变化 |
| --- | --- |
| src/main/storage/ScreenshotDragFiles.ts | 新增有界私有临时文件、复用、过期清理与退出释放 |
| src/main/index.ts | 新拖放 IPC 验证、原生拖放、图标边界及服务生命周期 |
| src/main/windows/ShelfWindow.ts | 非聚焦命中、悬停拉出和重复请求保护 |
| src/main/storage/ShelfPreferencesStore.ts | 旧文件采用 screen 默认，保留数值与显式模式 |
| src/shared/collection.ts、src/preload/index.ts | 只增加 UUID/revision 的窄拖放接口 |
| src/renderer/src/collection/ScreenshotShelf.tsx | 顶栏输出、原生 dragstart、Alt 排序、点击抑制与滚动复位 |
| src/renderer/src/collection/shelf.css | 展开顶栏可见，窄宽度/多选时避免控件重叠 |
| tests/unit/screenshot-drag-files.test.ts | 原图字节、权限、复用、容量、过期、符号链接、写盘失败、JPEG 和清理 |
| tests/unit/shelf-window.test.ts | 手柄不聚焦时的激活、悬停拉出及重复请求 |
| tests/unit/shelf-preferences.test.ts | 旧无模式文件采用默认；显式自定义仍保留 |
| tests/integration/shelf-column-headless.spec.ts | 顶栏布局、自然鼠标拖动至 Main 契约、原图哈希、角色/路径/revision 拒绝、最窄宽度、焦点及悬停拉出 |
| tests/integration/v2-continuous.spec.ts、transparent-shelf.spec.ts | 适配 Alt 排序与顶栏输出；旧有效断言保留 |
| docs/UI_DESIGN_LANGUAGE.md、TECHNICAL_DESIGN.md、DEVELOPMENT.md、PRIVACY.md、PRD.md | 当前交互、临时文件和兼容说明 |

截图入口、快捷键、取帧、编码与输出队列未改。startCapture、enqueueOutput、cleanupOverlay、registerShortcuts、setupCaptureEngine、resolveCapturedFrameImage 的函数文本 SHA256 与本轮开始一致；CaptureOverlay、CaptureEngine、原生 Helper 和 PNG Worker 文件保持不变。未新增依赖或原生窗口。

## 验证与未验范围

- 类型检查、Lint：通过。
- 单元测试：40 个文件、214 项通过。核心单测结果复用到相同 Main/存储/配置输入；后续滚动复位由真实 Renderer 专项覆盖。
- 隔离生产编译：通过。
- Shelf 隐藏 Electron 专项：最终通过（12.9s），使用临时 userData、合成图片、模拟剪贴板/对话框和原生 startDrag 接收端，实际操作系统窗口始终隐藏。
- 自然 CDP 鼠标按下/移动/松手触发浏览器 dragstart，成功到达 Main；比对拖出临时文件与 ScreenshotStore 原图 SHA256，图标尺寸不超过 96，退出后临时文件消失。操作不移动用户的 OS 鼠标，不执行真实 Finder/文件管理器投递。
- activate 事件的真实 Main 路径验证：手柄命中/拉出时设置 show 次数为 0，鼠标在其他位置激活仍为 1。
- 同一专项保留单图复制、成功对号、排序、多选、全部独立原图复制、合并/导出、失败/取消、居中预览、默认/自定义高度、设置保存/重启、透明边界与确认清空；最窄 280 DIP 多选顶栏不重叠。
- 补充自然手势后暴露旧测试在展开动画中程序点击屏外图片的时序，现改为等待动画、滚动到可见再预览，不删除或放宽断言。
- 原工作区最终 pnpm lint / pnpm build：通过；包含类型检查和依赖声明生成（122 个生产依赖版本，0 个缺少许可证文件）。23 个交付文件已同步，固定开发应用已自动重载并确认运行。
- 未执行真实 Finder/Windows 文件管理器、第三方聊天/附件输入框投递，未验证 Windows、混合 DPI 或长时间磁盘文件锁。原生接收契约通过不能冒充跨应用验收。目标接收和取消行为仍需真实桌面样本。

## 界面及恢复

[收起](../ui/v2/shelf-drag-collapsed-hover.png) · [展开 Light](../ui/v2/shelf-drag-expanded-hover.png) · [展开 Dark](../ui/v2/shelf-drag-expanded-dark.png)。均为合成图片，背景 Alpha 为 0；焦点环为键盘无障碍状态，不是照片边框。

隔离与本地恢复目录：.dev-runtime/shelf-drag/（Git 忽略）。before-sha256.json 保全 307 个开始时源码文件，before-index.patch 和 before-worktree.patch 保全已暂存及未暂存差异。同步前核验哈希；before-files/ 保存覆盖前文件，sync-manifest.json 记录 before/after，恢复只按清单且先核对当前 after 哈希，遇到后续改动先另行保全。原有五个暂存文件保持不变；不使用 reset、clean 或强制覆盖。用户已授权本会话以后自动重载开发版。

退出清理增加有界重试与异常保护后，相关拖放单测 5 项在原工作区再次通过；没有重复执行与该变化无关的全套回归。
