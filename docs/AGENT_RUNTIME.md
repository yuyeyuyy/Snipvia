# Agent Runtime 与 Agent Loop

状态：核心循环、Provider 接口、上下文管理、流式事件、取消/预算和单元测试已实现。[Agent Execution UI](AGENT_EXECUTION_UI.md) 已接入主聊天与 QuickChat，默认启用 Agent，提供 Chat Completions Tool Calling 适配和执行 IPC；手动关闭 Agent 后使用原有聊天接口。当前支持选定笔记本的专用 Markdown 工具与 [沙箱命令/脚本](AGENT_COMMANDS.md)；通用文件修改、Undo 和外部 MCP 仍禁用。更新：2026-10-06。

## 模块边界

```text
AgentRuntime：创建 run、取消、内存快照
  ↓
AgentLoop：构建 context → LLMProvider → tool calls → ToolExecutor → tool results → 下一轮
  ├ ContextManager：历史配对验证、整轮裁剪、结果截断、token 预算
  ├ ProviderTurn：单轮 timeout、stream 生命周期、完整响应校验
  └ ToolExecutor → ToolRegistry / workspace 检查 → FileChangeService / PermissionManager
```

`AgentLoop` 不导入 Electron、UI、模型厂商 SDK、HTTP 地址或凭据。文件权限与 diff 审批复用 [工具系统](AGENT_TOOL_SYSTEM.md) 和 [文件修改流程](AGENT_FILE_CHANGES.md)。循环不能构造 workspace 授权。写入是否需要提示由 [统一权限系统](AGENT_PERMISSIONS.md) 决定；循环不能替用户批准。默认每次 run 创建独立权限会话，Main 可通过 `permissionSession` 复用同一对话的授权。

## Provider 接口

接口位于 `src/main/ai/llm/LLMProvider.ts`：

```ts
interface LLMProvider {
  readonly id: string;
  chat(request: AgentChatRequest): Promise<AgentChatResponse>;
  stream?(request: AgentChatRequest): AsyncIterable<AgentProviderEvent>;
  countInputTokens?(context: AgentChatContext): number;
  countOutputTokens?(response: AgentChatResponse): number;
}
```

请求包含 system、messages、统一工具描述、`maxOutputTokens` 和 `AbortSignal`。Provider 应把它们映射到自己的协议，并将取消传递到实际网络请求/读取器。

响应包含：

- `content`：本轮文本。
- `toolCalls`：可选数组，每项 `{ id, name, arguments }`；arguments 保留 JSON 字符串，格式错误时交给循环反馈模型，不猜测修复参数。
- `finishReason`：`stop`、`tool_calls`、`length` 或 `blocked`。
- `usage`：可选 `{ inputTokens, outputTokens }`。
- `providerState`：可选的 Provider 私有序列化续接数据；由适配器解释，循环原样随 assistant 消息保存，不把它当作用户指令。

现有 ChatCompletionsAgentProvider 支持兼容接口的 Tool Calling/SSE。Anthropic、Gemini 原生协议和其他本地协议后续分别实现适配器，统一 tool call ID、结束原因、流事件和消息格式。现有 `ai/provider.ts` 的截图聊天代码未被包装成假装支持工具的 Provider；它目前只解析文本。

### Streaming

默认优先使用 `stream()`，缺少该方法或 `streaming: false` 时使用 `chat()`。

```text
text_delta / tool_call_delta
...
complete { response: 完整且合并完成的 AgentChatResponse }
流正常结束
```

工具参数增量仅用于展示，不能触发执行。只有收到唯一 `complete` 并且流正常结束，才检查完整 tool calls。EOF 前缺少 complete、complete 后仍有事件、输出截断、模型拒绝或无效响应都不会执行本轮工具。

`complete.response` 是最终权威结果，适配器负责合并增量并保持其与展示内容一致。工具调用 ID 在整段历史中不能重复；重复会停止运行，避免误执行同一项写入。普通回答不能为空，结束原因必须与工具调用存在与否一致。

