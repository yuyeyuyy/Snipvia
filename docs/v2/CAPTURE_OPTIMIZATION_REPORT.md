# 连续截图链路优化实施记录

日期：2026-10-24。工作目录 Snipvia-public-baseline；分支 refactor/snipvia-v2，基于 HEAD 3cf4498 和此前未提交的清理、透明图堆改动继续实施。主要场景是用户的 pnpm dev、Command+1 直接复制。

## 本轮结果与边界

按[链路审查](CAPTURE_CHAIN_AUDIT.md)的 A→D 顺序实施：校准计时，分离框选/输出生命周期，移出 Main 的裁剪编码，减少重复窗口与指针绘制操作。Quick/Collect 输出来自同一冻结帧，不降低最终尺寸或画质。Edit/Pin 原有编辑输出路径保持现有逻辑，并未承诺本轮已消除其全部同步图片计算。

已验证的是任务所有权、提交顺序、失败恢复、原图裁剪和 Worker 像素一致性；**尚未验证真实物理快捷键到系统粘贴的完整耗时**。没有把合成测试或隐藏窗口测试当作真实 SCK、系统剪贴板或 macOS 焦点验收。本轮不再运行可见测试画面，不读取真实屏幕或剪贴板，不改权限/用户数据，不打包或推送。

## A：计时与诊断

- Main 入口先记录请求时间，静态设备信息只在启动时采集；finish 到达时立即打点，先于图片处理。
- Preload 为 Renderer 事件附带 timeOrigin + now，Main 校验来源时间范围并保留接收时间。不将 Main 回调进入等同于物理按键发出。
- 新增排队、编码、系统剪贴板开始/完成、输出失败及遮罩关闭事件；可以分开查看“框选结束到关闭”和“真正复制完成”。
- 每次截图的进程内存采样只在显式诊断下启用；同开关记录事件循环最大延迟。默认不开启重型采样。
- SNIPVIA_PERF=1 输出数值汇总，trace 输出分段数值。日志不附截图或剪贴板正文；物理按键队列等待仍需用户参与测量。

## B：框选与输出解耦

松手后，Main 校验矩形并接受有界任务，转移原始帧所有权，关闭 Overlay，再结束框选会话。独立输出队列不会被下一次 startCapture 或 Esc 取消。

- 单队列串行处理 Quick/Collect，按接受顺序提交。显式重试视为新的请求，排在已经接受的任务之后。
- 最多 3 个任务，估算占用最多 256 MiB；运行、等待和失败任务都计入。高分辨率场景可能先触及字节上限。此为任务预算，**不是整个 Electron/Helper 的 RSS 上限**。
- 满载时拒绝新的输出并保留当前框选可重试，不静默覆盖旧任务。
- 编码成功后立即释放原始帧；复制失败保留编码后的 PNG。菜单提供“重试失败输出”和需确认的“放弃失败输出”，托盘提示待处理/失败状态。
- 真正 clipboard.write 完成后才标记成功。退出停止队列；更新安装要求先处理运行中/失败任务。
- 队列和失败缓存仅本次运行有效，退出/崩溃不会持久恢复。若 Helper 在编码前崩溃，原始帧失效，需要重新截图；不宣称可跨进程崩溃恢复。

## C：同帧原图与后台编码

macOS SCK 将冻结 CGImage 留在 Helper 内存，Main 仅保有会话绑定 token 和 JPEG 预览。Quick/Collect 请求裁剪时，Helper 在独立 Task.detached 中从该 CGImage 生成 PNG，不占用 CaptureService actor。预览 JPEG 不作为最终输出的像素来源。

缓存上限为 4 帧、估算原始像素 256 MiB、单帧 128 MiB，显式释放且幂等。矩形、session/token、返回 PNG 格式/尺寸/64 MiB 上限均校验。取消、晚到响应和无效响应释放未接管 token；缓存满属于背压，当前取帧走 fallback，不重启 Helper 或使已有原图失效。旧 Helper 不支持新能力时走既有 Electron fallback，不能悄悄把有损预览冒充原始输出。

