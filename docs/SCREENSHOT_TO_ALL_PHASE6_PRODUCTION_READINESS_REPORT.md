# ScreenshotToAll Phase 6 Production Readiness Report

## 结论

```text
ScreenCaptureKit Backend: READY WITH LIMITATIONS
```

ScreenCaptureKit 可以继续作为 macOS 14+ 默认截图后端，Electron 后端保留为权限、超时、Helper 异常和熔断期间的回退路径。当前实现已具备请求隔离、Helper 健康状态、熔断、自动恢复、显示器缓存失效和本地诊断数据。

公开发布仍受以下外部验证阻塞：Developer ID 签名与公证、Intel 真机、双显示器 Mixed DPI、首次安装与升级后的 TCC 保持。当前开发机只有一块 Retina 屏，也没有 Apple 签名和公证凭证。

按用户在测试期间的要求，高负载耐久测试已停止。已保留 500 次完整内存检查点；测试进程在停止前约执行到 750 次，但中断后的未落盘样本不作为正式结果。1000 次结果标记为未执行。

## Production SLA

基于目前数据，建议采用：

```text
P50                     <= 125ms
P95                     <= 170ms
P99                     <= 250ms
Timeout Rate            < 0.1%
Capture Failure Rate    < 0.1%
Unexpected Fallback     < 0.5%
```

100 次完整生产样本满足延迟目标。500 次部分耐久运行没有功能失败，但由于用户停止测试，没有生成可审计的逐次 timeout/fallback 分布，因此不能据此宣称后三项已经通过 1000 次发布门槛。

## Performance Distribution

完整分布来自 Phase 5 的 100 次生产链路，Phase 6 没有改动 JPEG 质量或正常截图链路：

| 指标 | 耗时 |
| --- | ---: |
| P50 | 120.33ms |
| P75 | 125.40ms |
| P90 | 131.42ms |
| P95 | 145.72ms |
| P99 | 199.94ms |
| Max | 203.81ms |
| Mean | 123.61ms |
| Std Dev | 14.73ms |

该样本满足建议的 P50、P95、P99 和 Max 目标。

## Endurance

| 检查点 | 功能失败 | Electron 总 RSS | Main RSS | Renderer RSS | GPU RSS | Helper RSS | Helper PID |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 0 | 723.67MB | 190.30MB | 380.03MB | 106.63MB | 14.05MB | 65779 |
| 100 | 0 | 782.64MB | 182.36MB | 454.48MB | 103.97MB | 18.97MB | 65779 |
| 250 | 0 | 738.30MB | 194.69MB | 393.73MB | 108.19MB | 18.38MB | 65779 |
| 500 | 0 | 794.92MB | 204.95MB | 452.16MB | 98.66MB | 18.23MB | 65779 |
| 1000 | 未执行 | — | — | — | — | — | — |

同一个 Helper PID 持续到 500 次检查点。测试输出没有功能失败，Helper RSS 在 100 次后下降并稳定在约 18MB。100 次 burst 因用户停止测试未执行。

耐久命令默认规模已降为 100 次和 20 次 burst，避免在日常工作机器上误触高负载。发布资格测试必须显式运行：

```bash
pnpm perf:sck:endurance:release
```

## Tail Latency

100 次样本中，P95 以上的 6 个请求平均阶段耗时：

| 阶段 | 平均耗时 |
| --- | ---: |
| SCScreenshotManager capture | 105.64ms |
| Swift JPEG encode | 25.71ms |
| Overlay show | 15.32ms |
| Swift dispatch | 7.37ms |
| Overlay paint | 6.46ms |
| Renderer decode | 2.39ms |
| Binary pipe | 1.23ms |

尾延迟的主要来源是 `SCScreenshotManager.captureImage`。JPEG、pipe 和 Renderer decode 没有形成主要 P95 瓶颈。最慢样本为 203.81ms，其中 SCK capture 为 170.51ms。

## Timeout Recommendation

建议保留固定 `500ms` timeout。

真实生产 100 次样本的 SCK request → frame ready 最大值为 179.25ms；500 次耐久检查点内没有 Helper PID 变化或功能失败。故 500ms 提供约 2.8 倍于已观测最大正常请求的余量，能降低系统调度抖动导致的误回退风险。

强制超时的真实回退成本：

| Timeout | SCK 等待 + Electron 回退总耗时 |
| ---: | ---: |
| 300ms | 690.47ms |
| 400ms | 739.49ms |
| 500ms | 834.27ms |

缩短 timeout 能改善异常路径，但现有数据不足以证明 300ms 或 400ms 不会增加真实用户的误回退率。当前不引入 adaptive timeout。先依靠熔断避免连续超时；将来只有在获得匿名本地分布或受控 1000 次数据后再调整固定值。

## Circuit Breaker

已实现轻量熔断：

