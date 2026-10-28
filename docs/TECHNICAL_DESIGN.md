# V2 当前架构

## 进程与权限

Main 管理屏幕权限、截图字节、存储、剪贴板、系统对话框、全局快捷键与更新。Preload 只暴露当前功能接口；Main 同时验证调用窗口、主 frame 和参数。Renderer 的设置、Overlay、Pin、Shelf 路由复用现有黑白灰界面语言。全部受控窗口保持 sandbox、contextIsolation 和 nodeIntegration=false，拒绝任意导航和新窗口。

## 截图路径

- Quick：CaptureEngine → Overlay 框选 → 有界输出队列接管冻结帧并关闭遮罩 → Helper / Worker 编码 → clipboard.write 真正完成。不创建历史、Collection 或 Pin。
- Collect：同一引擎框选 → 同一输出队列接管并结束框选 → Helper / Worker 编码 → ScreenshotStore 临时项 → ScreenshotCollection append → 异步反馈。下一次截图不等待编码或 Shelf 动画。
- Edit：框选 → 原 ScreenshotEditor → 复制 / 原生保存 / Pin。图片编辑模型、坐标换算和预览继续复用。

CaptureEngine 优先使用 macOS ScreenCaptureKit Helper，失败按既有健康策略回退 Electron；Windows 使用 Electron。不跨屏框选，按鼠标所在显示器工作；DIP 与像素转换由既有几何层处理。

Quick/Collect 输出队列串行提交，最多 3 任务 / 估算 256 MiB（含失败项）；失败保留、显式重试或放弃，退出不持久恢复。macOS Helper 有界保留会话绑定的原始 CGImage，独立 Task 裁剪 PNG；JPEG 只作预览。Electron fallback 取 bitmap 后由独立 Worker 编码。下一次框选取消不影响已接受输出。详见[本轮实施与验收边界](v2/CAPTURE_OPTIMIZATION_REPORT.md)。

## 图片与收纳

Store 持有有界编码字节及独立保存索引；Collection 只记录稳定 ID、顺序、时间及 revision。Collection、Pin 和 Export 分别持有引用，清空或单删只释放自身引用。32 张 / 256 MiB / 单张 64 MiB 为明确边界，受保护图片不会被静默淘汰。

Collection 为本次应用运行内的数据，关闭/隐藏窗口不清空，退出或崩溃不恢复。已保存截图和旧用户数据不因 Collection 清空而删除。旧记录兼容独立于实时截图初始化。

## 窗口与反馈

启动复用设置、Overlay 和 Pin 三窗；首次 Collect 的 Overlay 可交互后才预加载 Shelf，没有额外钉图时为四个窗口；多钉图按需增加，关闭额外钉图立即销毁。Shelf 默认宽 420 DIP；收起为大图堆叠，点击图堆先展开列表。展开窗口默认占屏幕工作区高度的 3/4，也可在设置中选择固定高度；少量图片不再截短视口。图片按比例和 12 DIP 间距沿右侧单列排列，超出视口后滚动。宽度只在设置管理；展开时三个输出图标位于顶栏，收起时仍在照片悬停层；单图复制/删除保持照片悬停显示。旋转轮廓及窗口边缘统一预留渐隐空间。追加反馈仍使用 showInactive。

Pin 使用 PinnedCaptureWindows 管理独立会话，保留一个预热主窗口，额外活动窗口按需创建，最多 32 张；每张由 pin:sessionId 单独持有 Store 引用。Main 仍持有截图字节，管理器只管理窗口和会话 ID；加载失败、关闭或渲染进程退出回收对应引用。Pin IPC 按 WebContents 与主 frame 识别自身，拒绝跨钉图 ACK 和临时截图访问。新截图挂起所有活动钉图，完成/取消后 showInactive 恢复，不再关闭旧图。双击图片复用 pin:close 释放当前钉图，不删除保存文件。图片不能继续用 app-region:drag，否则 Chromium 不投递双击；改为 Pointer Capture 区分单击/双击/拖动。Renderer 每 RAF 合并移动请求，pin:move 只接受自身 sessionId 与有限坐标，Main 复核主 frame、会话、非截图状态，保留至少 32 DIP 可见区域后仅平移发送方窗口，不允许变更尺寸或操作其他窗口。会话重置/失去捕获/卸载时取消待发移动。额外窗口沿用同一 WebPreferences 和窄 Preload；焦点只阻止本次激活误开设置，不赋予任意窗口控制。原生边缘缩放保持图片比例；复制/关闭控件复用现有图标与主题。详见[编辑与多钉图修复](v2/EDITOR_PIN_FIX.md)。