Windows/Electron fallback 由 Main 获取 bitmap，交给 Node Worker 进行裁剪、BGRA/Alpha 转换、PNG 过滤与压缩。Worker 不加载 Electron，不尝试在普通 Worker 中使用 nativeImage。全图 bitmap 拷贝及系统剪贴板调用仍在 Main，其实际成本尚需真机观察。

原生显示器描述、filter/config 缓存复用；拓扑变化、显式 refresh/invalidate 时失效。没有新增持续 SCStream 或后台录屏。

## D：窗口与指针更新

已隐藏设置窗不重复 hide；Overlay bounds 未变化不重复设置，置顶等级沿用创建时设置，只有未聚焦时才 focus。保留 macOS app.hide 的既有焦点退出语义，不凭推测移除。

框选指针坐标用 ref，pointermove 每 RAF 最多更新一次可视选区；pointerup 直接计算最终坐标，不依赖可能落后一帧的 React state。保持现有黑白灰样式、透明图堆与收纳曲线。

原应用焦点、快速真实连按、Pin/图堆自排除、混合 DPI、Windows 真机属于本轮未执行的手工门槛。没有将历史透明图堆测试结果扩展为本轮已验结论。

## 文件级修改

| 文件 | 本轮职责 |
| --- | --- |
| src/main/index.ts | 接受输出任务、原图所有权、菜单重试/放弃、计时与更新退出边界 |
| src/main/capture/CaptureOutputQueue.ts（新增） | 有界串行队列与失败缓存 |
| src/main/capture/CaptureModeRouter.ts | detach 框选，不取消已确认输出 |
| src/main/capture/CapturePngEncoder.ts、capture-png-worker.ts、encode-bgra-png.ts（新增） | fallback 图片处理与 Worker 生命周期 |
| native/screen-capture-kit-helper/FrozenFrameCache.swift（新增）、main.swift | 冻结原始帧、异步 PNG、显示器配置缓存 |
| src/main/capture/screen-capture-kit-backend.ts、types.ts | 会话绑定原图契约、校验、取消和释放 |
| src/main/capture/capture-readiness.ts、src/main/windows/capture-overlay-window.ts | 减少重复窗口系统调用 |
| src/renderer/src/capture/CaptureOverlay.tsx | RAF 合并绘制，最终坐标即时计算 |
| src/shared/performance.ts、src/main/performance/screenshot-performance.ts、src/preload/index.ts | 跨进程来源时间与分段记录 |
| electron.vite.config.ts | 独立 Worker 构建入口 |
| scripts/build-native-helper.sh | 编译新增 Swift 源码；工具链默认沿用 xcode-select |
| scripts/prepare-release-build.mjs、verify-windows-build.mjs | 缓存指纹与安装包检查包含新增原生源/Worker |
| tests/unit/capture-output-queue.test.ts、encode-bgra-png.test.ts、screen-capture-kit-output.test.ts（新增）、performance.test.ts | 排序/资源、像素/边界、原生协议、来源计时 |
| tests/native/frozen-frame-cache.swift（新增） | 真实 CoreGraphics 裁剪像素/缓存边界 |
| tests/integration/capture-output-headless.spec.ts、capture-png-worker.spec.ts（新增） | 隐藏真实 Main 接线、无窗口实际 Worker |
| tests/integration/v2-continuous.spec.ts | 复制失败改为独立任务重试断言，保留既有有效断言 |
| docs/TECHNICAL_DESIGN.md、DEVELOPMENT.md、UI_DESIGN_LANGUAGE.md、本记录和数值文件 | 更新实际路径、运行与验收边界 |

没有增加依赖、改锁文件、应用身份、用户数据目录、快捷键配置、更新服务或移除安全隔离。

## 验证记录

| 检查 | 本轮结果及范围 |
| --- | --- |
| lint / typecheck | 实际工作区通过；pnpm build 包含独立 pnpm typecheck，均成功 |
| pnpm test | 33 文件、179 测试通过；既有测试未删/跳过 |
| electron-vite build | Main/Preload/Renderer 编译通过，存在独立 capture-png-worker.js |
| 原生构建 | Universal arm64/x86_64 Helper 编译通过 |
| Swift 缓存测试 | CoreGraphics 已知像素裁剪、尺寸、错误 session、边界、容量与幂等释放通过 |
| 隐藏 Main 集成 | 真实 Main 接受两个重叠输出、顺序提交、失败后复用 PNG 重试、释放原图；所有窗口不可见；真实截屏/剪贴板/快捷键均替换为测试输入 |
| 无窗口 Worker 集成 | 2400×1500 确定性复杂图，真实 NativeImage 往返后字节相同；Main 编码等待期间定时器继续执行 |
| 可见/真机验收 | 本轮未运行；物理 Command+1、真实 SCK、系统剪贴板、前台焦点、混合 DPI 和 Windows 未新增通过结论 |

