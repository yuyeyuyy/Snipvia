# Agent MCP 接入

> 当前产品策略（2026-10-06）：Agent 可读取文件、联网，并通过独立的 notebook:write 能力自动整理选定笔记本中的 Markdown，见[自动笔记写入](AGENT_NOTE_WRITING_PLAN.md)。通用文件写入、编辑、Undo 与 external:execute 的 MCP 调用仍禁用，在 Main Registry/Executor 双重限制，不能用已有审批绕过。下文说明通用工具与底层能力。

## 当前实现

Main 中新增 `MCPManager`、`MCPClient`、`MCPToolAdapter`，将 stdio MCP 工具注册到现有 `ToolRegistry`。`AgentLoop` 不需要判断工具来源，仍经 `ToolExecutor`、`PermissionManager` 调用。

```text
应用启动 → 读取用户配置 → 启动权限确认 → stdio initialize
    → tools/list（支持分页）→ Schema 校验 → MCPToolAdapter → ToolRegistry

AgentLoop → ToolExecutor → 参数校验 → PermissionManager
    → 用户确认 → tools/call → 标准 ToolResult → AgentLoop
```

主聊天与截图浮动对话现已提供可选 [Agent 模式](AGENT_EXECUTION_UI.md)，通过同一 Registry 使用 MCP；未开启时继续使用原有聊天链路。MCP 的设置 UI、HTTP/SSE 传输、OAuth、resources/prompts 浏览、sampling、elicitation 和异步 tasks 协议尚未实现。客户端不向 Server 宣告这些能力，也不自动执行 Server 请求的模型调用或授权。

## 配置文件

固定位置为 Electron `userData/mcp/servers.json`，只读该用户配置，不自动读取当前项目中的 MCP 文件。

- macOS 安装版通常为 `~/Library/Application Support/Snipvia/mcp/servers.json`。
- 稳定开发版为 `~/Library/Application Support/snipvia-dev/mcp/servers.json`。
- Windows 安装版通常为 `%APPDATA%/Snipvia/mcp/servers.json`。
- `dev:raw` 或自定义 Electron 启动方式以实际 `app.getPath('userData')` 为准。

文件不存在时默认没有 MCP Server，应用正常启动。配置文件最大 128 KiB，不读取符号链接或非普通文件。内置 Agent 文件工具禁止访问自己的 MCP 配置目录，不能自行增加启动命令。配置变更在下次启动生效；本阶段不做文件监听或 Renderer 配置写入。

示例（把可执行程序、脚本路径替换成实际安装的 Server）：

```json
{
  "mcpServers": {
    "github": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/github-mcp-server.js"],
      "envFrom": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "SNIPVIA_GITHUB_MCP_TOKEN"
      },
      "connectTimeoutMs": 10000,
      "requestTimeoutMs": 10000,
      "reconnect": { "maxAttempts": 3, "initialDelayMs": 1000 }
    }
  }
}
```

最小配置只有 `command` 和可选 `args`。也支持绝对路径 `cwd`、`enabled: false`、显式 `env`。`envFrom` 按名称转发 Main 进程已有的环境变量，变量缺失则拒绝启动，不将变量值发给审批 UI 或日志。不要把密钥写到 `args` 或提交到仓库；参数会显示在启动审批中。Finder 启动的应用通常没有终端里 export 的变量，本阶段尚未添加 MCP 专用凭据设置。

使用 `shell: false` 启动，`command` 是一个可执行程序，`args` 是字面参数数组，不能把整行 shell 命令放进 command。macOS GUI 的 PATH 可能不含 Homebrew，建议使用绝对路径。Windows 不隐式运行 `.cmd/.bat`，可配置 `node.exe` 与 Server 的 JS 入口；尚未做 Windows 真机验证。

## 连接与生命周期

- 主窗口加载后异步读取配置，不等待 MCP 才初始化截图能力。
- 最多 16 个 Server，依次完成启动确认和连接，避免同时打开多张权限窗口。
- `initialize` 握手并协商版本后读取 `tools/list`。Server 必须声明 tools 能力。
- 工具目录最多 128 个工具、1 MiB、17 页；重复名称、重复 cursor 和超限结果失败。
- 收到 `notifications/tools/list_changed` 立即撤下旧工具，并合并刷新请求；不支持的 Schema 跳过并计入 `rejectedTools`。
- 意外断线立即使旧工具失效，默认最多重连 3 次，间隔 1、2、4 秒。次数在本次连接生命周期累计，不因一次短暂成功清零；最大延迟 30 秒。
- 重连重新握手和发现工具，绝不重放未完成的 `tools/call`。失败时结果可能未知，不能声称远程操作没有发生。
- Main 的 `status()` 返回连接状态、工具数、拒绝数、重连次数和错误码。`disconnect(server)` 停止该连接与重试；`reconnect(server)` 明确开启新一轮连接；`stop()` 取消所有连接并注销自己的工具。
- 退出应用时先撤下工具、取消调用并关闭直接子进程，先 SIGTERM，500ms 后仍未结束则 SIGKILL。MCP 子进程自行启动的后台孙进程不保证被关闭，当前不是操作系统沙箱。