居中预览复用 Shelf：Main 校验成员和来源矩形，把相对坐标转换到当前工作区，设置零透明度后扩展到工作区；Renderer 解码缩略图、发送 presentation ACK，再播放来源→中心的 340ms transform 动画；解码后的原图替换缩略图。退出反向动画 240ms，回到展开列表。Blob URL 在卸载时释放；迟到 ACK 与预览超时不能恢复过期表面。

闲置贴边沿用已有 32ms Main 命中检测，不新增后台轮询。shown → docking → docked → revealing → shown 由 presentation 校验的动画 ACK 和超时收敛；docked 原生窗口缩为右边缘 22×84 DIP，透明空白不拦截输入。沿用命中轮询检测手柄悬停即可拉出，Renderer pointer-enter 作为入口补充，重复请求幂等。应用 activate 根据手柄命中/拉出状态识别 Shelf 操作，不再要求浮层已聚焦；鼠标在其他位置激活应用仍打开设置。复制/导出、内部排序和预览持有交互状态，新截图立即取消旧动画及预览，恢复原有截图挂起路径。

截图入口先将 Shelf 置零透明度、禁用焦点和鼠标，不在首帧路径隐藏原生窗口。Shelf 从创建起就不可聚焦，主动展开和居中预览可聚焦。macOS 窗口 hide 并不保证取消整个应用的前台状态，因此 Quick/Collect 结束且设置窗口已隐藏时先 app.hide，再复用 showInactive 展示反馈/图堆；Edit/Pin 保留原焦点流程，其他平台保留原生隐藏兜底。双应用测试同时核对窗口焦点与 macOS 前台应用。已隐藏 Overlay 不重复 hide；Dock 图标只在首次设置和 Dock 恢复时更新。

收纳完成不先恢复旧 Shelf；飞入准备好后再显示。飞入用原有 Shelf 临时覆盖截图显示器、全程鼠标穿透和不聚焦；图片解码、Main presentation ACK、播放顺序明确，完成 ACK 和超时兜底共同恢复图堆。340ms 弧线飞入、300ms 卡片展开均只动画 transform/opacity。新截图用 generation/epoch/presentation 取消旧反馈。

Renderer 仅上报有界矩形命中区域，Main 在可见、非反馈状态以 32ms 间隔检查鼠标位置；列表所在右侧区域支持滚动，其余透明空白穿透；拖动排序或输出期间暂时持有鼠标事件，结束、隐藏、截图挂起或销毁时释放。IPC 校验窗口角色、主 frame、有限坐标和数量，不向 Renderer 暴露系统鼠标或任意窗口控制。单张复制复核 UUID 和 Collection 成员。缩略图缓存最多 32 项并随集合清理；原图 Blob URL 在退出预览/移除时释放。

收纳偏好独立保存在 userData/shelf-preferences.json。缺少 heightMode 的旧文件在内存采用 screen，原 width/height 保留作自定义值，启动不重写；已显式保存的 fixed 模式继续有效；新配置的 heightMode 默认为 screen，按当前工作区高度的 3/4 展开；旧 resize 请求显式切到 fixed；新配置原子写盘并保留其他设置、图片和凭据。Main 主 frame 独占 collection:configure；宽高、布尔、延迟与合并参数严格校验。原 collection:resize 的 Shelf-only 接口仍兼容保留，当前界面不再使用尺寸浮层。损坏或未知结构文件保留并拒绝覆盖。collection:interaction 只允许 Shelf 的布尔手势状态，不授予任意窗口操作。