隔离副本两次 Worker 样本编码等待约 558/543ms，最终实际工作区约 577ms；Main 定时器最大额外延迟分别约 1.11/0.91/1.37ms，均未创建窗口。这证明编码期间 Main 有响应，**不证明端到端复制仅需 1ms**。与上轮 CPU 基准图内容不同，不能将总耗时直接比较成速度提升比例。原始数值见[机器记录](CAPTURE_OPTIMIZATION_METRICS.json)。

隔离副本使用现有 node_modules 的符号链接，完整 pnpm build 的 notices 生成器按路径安全约束拒绝跨副本依赖；编译已成功。这是隔离验证路径限制，未放宽安全检查，收尾须在真实工作区执行完整构建。

## 试用与下一门槛

原有 pnpm dev 若仍运行旧 Main/Helper，退出当前开发实例后重新 pnpm dev 即可；新 Helper 已在本地构建并同步。不需要重新授权录屏，也不改变固定开发应用包。可选诊断：

~~~sh
SNIPVIA_PERF=1 pnpm dev
~~~

只需按原习惯用 Command+1，先截小区域，再截大文本/复杂画面并连续操作；确认每张可继续框选、最终粘贴为最后接受的一张。收纳与编辑各做一次，确认焦点及图堆正常。记录卡顿在“按键后等待画面”还是“松手后等待复制”，不再重复展示合成测试桌面。

只有 A–D 在真实节奏下仍显示取帧主导，才进入 E：对比短时 SCStream 与单帧方案，测冷/热响应、帧新鲜度、资源和权限表现；本轮不自动启用持续捕获。

## 保全与回滚

当前大规模未提交清理和用户暂存项全部保留。任务开始保存 SHA256、工作区/暂存区补丁；同步前再保留本轮涉及文件的原始完整副本与旧 Helper。材料均位于 Git 忽略目录 .dev-runtime/capture-optimization/，不提交截图、用户数据或凭据。

回滚只针对 sync-manifest.json 列出的本轮文件：先退出开发实例，核对目标文件仍等于 manifest 的同步后哈希，再从 before-files/ 恢复 existed=true 的文件；existed=false 的新增文件经确认无后续修改后才移除。旧二进制从 before-files/build/native/ 恢复。**不要使用 reset --hard、clean 或整仓库 checkout**，否则会丢失本轮之前的清理与未跟踪成果。若已再次改动，应逐文件合并，不能强制覆盖。暂存区补丁用于核对，不自动重放。

### 最终工作区收尾

- 实际工作区 pnpm lint 通过；pnpm test 为 33 文件 / 179 测试通过。
- pnpm build 完整通过，包含 pnpm typecheck、Main/Preload/Renderer/Worker 构建和依赖声明生成；122 个生产依赖版本，缺许可证文件数为 0。Zod 的 Rollup 注释提示不影响构建。
- 最终工作区两项隐藏/无窗口 Electron 集成测试均通过（7.2s）。Worker 最终样本仍逐字节保真，无窗口；真实 Main 的顺序/失败重试通过。
- 最终 Universal Helper 与隔离构建二进制指纹一致；不截屏的原生协议测试通过。Swift 缓存组件测试的源码未再改变，复用该项已通过结果。
- 同步前核对原有 256 个文件；除本轮涉及的 20 个既有文件外，236 个文件保持原指纹。用户暂存区二进制补丁保持原样。
- 完整原文件副本、36 项同步清单（含 3 个本地 Helper 二进制）和验证指纹已记录在忽略目录。未提交 Git、未推送、未打包、未签名/公证。
- 当前 pnpm dev 已正常重载到新的 Main/Helper，可按原习惯直接试用 Command+1。未使用自动化模拟用户真实屏幕。
