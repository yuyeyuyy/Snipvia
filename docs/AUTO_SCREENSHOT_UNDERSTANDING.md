# 截图预测与分支执行

2026-10-17。当前免费客户端无需账号；可选 Jev 原生图片预测的配置、协议和验证见 [Jev 图片预测](JEV_PREDICTION.md)。旧服务端、管理控制台和账号预测不在当前路径中。

## 当前调用链

```text
截图可见，打开对话输入窗
→ 等待用户明确输入
  ├ 空输入 Enter → 本机 OCR 辅助 → PredictionService
  │                             ├ 已启用 Jev 且有 Key：Main 直连 Jev 图片 API
  │                             └ 未启用或无 Key：用户视觉模型分类
  │              → 校验 ScreenshotAnalysis → AutoActionRouter → 原分支执行
  └ 输入提示词 Enter / 续拍 → 跳过预测 → 原 Agent / 对话流程
```

截图显示仍是最高优先级。`awaiting_input` 阶段不启动 OCR 或模型请求；空输入提交才经 `auto-action:start` 开始预测。Shift+Enter 换行，输入法确认不提交。Main 校验置顶截图 ID 与当前操作状态，重复 Enter、取消或迟到结果不会重复执行分支。

## 模块

- `src/main/index.ts`：`beginAutoUnderstanding`、统一取消与 `executeAutoAction`；Jev 配置变更同样取消进行中的预测。
- `src/main/analysis/screenshot-analyzer.ts`：保留 OCR 文本和诊断信息；分类失败不以 OCR 自动执行。
- `src/main/analysis/PredictionService.ts`：选择默认用户视觉模型或可选 Jev 图片策略。
- `src/main/ai/jev/`：TypeSafe 原生图片协议与裁剪图尺寸处理。
- `src/main/analysis/auto-action-router.ts`：匹配本次启用分支，生成已有 Action。
- `src/main/ai/provider.ts`：默认用户视觉模型分类、实际回答与日程提取。
- `src/shared/screenshot-understanding.ts`：原有内容类型、分支、状态与输出契约。
- `native/screen-capture-kit-helper/main.swift`：macOS 本机 OCR；OCR 不可用不替换分支模型。
- `src/renderer/src/chat/QuickChat.tsx`：只读分支标签、单行状态、流式内容和手动输入。

## 分支与执行规则

适用内容可编辑、多行、最多 1000 字符，支持具体场景与排除条件；内置和自定义分支使用相同编辑入口。旧配置缺失该字段时按原 trigger 提供默认描述，保留名称、指令、启用状态和笔记本绑定。

本机 OCR 不再直接决定分支。模型根据适用内容选择最具体的启用分支，同等条件下优先自定义分支、再按列表顺序。关闭的分支不参与匹配；执行指令与笔记本 ID 不参与模型分类。Jev 使用本次启用集合的临时索引，响应校验后映射回本地分支 ID；默认视觉模型同样校验 ID 白名单。

现有 Router 和 Main 的行为保留：

- 匹配分支且置信度至少 0.82：进入原执行流程。
- 置信度 0.65 至 0.82：保留原 700ms 推荐等待，可被用户输入取消。
- 低于 0.65 或没有适用分支：等待用户提问，不通过固定内容类型绕过排除条件。
- 日程分支额外要求 `hasSchedule`；Jev 将日程 Noul 至少 0.82 映射为此信号。日程提取、草稿编辑及系统日历/提醒事项的用户确认仍按原流程。
- 所有分支关闭：不读取预测凭据、不发起模型请求。

模型命中后，AI / Agent、笔记授权和日程处理沿用原执行器。Jev 不生成执行命令，不代替用户的聊天模型；后续任务仍可能调用用户视觉模型和已授权工具。

## 配置、错误与取消

Jev 独立配置与密文保存在 `prediction-settings.json`。未启用或没有 Key 时使用原用户视觉模型；已保存 Key 无法解密、文件损坏或请求失败时，显示脱敏错误并等待明确重试，不自动换一家模型。失败和无匹配不等价。

用户输入、Esc、截图替换、模型或 Jev 配置变更通过原 AbortController 取消。异步结果仍核对 captureId、operationId 和当前 controller；迟到结果不能恢复旧流程。没有手动切换执行分支的新增 IPC。

## 隐私与性能

只有选中的裁剪图参与 OCR 和模型预测；等待输入期间不发送图片。默认发到用户视觉模型，启用 Jev 时由 Main 直接发送到 TypeSafe，不经过 Snipvia 后台。Jev 和聊天模型 Key 不交叉，执行 prompt、笔记本路径、账号 Cookie 不进入 Jev 请求。适用条件与截图文字是分类数据，不能变成任意执行权限。

Jev 图片要求通过仅处理裁剪图的等比例缩小和居中补白满足；不会为了凑尺寸扩展到原屏幕。详细尺寸和模型约束见 [Jev 图片预测](JEV_PREDICTION.md)。

原 OCR、视觉分类、选择分支、开始执行和首 Token 埋点保留。分析时延从用户按 Enter 后的 `auto_analysis_start` 计算，不把等待输入时间当成模型耗时。

## 验证边界

当前回归使用临时数据、合成图片与模拟上游，未调用真实付费 Jev。历史服务端版本的验收数字不能代表当前客户端或新图片模型的准确率。正式签名升级、Windows / Intel 真机及真实录屏条件用例仍须独立记录，见 [Phase 3 报告](opensource/PHASE3_READINESS.md)。