```text
最近 5 次 Native capture 中失败 >= 3 次
→ degraded 30 秒
→ 冷却期间直接 Electron
→ 冷却后初始化 Helper 作为健康探测
→ 成功恢复 ready
```

真实测试中，连续 3 次 500ms Native 超时后进入 `degraded`。下一次截图不再等待 SCK，直接使用 Electron；该次耗时为 647.32ms，相比等待 500ms 后再回退的 834.27ms 减少 186.95ms。

开发状态接口现在输出：state、capture/success/failure/timeout 数量、最近 P95、熔断结束时间、Helper PID、重启次数、显示器缓存代次和分进程内存。数据只保存在本机内存，不上传网络。

## Helper Lifecycle 与 Request Isolation

已验证：

- capture in progress 时杀死 Helper：当前截图回退 Electron，下一次恢复 SCK。
- idle 时杀死 Helper：下一次截图恢复 SCK。
- capture completed 后杀死 Helper：后续截图恢复 SCK。
- 没有请求卡死、重复 Helper 或旧会话覆盖新会话。

Native 协议现在同时回传 `requestId` 和 `captureSessionId`。Main 只有在两个值同时匹配 pending request 时才接受 event/response。超时请求从 pending 表移除，迟到响应会被丢弃。

## Memory

结论：`High Watermark`，当前没有持续单调泄漏的证据。

证据：

- Electron 总 RSS：724MB → 783MB → 738MB → 795MB，存在明显回落。
- Renderer RSS：380MB → 454MB → 394MB → 452MB，存在明显回落。
- GPU RSS：107MB → 104MB → 108MB → 99MB，没有增长趋势。
- Helper RSS：14MB → 19MB → 18MB → 18MB，100 次后稳定。
- Helper PID 在 500 次检查点保持不变。

仍建议在专用测试机或 CI 桌面节点完成 1000 次和 4 小时 soak；日常工作机不再自动运行该负载。

图片生命周期加固：

- CaptureOverlay 在新 session 到来时立即 `URL.revokeObjectURL()`，不等待后续 reset。
- Main 在取消或替换 session 时释放 `CapturedFrame`、benchmark buffer 和内存采样引用。
- SCK JPEG 路径保持延迟构造 `NativeImage`。
- ESC 取消路径不会因正常 Renderer 展示而构造 `NativeImage`；只有选择裁剪或显式质量基准才解码。
- Swift 的 CGImage/JPEG Data 只存在于单次 request Task，写入 pipe 后不进入长期缓存。

## Display Cache

缓存刷新来源：

- Electron `display-added`
- Electron `display-removed`
- Electron `display-metrics-changed`（bounds、scaleFactor、rotation）
- macOS resume
- macOS unlock-screen
- Native CoreGraphics 拓扑指纹变化
- display mapping miss
- 可能由 stale cache 导致的 capture failure

同一时刻只允许一个刷新 Promise，避免显示器事件与紧随其后的截图重复调用 `SCShareableContent.current`。正常截图仍使用缓存，不会每次重新枚举。

单屏真实测试中，缓存刷新前后均为 `verified-direct-id`，缓存代次正常更新。

## Multi Display

当前真实硬件只有一块显示器：

```text
Electron Display ID: 1
SCDisplay / CGDirectDisplayID: 1
DIP: 1728 × 1117
Physical: 3456 × 2234
scaleFactor: 2
```

真实双屏、负坐标、左右排列和热插拔未验证。代码测试覆盖直接 ID、唯一几何回退和歧义拒绝，但这些不能替代真机测试。

## Mixed DPI

`未验证`。当前没有 scaleFactor 1 的外接屏。

发布前需要在 Retina 2x + 外接 1x 上验证两块屏的 overlay bounds、全屏 frame、DIP → physical crop 和热插拔恢复。

## Intel

`Build Verified / Runtime Not Verified`。

Swift Helper 为 universal Mach-O，包含 arm64 与 x86_64。Intel Mac 上的 Helper launch、SCK capture、binary pipe、TCC 与 Electron fallback 尚未做真机验证。

## Signing

当前 arm64 目录应用已重新打包：

```text
dist/mac-arm64/Snipvia.app
```

验证结果：

```text
codesign --verify --deep --strict: PASS
Hardened Runtime: enabled
Nested Swift Helper: signed and verified
TeamIdentifier: not set
Identity: ad hoc
```

本机 `security find-identity -v -p codesigning` 返回 0 个有效身份，因此 Developer ID Application 未验证。Helper 已由 `mac.binaries` 纳入嵌套签名配置。

## Notarization