## 循环与错误恢复

每一 step 表示一次 LLM 请求。一次返回的多个工具中，相邻的只读调用（`network:read`、`workspace:read`，即搜索、读取网页、读文件、列目录、搜索文件）最多 4 个并行执行；笔记写入、命令、脚本和 `todo_write` 严格串行。结果始终按模型给出的调用顺序写入 conversation，全部完成后才发起下一轮请求。

```text
user
assistant(toolCalls: A, B)
tool(A, ToolResult JSON)
tool(B, ToolResult JSON)
assistant(toolCalls: C)
tool(C, ToolResult JSON)
assistant(final answer)
```

### 计划工具 todo_write

参考 OpenCode 的 todowrite，循环内置 `todo_write` 工具（能力为 `agent:state`），不经过 ToolRegistry/ToolExecutor，没有文件、网络或进程能力。模型提交完整清单（最多 20 项，每项 `content` 与 `status`：`pending`、`in_progress`、`completed`、`cancelled`），同一时间最多一项 `in_progress`，否则返回 `INVALID_INPUT`。有效清单产生 `todo_updated` 事件，界面显示为计划清单，不作为工具步骤。系统提示要求 3 步及以上的任务先列计划。

未知工具返回 `TOOL_NOT_FOUND`；无法解析为 JSON 对象的参数或不符合工具 Schema 的参数返回 `INVALID_INPUT`。工具 IO 错误、超时、拒绝审批等反馈给模型，允许模型改变参数或回答说明。循环不自动重试一次工具执行；下次必须由新的模型回复提出。

工具失败（含连续失败）不终止任务，结果交给模型调整参数或改用其他方式；失败次数只受 `maxSteps` 与 `maxToolCalls` 的总量约束（2026-10-07 起取消连续失败上限）。用户取消不作为可重试失败继续调用模型。多调用批次中取消或达到上限时，剩余调用补上“未执行”的结果，保持调用/结果配对。取消发生在原子写入期间时，循环等待 ToolExecutor 返回实际结果，将已成功提交的结果保留，再停止后续操作。

Provider 请求失败直接终止本 run，避免隐藏重试成本。SDK 原始异常可能带密钥、请求体或路径，不直接传给事件或日志。

## 默认限制

这些值是运行策略，不是性能测量或模型能力声明。由可信 Main 在构造循环时配置，工具参数不能修改它们。

| 配置 | 默认值 | 含义 |
| --- | --- | --- |
| `maxSteps` | 30 | 最多 30 次 LLM 请求 |
| `maxToolCalls` | 96 | 本 run 最多处理的工具调用数，含未知工具/参数错误 |
| `maxToolCallsPerStep` | 8 | 单个模型回复最多 8 个工具调用 |
| `llmTimeoutMs` | 120000 | 每轮 LLM 请求绝对超时，包含读取完整 stream |
| `toolTimeoutMs` | 10000 | 交由 ToolExecutor 执行，不能高于其上限 |
| `maxContextTokens` | 65536 | 输入、输出和安全预留的上下文总预算 |
| `maxOutputTokens` | 8192 | 请求中的最大输出预算 |
| `contextReserveTokens` | 512 | 为协议/模型差异留出的余量 |
| `maxTotalTokens` | 1000000 | 本 run 累计输入与输出预算；每步重发完整上下文，故按累计计算 |
| `maxToolResultBytes` | 8192 | 单条反馈序列化后的字节上限 |
| `maxResponseBytes` | 524288 | 单轮完整响应/流增量数据的大小上限 |

人工审批仍有独立的 5 分钟超时，不被 10 秒工具文件处理预算打断。已有文件提交的并发和取消边界继续遵守文件修改文档。

超过 maxSteps 返回 `limit_reached` 和明确中文说明“Agent 已达到最大执行步骤（30）”。工具数量、上下文、累计 token 和输出超限也会给出具体停止原因。

