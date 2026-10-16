# 联网研究与网页来源

日期：2026-09-27。状态：已接入默认 Agent 对话与截图悬浮对话，已完成模拟窗口验证和小范围真实网络验证。

## 原实现的问题

- 默认 HTML 搜索一次只取 5 条，工具上限 10 条。缺少一次提交互补查询、合并去重和部分失败保留能力。
- 搜索服务依赖 DuckDuckGo 公共 HTML 页面。本机实测首次请求成功，后续出现验证限制；不能靠增大数量解决入口稳定性。
- 网页首段最多约 4000 字节，重要段落可能在后面；正文识别不够明确，模板文字可能占据预算。
- 来源依赖模型自己输出链接，没有统一保存本轮真实工具结果；无法可靠显示网页数、已读状态或历史来源弹窗。

## 参考了哪些实现

| 一手资料 | 观察 | 在 Snipvia 中采用 |
| --- | --- | --- |
| [OpenCode Web Search 源码](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/tool/websearch.ts)、[HTTP MCP 搜索封装](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/tool/mcp-websearch.ts) | 搜索供应商独立于 Agent；使用面向 Agent 的检索服务，控制结果与文本预算 | 保留 WebSearchProvider；增加 Exa 官方托管服务适配器 |
| [Cline 3.48 WebSearch](https://cline.bot/blog/cline-3-48-0-skills-and-websearch-make-cline-smarter) | 将搜索发现和网页内容读取分开，为模型提供干净文本 | web_search → fetch_url → 必要时 read_web_chunk |
| [Anthropic 研究系统设计](https://www.anthropic.com/engineering/multi-agent-research-system) | 多角度检索、迭代缩小范围、并行独立操作、结合来源核实 | 单个 Agent 一次最多 3 个互补查询，按证据决定补查和停止；未引入多 Agent 系统 |
| [Exa MCP 官方实现](https://github.com/exa-labs/exa-mcp-server)、[搜索过滤与片段文档](https://exa.ai/docs/search/quickstart) | 官方匿名入口有额度限制；提供结构化结果、相关片段、域名及路径过滤 | 固定只读方法，真实 site 过滤，优先 highlights，保留原文读取 |

这些是当前官方实现的取舍，不是项目热度排名。没有复制完整 Agent Runtime，也没有引入浏览器自动化或远程自主执行功能。

## 当前查询与读取流程

```text
用户问题 / 截图
  → Agent 判断是否需要联网
  → 生成产品、版本、报错等准确查询
  → web_search(query, additionalQueries?, maxResults?)
    → 默认 Exa / 已配置的 Brave
    → 最多 3 个并发请求，默认 8 条、合计上限 20 条
    → URL 去重、排名融合、适度分散站点、保留成功部分
  → 浏览摘要，挑选关键来源
  → fetch_url(url, focus?) 读取正文相关片段
  → 必要时补查或 read_web_chunk
  → 流式输出有来源的回答
```

研究策略位于 `web/researchPrompt.ts`，在产品层注入，不与 AgentLoop 或某家 LLM 协议绑定。复杂问题建议 2–3 个互补查询，阅读 2–4 个核心页面；简单问题一个权威来源即可。版本和日期必须核对，通常 1–2 轮，有足够依据即结束。没有强制为每个问题搜索 20 个网页，也没有把网页数量当作答案质量评分。

搜索结果整体 JSON 保持 7000 字节以内，避免超过 Runtime 原有 8192 字节工具结果预算。优先缩短摘要，再裁减无法容纳的结果。相关片段负责帮助挑选页面；关键结论仍须读取正文。单次大结果集合中的摘要会较短，不能据此声称阅读全文。

HTML 提取优先 main/article；focus 在已清洗文本中定位真实连续片段，返回准确 UTF-16 offset，全文缓存可继续分块读取。不是额外调用 LLM 生成网页总结。

## 来源界面

- 回答下方展示叠放站点图标与「N 个网页」胶囊。N 来自本轮成功工具结果的去重 URL，单条消息最多保留 60 个。
- 点击弹出搜索结果列表：域名、可用的发布日期、标题、摘要、序号。日期仅来自供应商真实字段，不拿抓取时间充当发布日期。
- 条目区分「搜索结果摘要」和「已读取网页」。后者仅说明成功取回了有界文本，不表示全文已读完或内容已经证实。
- 点击条目由现有受限 `browser.openExternal` 打开系统浏览器；回答中的已知来源链接变成可定位的编号。Esc、关闭按钮和遮罩可关闭列表。
- 来源元数据跟随消息存入历史；旧历史没有结构化来源时继续显示原链接，不推测或伪造来源列表。
- favicon 由 Main 按需请求同 origin 的 `/favicon.ico`，单次最多 64 KiB、2.5 秒；最多 4 个并发，100 个 origin 缓存。只接受有界 PNG/ICO，转成小 PNG 后传给 Renderer；失败显示域名首字母。没有使用第三方图标聚合服务，也没有放宽 Renderer CSP。

设计依据与截图参见 [UI 设计语言](UI_DESIGN_LANGUAGE.md) 和 [Agent Execution UI](AGENT_EXECUTION_UI.md)。测试截图中的蓝色圆点是合成 favicon。

## 真实网络验证

环境：开发机器 macOS / arm64，直接调用生产 WebSearchService / Provider / WebPageService，不启动截图、不使用私人对话、不调用付费模型。以下是有限样本，不是搜索质量基准或延迟保证。

固定公开查询：

```text
Steam "OS error 0" macOS
site:help.steampowered.com macOS game launch
site:github.com/ValveSoftware macOS "OS error 0"
```

| 2026-09-27 实际执行 | 时间 | 结果 |
| --- | ---: | --- |
| 旧 DuckDuckGo 单查询、5 条（07:21 UTC） | 4318 ms | 成功 5 条 |
| 旧 DuckDuckGo 后续单查询（07:25 UTC） | 3507 ms | 验证/限制错误，无结果 |
| 旧 DuckDuckGo 后续三查询（07:25 UTC） | 4085 ms | 全部失败；未计作成功 |
| Exa 首轮单查询、5 条（07:32 UTC） | 8190 ms | 成功 5 条 |
| Exa 首轮三查询（07:32 UTC） | 5450 ms | 每组 12 条，合并后保留 20 条 |
| 最终 Exa 单查询、5 条（07:35 UTC） | 4477 ms | 成功 5 条 |
| 最终 Exa 三查询，含 GitHub 仓库路径过滤（07:35 UTC） | 7255 ms | 每组 12 条，合并后保留 20 条，无部分失败 |
| 最终首条 GitHub issue 正文读取 | 4409 ms | 下载 42150 字节压缩响应，提取 1347 字节正文 |

最终列表包含 [Valve Dota 2 issue #35489](https://github.com/ValveSoftware/Dota2-Gameplay/issues/35489)、[Steam 启动排查](https://help.steampowered.com/en/faqs/view/5814-D9A3-BE42-62DF) 和 [Stardew Valley 原始讨论](https://forums.stardewvalley.net/threads/game-doesnt-start-on-macos-27-with-steam.55321/)。这里仅证明成功检索到这些页面，不对页面中的解决方案作真实性背书。

人工检查发现：结果中仍包含较旧 macOS 版本的页面，个别站点只提供 challenge 摘要。首轮 site 过滤只保留域名，导致出现其他 GitHub 仓库；已修正为保留仓库路径，并完成最终复测。版本适用性需要 Agent 阅读判别，当前融合算法不是语义相关性重排模型。

首次调试曾把批量查询单请求预算设为 4 秒，实测连原有单查询都需要约 4.3 秒，批量因此超时；最终改为 3 个并发请求、各 8 秒，保留 Executor 10 秒总期限。慢网络仍可能超时，成功部分会保留。上述时间不能证明新入口总是更快；这次主要改进是有效覆盖、来源保存和正文核实能力。

手动复测（默认测试不会联网）：

```sh
node scripts/evaluate-web-search.mjs
node scripts/evaluate-web-search.mjs --duckduckgo
```

脚本打印真实 JSON 结果，不固定条数或时间，不写入用户存储。

## 验证结果与限制

- `pnpm lint`：通过。
- `pnpm build`（含 `pnpm typecheck`）：通过。
- `pnpm test --maxWorkers=1`：36 个文件、542 项全部通过。
- Electron 定向测试 `agent-execution.spec.ts`：通过；来源弹窗、编号定位、浏览器跳转、消息来源保存、未授权 favicon 拒绝、预测/流式/Stop/移交均覆盖。使用合成截图和模拟 SSE，不采集真实桌面。
- 另运行 `desktop.spec.ts`，普通对话等既有窗口流程通过。本次没有运行全套性能或真实截图矩阵。
- Exa 为官方匿名服务，有限额和地区网络可达性限制；Brave/Exa 专用 Key 的真实付费账号未验证。
- 真实网络仅验证上述公开问题；没有用用户真实 LLM 账号进行大规模答案质量评测，没有验证 Windows 实网。不能把模拟 LLM 测试当成所有模型都会遵循研究策略。
- 不支持需登录、依赖 JS 的完整页面、PDF 或长时间深度研究。现有最大步骤、取消、工具/LLM 超时和上下文预算继续有效。

## 主要入口

| 层 | 文件 |
| --- | --- |
| 搜索编排与供应商 | `src/main/agent/web/WebSearchService.ts`、`ExaWebSearchProvider.ts`、`BraveWebSearchProvider.ts`、`defaultSearchProvider.ts` |
| 研究提示与正文定位 | `src/main/agent/web/researchPrompt.ts`、`htmlText.ts`、`relevantExcerpt.ts`、`WebContentStore.ts` |
| 可信来源投影 | `src/main/agent/ui/WebSourceCollector.ts`、`ExecutionPresenter.ts`、`AgentExecutionService.ts` |
| 来源持久化与 IPC | `src/shared/agent/sources.ts`、`source-schema.ts`、`execution.ts`、`src/main/storage/history.ts`、Main / Preload |
| UI | `src/renderer/src/agent/SourceReferences.tsx`、`sources.css`、`AgentExecution.tsx`、`chat/MarkdownMessage.tsx` |
| 图标读取 | `src/main/agent/web/WebIconService.ts` |

本次没有新增依赖，没有改造 AgentLoop 的供应商边界，没有重新发布安装包。
