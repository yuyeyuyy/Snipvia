# Command+1 连续截图链路审查

日期：2026-10-24。工作目录 Snipvia-public-baseline；分支 refactor/snipvia-v2，HEAD 3cf4498。针对用户实际使用的 pnpm dev、Command+1 直接复制（Quick）。本轮只审查与测量，没有改业务代码、当前开发实例、用户设置或暂存区。

## 结论

存在实际的 Main 同步阻塞，不能用上一轮的 97ms 判断连续截图已流畅。松手后，Main 还要解码整屏 JPEG、裁剪并同步编码选区 PNG，真实剪贴板写完之后才关闭截图窗。这期间下一次快捷键、IPC 和窗口操作只能排队。

无窗口算子基准中，3456×2234 JPEG 解码约 32–36ms；2400×1500 选区 PNG 编码约 301–308ms，3200×1900 约 634–835ms。此基准不创建窗口、不截图、不读写剪贴板，只证明图片算子能够长时间同步占用 Main，不代表所有真实截图耗时。

优先处理输出路径与任务调度，其次是焦点/窗口，再比较取帧方案。改收纳动画无法解决用户主要使用的 Quick 路径。

## 为什么之前测试与手感不同

| 数据 | 实际测量范围 | 缺失范围 |
| --- | --- | --- |
| 上轮 10 次合成 Collect，P95 约 97ms | 模拟 Electron desktopCapturer、纯色图、模拟 clipboard.write、生产构建预览 Renderer | DEV / 默认 SCK / 真实剪贴板 / 大选区 |
| 上轮 4 次真实 SCK | Quick/Collect 各两次、400×280 像素选区 | 剪贴板仍模拟，非连续物理 Command+1 |
| 本轮 CPU 基准 | 真实 nativeImage JPEG 解码、裁剪、PNG 编码与 Blob 拷贝 | 不含取帧、真实剪贴板、焦点或物理按键 |
| 本轮可见端到端诊断 | 有效样本为 0，已停止 | 不计为通过；未到剪贴板读写阶段 |

上轮真实 SCK 的完整画面出现约为 124、160、162、387ms；透明壳出现约为 8–42ms。97ms 不属于这条真实默认路径。代码与历史数据没有支持“只是用户用了旧 Release”或“打包就能解决”的结论。

只读进程检查确认用户正在运行固定的截然 Dev.app、Vite DEV Renderer 和常驻 Swift Helper。本轮可见诊断曾用合成画面覆盖桌面，收到反馈后已关闭全部本次测试进程，未改现有开发实例；不再运行可见自动测试。随后另行执行无窗口 CPU 基准。

## 当前链路

~~~mermaid
flowchart LR
  A[物理 Command+1] --> B[Main 快捷键回调]
  B --> C[准备透明 Overlay]
  C --> D[SCK 获取整屏 CGImage]
  D --> E[Swift 整屏 JPEG95 编码]
  E --> F[二进制传给 Main]
  F --> G[IPC / Renderer 解码显示]
  G --> H[React 更新框选]
  H --> I[松手 capture:finish]
  I --> J[Main 再解码整屏 JPEG]
  J --> K[Main crop + 同步 PNG 编码]
  K --> L[Blob / 真实剪贴板提交]
  L --> M[app.hide + Overlay.hide]
  M --> N[下一张]
~~~

下一次快捷键可以提前发生，但当前没有独立输出队列：Main 同步计算时不能处理；处理后可能直接取消上一张尚未结束的会话。

## 高优先级问题

### A. Main 同步处理大图

证据：