## 权限边界

外部工具统一使用 `external:execute` 权限，进入现有 PermissionManager，默认 **DANGEROUS**。Server 的 `readOnlyHint`、`destructiveHint` 和工具名称不能授予 SAFE 权限，也不能冒充内置 `read_file`。

1. **启动确认**：显示 Server、command、args、cwd、环境变量名和自动重连次数。此确认授权启动该配置及其有限自动重连；取消或拒绝时不创建进程。
2. **工具确认**：显示 Server、原工具名和参数。允许 Allow Once / Allow This Session / Deny，不提供 Always Allow。
3. 会话授权绑定服务器配置指纹、连接目录版本、工具 Schema/描述与完全相同的参数。修改参数、重连或重新发现目录后需要重新确认。
4. 目录撤下时，即便旧审批窗口随后批准，也不会执行过期工具。
5. 外部进程不能获得 Snipvia 内置 WorkspaceAccess 能力，但它本身以当前系统用户运行，可能访问工作区以外文件、网络和账户。权限弹窗明确显示此事实。MCP 通用协议不能强制文件 diff、atomic write 或 Undo；这些保障只属于内置文件工具。仅配置可信 Server，并按 Server 自身选项限制访问目录和账号权限。

客户端只继承 PATH/HOME/USERPROFILE/SystemRoot/WINDIR/TEMP/TMP/TMPDIR/LANG 等基础变量及用户明确配置的 env/envFrom，不继承整个 Main 环境。不会打印原始 stderr、协议参数、完整工具结果或凭据。Main 只输出最终连接失败的 Server 名与错误码，或不支持的工具数量。

## Schema 与结果

- 以固定版本官方 MCP SDK 处理协议，使用自定义限额 stdio Transport；单条收发 JSON-RPC 消息限 1 MiB，最多每秒 256 条，每个 Server 最多 8 个并行调用，发送队列最多 64 条。
- Server 工具名保留原始映射，对模型公开 `mcp_<可读前缀>_<摘要>`，最长 64 字符。摘要覆盖 Server、原工具名、Schema 和描述，不会与内置工具或其他 Server 混淆。
- inputSchema 使用 Ajv 校验，支持默认 JSON Schema 2020-12 和显式 draft-07。Schema 限 32 KiB，调用参数限 64 KiB，深度 32、节点 4096；不做类型强转、默认值填充或静默删除参数。
- 为避免 Main 执行不受控正则和读取外部引用，当前拒绝 `pattern`、`patternProperties`、异步/动态引用和非本地 `$ref`；`format` 只作为注释，不作校验。要求 tasks 的工具暂不注册。这个限制可能使部分现有 Server 的工具不可用，状态会报告拒绝数量。
- text、嵌入的文本资源和 structuredContent 转为有界文本；链接仅作为文本展示，不自动读取链接。图片、音频及二进制 blob 不进入模型上下文。
- 单次标准化输出 JSON 不超过 7 KB（文本初始上限 5 KB），带 `source: untrusted_mcp`、`truncated`、`omittedBlocks`。与现有 Agent 默认 8 KB 工具结果预算配合；没有缓存或后续读取被截断内容的接口。工具描述仍计入 Agent 的 context 预算，配置很多 Server 时可能达到预算上限；本阶段没有按需选择工具目录。
- `isError: true` 转为 `MCP_TOOL_ERROR`，协议错误为 `MCP_PROTOCOL_ERROR`，断线为 `MCP_DISCONNECTED`，超时为 `TIMEOUT`。错误响应和正常结果都视为不可信工具内容。
- AbortSignal 和执行器超时沿用原有链路，SDK 尽力发送取消通知。远端不配合取消时，不能保证副作用停止或回滚。用户审批有单独期限，不消耗默认 10 秒工具执行预算；实际调用上限取 Executor 与 Server 配置中较短者。

## 验证

自动化使用本地合成 stdio Server 和模拟 LLM，不连接真实账号、不执行桌面截图：

- 配置校验、环境变量隔离、文件限额和符号链接拒绝。
- MCP 初始化、分页、真实子进程调用、工具错误、协议错误、异常输出、Server 崩溃。
- 连接/目录/调用超时、取消、有限退避重连、动态列表、旧工具失效和退出清理。
- 启动拒绝不 spawn；工具拒绝不发送 tools/call；不能通过只读声明或同名工具绕过权限；会话审批范围不扩大。
- 未修改的 AgentLoop 经 registry、PermissionManager 调用真实 stdio 工具并把结果送回模型。

实际 GitHub 等第三方 Server 的账户访问和 Windows 子进程行为尚未验证；Agent 入口和内联审批的验证见 UI 文档。

## 参考

- [官方 TypeScript Client 文档](https://ts.sdk.modelcontextprotocol.io/client)
- [MCP tools 规范](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
- [MCP stdio transport 规范](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