## 上下文与 token 控制

**按模型的上下文窗口**（`ai/llm/contextWindow.ts`）：已知窗口不小于 128K 的系列（GPT-4.1/4o/5、Gemini、DeepSeek、Kimi K2、GLM-4.5V+、Qwen3、豆包 Seed 等，识别时忽略 `openai/` 这类网关前缀）使用 128K 工作上限——每步都会重发完整上下文，更大的工作集主要增加成本；较老或未知的模型（含自定义与本地服务）使用 32K，避免请求超出真实窗口。输出上限为 min(8192, 窗口 ÷ 4)。

**摘要压缩**（参考 OpenCode 的 compaction）：当一次请求需要丢弃较早的对话轮次（或当前任务之外的内容使预算不足）时，循环先发一次不带工具和截图的请求，把较早轮次压缩为不超过 800 字的摘要，替换为「摘要（user）+ 确认（assistant）」两条消息，再继续当前任务。每个 run 最多压缩一次；压缩后的记录会写回会话，后续轮次不再重复总结。摘要请求失败时退回下文的整轮丢弃。界面状态行显示「正在压缩较早的对话」。

1. 历史必须以 user 开始；assistant tool calls 与 tool results 必须正确配对，不能有孤立结果或重复 ID。
2. 历史最多 2000 条、序列化累计 4 MiB；当前用户消息、工具参数、响应均另有限额。
3. 构建请求时计入系统提示、工具 Schema、消息、参数、结果和 Provider 续接状态，再预留输出与安全余量。
4. 超出预算时分两级处理，只影响发送给模型的副本，完整返回 transcript 保留：
   - **清理旧工具结果**（参考 OpenCode 的 prune）：从最早的工具结果开始，替换为合法 JSON 占位 `{"pruned": true, ...}`，提示模型需要时重新调用工具读取；最近 3 条工具结果始终保留原文。消息位置不变，调用与结果配对不受影响。`context_prepared` 事件报告 `prunedResults`。
   - **裁剪完整的旧 user 对话轮次**。当前用户任务及其工具调用链不会被拆开或静默丢弃；清理后仍单独超过预算时停止并返回 `CONTEXT_LIMIT`。
5. 工具结果过大时，以合法 JSON 返回 `truncated`、原始大小和一段有界摘要，不直接截断 JSON 字符串。提示模型这不是完整文件。
6. 优先使用 Provider token counter 做请求预算、使用响应 usage 做累计统计。Chat Completions 适配器在流式请求中发送 `stream_options.include_usage`，以取得厂商计数。没有 counter 时按 UTF-8 字节数 ÷ 3 加固定余量估算（约等于一个 CJK 字符或 3 个 ASCII 字节计 1 token）；没有 usage 时明确设置 `tokens.estimated = true`。
7. 估算值只用于预算，不作为拒绝依据：只有厂商报告的输出计数超过请求上限，或 `finish_reason: length`，才判定输出超限。带工具调用的截断响应不执行任何工具（`OUTPUT_LIMIT`）；不带工具调用的截断回答保留已生成文字，追加「回答达到输出长度上限」提示并以 `completed` 结束，避免丢弃用户已经看到的流式内容。
8. 每轮发送前根据剩余总预算缩小 `maxOutputTokens`，不足最低预算时不再发送。超时或失败请求保留已预留的输入估算，但无法得知所有真实输出成本；这不是账单计量。

保守估算可能提前停止，不能冒充精确 tokenizer。接入真实模型时应配置它的实际 context window、实现相应 token counter，并确保 Provider 将 maxOutputTokens/AbortSignal 正确映射到底层请求。

## 会话持久化