`未执行`。本机缺少 `CSC_LINK`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD` 和 `APPLE_TEAM_ID`。

准备清单：

1. 安装有效的 Developer ID Application 证书。
2. 配置固定 Bundle ID `com.snipvia.desktop` 与 Team ID。
3. 使用相同 Team ID 签名 Electron app、frameworks 和 Swift Helper。
4. 运行 `codesign --verify --deep --strict`。
5. 使用 `notarytool submit --wait` 提交 DMG/ZIP。
6. 使用 `stapler staple` 和 `stapler validate`。
7. 在一台未安装过 Snipvia 的 Mac 上通过 Gatekeeper 启动并重新测试 Helper、pipe、SCK 与 TCC。

## TCC

已验证当前授权应用可以使用 ScreenCaptureKit，Helper 不会出现独立权限主体。以下发布场景尚未执行：

- 新 Bundle 首次安装 → 请求权限 → 授权 → 重启 → 截图。
- 已授权 v1 → 同 Bundle ID 和 Designated Requirement 安装 v2 → 权限保持。

人工升级验证必须同时记录 Bundle ID、Team ID、Designated Requirement 和系统设置中的录屏权限条目。ad hoc 开发签名结果不能替代 Developer ID 更新场景。

## Validation

已通过：

```text
pnpm typecheck
pnpm lint
pnpm test                 # 14 files, 67 tests
pnpm build
pnpm native:test
pnpm test:smoke           # 2 passed, 9 explicit real-device suites skipped
test:sck:failure          # real macOS GUI
test:sck:display          # real macOS GUI, single Retina display
packaged SCK self-test    # 1 passed; bundled Helper; no fallback
codesign --verify --deep --strict
```

Phase 6 的 smoke test 已在停止高负载测试后单独重跑；它只执行常规桌面流程和预加载复用检查，没有执行耐久、故障注入或真实截图性能套件。正式 Electron distribution 已完成 arm64 目录打包，产物为 `dist/mac-arm64/Snipvia.app`。打包产物自检实际启动该应用并完成一次 ScreenCaptureKit 截图，使用内置 universal Helper，未触发 Electron fallback。首次下载 Electron distribution 时受隔离网络 DNS 限制，允许网络访问后通过标准 `electron-builder --dir` 完成打包。

打包自检使用独立临时 user data 目录和测试专用启动参数，避免与用户正在运行的 Snipvia 实例争抢单实例锁或全局快捷键。可复用窗口预加载现在有 15 秒上限，加载异常不会再让启动流程无限等待；正常产品启动、快捷键和截图行为保持不变。

## Production Recommendation

ScreenCaptureKit 后端在当前 Apple Silicon 单屏环境达到 `READY WITH LIMITATIONS`：

- 默认启用条件继续保持 macOS 14+、录屏权限已授权、Helper ready。
- 固定 timeout 保持 500ms。
- Circuit Breaker 保持最近 5 次失败 3 次、冷却 30 秒。
- Electron fallback 必须保留。
- 不再为 P50 的 0.33ms 差距牺牲 JPEG 质量或正确性。

公开分发前的阻塞项：

1. Developer ID + Hardened Runtime 签名真测。
2. notarization、staple 和全新机器 Gatekeeper 验证。
3. Retina 2x + 外接 1x Mixed DPI 真机。
4. Intel Mac 运行时验证。
5. 首装 TCC 与同签名升级权限保持。

1000 次耐久测试建议转移到专用测试机执行，不再占用用户的日常工作电脑。

## Shortcut Response Follow-up（2026-09-22）

在不使用旧帧、不降低 JPEG 质量、不改变同帧裁剪语义的前提下，截图链路增加即时透明选择层：快捷键回调进入 `startCapture()` 后先显示准备态，ScreenCaptureKit 在后台采集同一帧；帧解码完成后再开放框选。即时层使用 `showInactive()`，就绪后才取得焦点，避免准备阶段的窗口激活抖动。Native 失败时先隐藏即时层，再进入 Electron fallback。

当前 Apple M1 Pro、单块 Retina `1728 × 1117 DIP / 3456 × 2234 px / scaleFactor 2` 真机结果：

| 测试 | 样本 | 即时选择层平均 | 可框选平均 | 可框选 P50 | 最大值 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 修改前基线 | 3 | 无 | 169.60ms | 180.31ms | 221.72ms |
| 修改后 | 5 | 3.72ms | 132.27ms | 118.20ms | 215.04ms |

修改后 5 次即时响应分别为 `9.95 / 3.07 / 1.58 / 1.98 / 2.03ms`。可框选时间仍主要受 `SCScreenshotManager.captureImage` 波动影响；5 次 Native capture 为 `164.11 / 74.99 / 53.44 / 75.91 / 62.90ms`。测试数据保存在 `performance-results/capture-latency-baseline.json` 和 `performance-results/capture-latency-optimized-5.json`。

额外真实故障测试覆盖 Helper crash、timeout、缺失和权限拒绝，Electron fallback 全部通过。Playwright 注入的页面键盘事件不会经过 Electron `globalShortcut`，因此自动化指标从全局快捷键回调直接调用的同一 `startCapture()` 入口开始计时；未为了模拟物理按键而申请辅助功能权限。