## 原图文件拖出

展开列表的图片设为 draggable，dragstart 阻止浏览器默认导出并通过窄 IPC 通知 Main；普通拖动出文件，Alt 拖动沿用内部排序。Main 复核 Shelf 主 frame、严格 UUID/revision、展开/可交互状态和 Collection 成员，再调用 webContents.startDrag。Renderer 不提供或接收任意文件路径，图标按比例限制在 96×96 DIP。

ScreenshotDragFiles 仅在用户拖动时写入系统临时目录下随机的私有子目录，原图字节不经过 Renderer 重编码；目录/文件权限为 0700/0600（Windows 仍依赖系统 ACL）。按 ID 复用，最多 128 文件 / 256 MiB，闲置 30 分钟的文件在下一次拖动准备时清理，正常退出尝试清理本进程目录（目标仍占用时由系统临时目录机制清理）。单删/清空 Collection 不立即删除拖出文件，避免目标延迟读取失败。拒绝符号链接和非普通缓存文件；写盘或原生拖动失败保留原始截图。崩溃残留由系统临时目录清理，不扫描或删除其他应用目录。外部应用能否接受文件由目标的拖放支持决定。

## 输出和更新

合并 Canvas 位于已有 Shelf Renderer，逐张解码后释放 bitmap，最多 32 Mpx / 高 32768px / PNG 64 MiB。Main 复核 ID、revision、PNG 头与真实尺寸后复制。导出通过原生选目录，新建独立文件夹，按收纳顺序命名，失败仅回滚本次输出目录。

全部复制只接受 Shelf 主 frame 的 revision，拒绝过期、空集合和额外参数。Main 从当前集合取得有序 ID，持有来源引用至剪贴板写入完成，将未重编码的原图写入 userData/clipboard-files 私有批次目录，以一个 text/uri-list 条目提交原生多文件列表（macOS 文件引用 / Windows CF_HDROP），写入后回读数量和顺序。不能用多个图片 ClipboardItem 模拟多图文件复制。Renderer 不提供任意路径；图片不经过合并 Canvas。连续请求串行拒绝重入，失败释放本次引用、保留集合，未提交的新批次回滚；已提交批次即使回读失败也保留，避免剪贴板悬空。

缓存文件/目录使用 0600/0700（Windows 依赖系统 ACL），共限制 512 MiB。重复复制同一批未改变图片复用文件；当前剪贴板引用的批次不清理。其他批次超过 30 分钟在下一次全部复制时清理，不在启动时读取剪贴板。清空集合或退出不会删除已复制文件，保证目标延迟粘贴；复制缓存不是加密图库。目标应用必须支持原生文件粘贴；单图复制和合并复制仍使用图片格式。实现与原生验收见[全部复制修复记录](v2/SHELF_COPY_ALL_FIX.md)。

更新检查和下载保持独立，不读取账号 Cookie，不依赖旧服务器；正式安装还受包体签名、平台及显式操作约束。见[更新边界](UPDATE_CHECK.md)。

## 旧配置兼容边界

Main 只从 settings.json 读取旧截图快捷键和主题；新快捷键仍写入独立 capture-preferences.json。切换主题重新读取旧 JSON，只修改 appearance.mode，原有模型、分支、未知字段和密文保持原值。损坏的文件或无法合并的外观字段拒绝覆盖。凭据文件不被读取、迁移或删除。旧模型/日程 schema、AI 外观字段和无调用 OCR 已移除；详情见[清理记录](review/CLEANUP_REVIEW.md)。

## 已知限制

本次已优化重复原生隐藏、焦点切换和反馈交接。指标、合成测试与轻量真机结果见[透明图堆优化记录](v2/TRANSPARENT_SHELF_REPORT.md)。这些小样本不能证明超过 PixPin，也不代表 Windows、多屏/混合 DPI 或高负载验收完成；[Phase 2 报告](v2/PHASE2_CONTINUOUS_CAPTURE_REPORT.md)作为历史记录保留。