`AgentSessionStore` 把每个对话的完整 Agent 记录（含工具调用与结果）保存到 `userData/agent-sessions/<对话 ID>.json`，每轮结束写入；重新打开对话或重启应用后继续使用，而不是只取最后 12 条纯文本。加载时复用 `validateHistory` 校验，损坏或调用/结果不配对的文件被忽略。记录同时保存其所基于的笔记本：重新选择同一笔记本保留历史，换成其他笔记本或取消笔记本时清空。删除对话或清空历史时删除对应文件。

## 事件与日志

事件含 `runId`、从 1 开始的递增 `sequence`、`timestamp` 和 `step`：

- `run_started`、`step_started`
- `context_prepared`、`llm_started`
- `assistant_delta`、`tool_call_delta`、`llm_completed`
- `tool_started`、`tool_running`、`tool_completed`
- `permission_request`、`permission_resolved`（请求与决策、取消、过期结果）
- `step_completed`、`run_finished`

UI 在 `llm_completed` 时只投影完整工具调用，忽略中间模型文本；最终答复等 Runtime 校验完成后发布。`run_finished` 是所有状态的终止信号。失败可能直接结束当前 step，不一定先出现 `step_completed`。

`onEvent` 会提供 UI 所需的受限文本/结果，不能当作可以整包打印的日志。独立 `AgentLogger` 只接收 run/step/sequence、事件类型、已注册工具名、状态和错误码；不包含 prompt、参数、结果、文件内容、模型回答或原始异常。未注入 logger 时默认无输出，开发者可用 `SNIPVIA_AGENT_DEBUG=1` 打印这些元数据。回调/日志异常不影响运行，回调获得副本，不能篡改待执行调用。

## Main 接入示例

```ts
import { AgentLoop } from './agent/AgentLoop';
import { AgentRuntime } from './agent/AgentRuntime';

// provider 是已配置好的 LLMProvider 实例；授权对象仅由可信 Main 创建。
const loop = new AgentLoop({
  provider,
  registry: agentFileTools.registry,
  executor: agentFileTools.executor
}, { limits: { maxSteps: 20 } });

const runtime = new AgentRuntime(loop);
const handle = runtime.start({
  message: '阅读 README 并告诉我如何运行测试',
  workspace: authorizedWorkspace,
  history: previousRun?.messages,
  streaming: true
}, (event) => {
  // 应用中的 ExecutionPresenter 过滤后，通过窄 IPC 向所属窗口投递状态。
});

handle.cancel(); // 或 runtime.cancel(handle.runId)
const result = await handle.result;
const snapshot = runtime.getSnapshot(handle.runId);
```

每个 run 独立持有 AbortController、上下文、预算和工具执行 ID。`cancelAll()` 只取消本 Runtime 的 run，不调用 ToolExecutor 的全局取消方法。快照保留最近 20 个已结束 run，不写磁盘，不在重启后自动重放工具；执行 IPC 与内存步骤卡片已接入；工具上下文和卡片尚不持久化。

## 验证与后续

`tests/unit/agent-loop.test.ts` 使用模拟 Provider 与临时 workspace，覆盖普通回答、单次/连续/批量工具调用、工具错误、未知工具、参数错误、取消、步骤上限、LLM/工具超时、流中断、重复 ID、上下文裁剪、token/结果上限、事件隔离、日志脱敏、并发 run，以及写入审批拒绝。

运行 `pnpm lint`、`pnpm typecheck`、`pnpm test` 和 `pnpm build`。UI 接入另有定向 Electron 冒烟测试，使用合成截图和临时文件。

这些接入已在 [Agent Execution UI](AGENT_EXECUTION_UI.md) 实现；下一步可增加原生协议 Provider 和 Shell 执行器。不能把浏览器窗口任意传来的路径直接作为授权 workspace。

## MCP 工具接入

[stdio MCP](AGENT_MCP.md) 已接入同一 ToolRegistry / ToolExecutor，AgentLoop 无需了解工具来源。工具集在每次 run 开始时取快照；连接完成或目录变更后新增的工具在下次 run 可见。目录撤下或断线时旧调用失败，不自动重放。MCP 权限请求继续使用现有 step events。