- [screenCaptureKitFormat](../../src/main/index.ts#L190)默认 jpeg；[Swift captureImage](../../native/screen-capture-kit-helper/main.swift#L154)完整分辨率取帧，并将 JPEG 编码结果传回。
- [SCK 接收](../../src/main/capture/screen-capture-kit-backend.ts#L237)在 jpeg 分支保留 buffer/preview，没有原图 image。
- [resolveCapturedFrameImage](../../src/main/index.ts#L338)在松手后通过 createFromBuffer 解码整屏。
- [capture:finish](../../src/main/index.ts#L902)随后 crop；[Quick handler](../../src/main/index.ts#L90)同步 toPNG，await clipboard.write 后才 cleanupOverlay。

本轮确定性合成图包含灰色条带、细节与噪声；每种选区 3 个样本，不计算小样本 P95：

| 选区像素 | JPEG 解码 | PNG 编码 |
| --- | ---: | ---: |
| 400×280 | 32.46–33.76ms | 8.83–10.27ms |
| 2400×1500 | 32.76–36.49ms | 301.06–308.17ms |
| 3200×1900 | 32.50–32.74ms | 634.01–835.39ms |

PNG 成本与内容相关，不能把此结果推广到所有画面。crop 调用本身很短，昂贵的像素计算可能在编码时发生。详细原始算子记录见[数值文件](CAPTURE_CHAIN_AUDIT_METRICS.json)。

建议：复用 Swift Helper，有界保留 session 对应的原始冻结 CGImage；Renderer 只拿预览，松手后按校验的像素矩形从同一帧裁剪输出 PNG，在独立编码执行队列完成。Main 仅校验、调度和提交剪贴板，避免大图解码/编码。

缓存必须有数量/字节上限和取消、超时、失效释放；编码不能阻塞接收下一次 capture 的串行执行器。Electron fallback 也要使用经过验证的独立图像处理单元，不能假定 nativeImage 可以直接放到普通 worker_threads。

验收：复杂大选区输出期间 Main 仍及时响应；最终尺寸、原色和像素来自同一冻结帧；没有为了降低耗时牺牲分辨率或画质。

### B. 框选与复制生命周期绑定，缺少输出排序契约

[Quick handler](../../src/main/index.ts#L90)直到剪贴板完成才关闭截图窗。[startCapture](../../src/main/index.ts#L467)对活跃会话执行取消；[CaptureModeRouter.begin](../../src/main/capture/CaptureModeRouter.ts#L7)abort 上一会话。已经发起的 clipboard.write 不接收 AbortSignal，因此业务取消不等于撤销底层写入。

当前缺少应用级提交队列和明确的完成顺序。旧任务覆盖新任务是需验证的风险，本轮没有复现，不能写成已发生。

建议：分离“框选会话”和“有界复制任务”。松手后冻结数据、迅速结束交互，异步编码；剪贴板有明确提交顺序，旧任务不能在较新任务之后覆盖。取消新框选不能抹掉上一张已经确认的输出；失败保留重试数据并提示，队列满时明确处理，不能无限堆内存。

显示复制成功仍要等待真实写入完成。[Electron 44 clipboard.write](https://www.electronjs.org/docs/latest/api/clipboard#clipboardwritedata)的 Promise 完成才表示系统提交，不能把调用开始当作成功。

验收：上一张编码/写入时可框选下一张，最终剪贴板为最后一张；失败、取消、队列满、退出均有确定行为。

### C. 计时盲区导致低估真实等待

- [hotkey_pressed](../../src/main/index.ts#L452)在 Main 回调进入后才记录，看不到物理按键在 Main 忙时的排队；硬件信息采集还发生在该计时前。
- [capture_finish_main_received](../../src/main/index.ts#L902)晚于 JPEG 解码，解码被混入所谓 IPC 耗时。
- [performance:mark](../../src/main/index.ts#L759)只有事件名等参数；[Recorder](../../src/main/performance/screenshot-performance.ts#L127)使用 Main 收到消息时的时间，不是 Renderer 原始事件发生时间。
- clipboard_committed 不包含随后 app.hide、Overlay.hide 和 Dock 恢复；没有完整“可接下一张”指标。
- [合成测试](../../tests/integration/v2-continuous.spec.ts#L7)模拟取帧、剪贴板，通常等待完成再下一张，未覆盖大图与快速重叠输入。

建议：分别记录按键发出/回调进入、壳/像素可见、可交互、松手、finish 进入、解码、PNG、剪贴板开始/提交、窗口退出和下一张响应。跨进程校准时钟，并记录事件循环阻塞。实际按键排队应由用户主动参与测量，不能把直接调用 startCapture 标成已验真实热键。

验收矩阵需区分 DEV/构建预览、真实 SCK/fallback、真实/模拟剪贴板、小/大/复杂图、常规/快速连续节奏，报告实际样本数。

## 中优先级问题

| 问题与证据 | 建议与验证 |
| --- | --- |
| [cleanupOverlay](../../src/main/index.ts#L397)对 Quick/Collect 都 app.hide，再 Overlay.hide、Shelf.resume、restoreDock；下一张重新 show/focus | 单独明确 Quick 的焦点退出语义，避免连带隐藏不相关 Pin/图堆，缓存未变 bounds/level。现有焦点回归证明不能简单删 app.hide；这项具体耗时未重新测量 |
| [Swift](../../native/screen-capture-kit-helper/main.swift#L134)已常驻 Helper、缓存 shareableContent；但每张新建 filter/config 并调用单帧 captureImage，再 JPEG95 编码整屏 | 先核对缓存与冻结帧契约，再优化取帧。若仍是主因，比较仅连续操作期间短时保留 SCStream，空闲即释放；不是默认后台持续录屏 |
| [SCK](../../src/main/capture/screen-capture-kit-backend.ts#L203)默认 500ms 请求超时，失败后 [CaptureEngine](../../src/main/capture/capture-engine.ts#L68)再 fallback | 记录失败/回退原因和耗时；不把缺乏证据的 fallback 当成当前用户主因；检验取消及故障恢复，不先盲目缩短超时 |
| [readiness](../../src/main/capture/capture-readiness.ts#L35)仍对已隐藏设置窗 hide；默认 hide-event-16 | 优化冗余调用并保持自排除像素证据。16ms barrier 只属于 Electron fallback；元数据 200ms 不等于默认 SCK 每张固定等待 |
| [pointermove](../../src/renderer/src/capture/CaptureOverlay.tsx#L159)每次 setState；[选区样式](../../src/renderer/src/capture/capture-window.css#L13)重绘整屏背景、尺寸和大阴影 | 坐标 ref + 每 RAF 最多一次可视更新，pointerup 始终取最终坐标；先测绘制帧，不假定改曲线能治卡顿 |
| [processMemorySnapshot](../../src/main/index.ts#L220)每张调用三次 getAppMetrics；[Renderer](../../src/renderer/src/capture/CaptureOverlay.tsx#L76)及 Blob 有额外拷贝 | 指标按诊断开关/低频采样，缓存静态硬件信息。无窗口单次 getAppMetrics 仅约 0.20–0.28ms，不能据此夸大为主因；拷贝也次于 PNG |

app.hide 是隐藏全部应用窗口，不能当作只关闭 Overlay。[Electron 说明](https://www.electronjs.org/docs/latest/api/app#apphide-macos)。[Apple 单帧 API](https://developer.apple.com/documentation/screencapturekit/scscreenshotmanager/captureimage(contentfilter:configuration:completionhandler:))与[SCStream frame interval](https://developer.apple.com/documentation/screencapturekit/scstreamconfiguration/minimumframeinterval)确认可试验不同捕获方式，不保证持续流一定更快。必须比较冷/热启动、帧新鲜度、CPU/内存、录屏指示与隐私边界。

## 可以排除的误判

- Quick 本身不创建 Collection；从未收纳时 Shelf 尚未创建，图堆 340ms 飞入不是此时的 Quick 阻塞。
- 未发现截图等待账号、模型或网络的代码。
- 没有每张固定 sleep 200ms，默认 native 路径不走该 barrier。
- Helper 已常驻，不是每张创建 Swift 进程。
- 打包可能减少开发开销，但不会消除 Main 同步 PNG 编码。
- 默认 JPEG95 已是有损中间帧，转 PNG 不会恢复原始细节。不能继续靠降质量换速度；预览与原图输出需要分开。

## 推荐实施顺序

| 阶段 | 文件与任务 | 验收门槛 |
| --- | --- | --- |
| A 修正计时 | Main、shared/performance、Recorder；Quick 分段、退出、队列和事件循环指标；默认关闭重型采样 | 真实日志可解释手感，只含数值，不含截图/敏感内容 |
| B 输出解耦 | Main Quick、CaptureModeRouter、输出任务/有界提交队列 | 连续框选不丢前一张；复制顺序与失败恢复正确 |
| C 原图与编码 | Swift Helper、SCK bridge/types、Main 输出 | 同一冻结帧无损裁剪，Main 不同步大图编码；像素/DPI/内存边界有证据 |
| D 窗口与 fallback | Overlay/Shelf、cleanup、readiness | 原应用焦点、快速连续、Pin/图堆、自排除同时通过 |
| E 有条件取帧试验 | A–D 后仍需要时才比较短时 SCStream | 实际节奏有收益，空闲 CPU、帧新鲜度与隐私边界均合格 |

不建议先全面替换 Electron UI、加复杂多版本架构、降低输出分辨率或默认常驻录屏。本轮没有实施这些重构。

## 保全与验证边界

业务代码与上一轮最终 9 个生产文件指纹一致，暂存区保持原样。新增本报告、数值文件，以及 Git 忽略的 .dev-runtime/capture-chain-audit 本机诊断材料；原有大量清理改动没有被覆盖。

未改旧仓库、用户数据、录屏权限、签名、应用身份、远程、发布或生产服务。未重复跑 lint/typecheck/构建/全量单测；没有业务修改，也未将原通过结果扩展到本轮未测场景。

可见端到端诊断有效样本为 0；真实系统剪贴板耗时、物理快捷键排队以及本轮真实连续输入尚未测得。CPU 算子基准和源码因果关系足以确定首要优化方向，但不应声称已经复现并解决用户全部卡顿。
