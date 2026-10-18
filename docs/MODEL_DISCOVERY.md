# 模型目录与能力识别

文档与官方协议核对日期：2026-10-09。本次是桌面客户端增量开发，未修改服务端预测链路或已有模型推理流程，没有新增依赖。当前 GitHub v0.2.1 安装包尚不包含这些源码变更。

## 实现前审查

| 可复用模块 | 原有职责 | 本次处理 |
| --- | --- | --- |
| `src/shared/providers.ts` | 厂商预设、接口白名单、凭据作用域、模型标签 | 保留 9 家官方厂商，移除四家入口；兼容旧配置与密钥作用域 |
| `src/main/storage/settings.ts` | safeStorage 加密 Key、按厂商及接口保存配置 | `readKey(scope)` 读取指定作用域，原无参数调用仍然有效 |
| `src/shared/contracts.ts`、`src/preload/index.ts`、`src/main/index.ts` | IPC 类型、窄桥接、窗口鉴权与设置保存 | 增加目录、手动添加、图片验证三个 IPC；只允许主窗口调用 |
| `src/renderer/src/settings/SettingsPanel.tsx` | 分组行配置弹窗、保存并使用 | 将刷新与图片模型列表整合进同一行，移除下方目录表 |
| `src/main/ai/provider.ts`、`src/main/ai/llm/` | 截图、分类、日程、Agent 与流式回答 | 复用原 Chat Completions 业务流程，未改动源文件 |
| `src/main/ai/chat-completion-options.ts` | 厂商非思考与采样参数 | 图片测试复用已有参数，不修改原调用行为 |

原实现没有模型动态查询、能力三态记录或能力缓存，因此新增 `ModelCatalog`，而非创建第二个配置 / 凭据 Service。适配器统一实现 `ModelProviderAdapter.list/parseModel`；厂商特有格式在适配器内归一化，共用 HTTP、缓存及 UI。

## 官方目录与识别字段

下表的“已接入”指代码与 Mock 协议测试完成，不代表真实账号可用、Key 已通过鉴权或模型能完成截图任务。所有接口都直接访问用户选择的平台，不借助其他厂商代理或第三方模型数据库。

| 厂商 | 模型列表获取方式 | 自动能力字段 / 文档证据 |
| --- | --- | --- |
| [OpenAI](https://developers.openai.com/api/reference/resources/models/methods/list) | `GET https://api.openai.com/v1/models`，Bearer | 原生列表仅提供 ID 等基础信息；GPT-6.1 Sol、GPT-6 Astra / Luna / Sol 与 GPT-4.1 / mini 使用官方模型页的精确映射，未覆盖 ID 保持 unknown |
| [Anthropic Claude](https://platform.claude.com/docs/en/api/models/list) | `GET https://api.anthropic.com/v1/models`，`x-api-key`、`anthropic-version`；`after_id` 分页 | `display_name`；`capabilities.image_input.supported`、`thinking.supported`、`structured_outputs.supported`。`server_tools` 不等同于客户端 Function Calling |
| [Google Gemini](https://ai.google.dev/api/models) | 原生 `GET https://generativelanguage.googleapis.com/v1beta/models`，`x-goog-api-key`；`nextPageToken` 分页 | `displayName`、`supportedGenerationMethods`、`thinking`；生成方法不代表图片能力。[Gemini 3.8 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash)使用精确文档映射 |
| [xAI Grok](https://docs.x.ai/developers/rest-api-reference/inference/models) | `GET /v1/models` 获取账号目录，再以 `/v1/language-models`、`/v1/image-generation-models` 补充模态；Bearer | `input_modalities`、`output_modalities`、`capabilities.reasoning_effort`；以明确 `aliases` 匹配目录。图片生成专用目录确认生成能力；Grok 4.3 / latest 补充精确文档映射 |
| [阿里云百炼 Qwen](https://help.aliyun.com/zh/model-studio/list-models) | 业务空间专属域名、新加坡 / 香港同一 origin 的 `GET /api/v1/models`；Bearer；`page_no/page_size` 分页 | `output.models[].model/name`、`inference_metadata.request_modality/response_modality`、`capabilities` 中 `VU/IG/ASR/Reasoning`、`features` 中 `function-calling/structured-outputs` |
| [DeepSeek](https://api-docs.deepseek.com/api/list-models/) | `GET https://api.deepseek.com/models`；Bearer | `name`、`input_modalities`、`output_modalities`、`effort.supported_levels`；工具与 JSON 输出补充[官方文档映射](https://api-docs.deepseek.com/quick_start/pricing/) |
| [智谱 GLM](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-4.6v) | 通用 API Key 的动态目录协议尚未核实；采用官方维护清单，可手动 ID | GLM-4.6V / FlashX / Flash 的图片、视频、推理、工具能力来自精确文档映射，未覆盖型号保持 unknown |
| [月之暗面 Kimi](https://platform.kimi.com/docs/api/list-models) | 国内 / 国际所选 Base URL 的 `GET /v1/models`；Bearer | `supports_image_in`、`supports_video_in`、`supports_reasoning` 布尔字段；缺失保留 unknown。[K2.6](https://platform.kimi.com/docs/guide/kimi-k2-6-quickstart)使用精确文档补充 |
| [火山方舟 Doubao](https://docs.volcengine.com/docs/82379/1330310?lang=en) | API Key 配置采用官方维护清单；[基础模型版本管理接口](https://docs.volcengine.com/docs/ark/list-foundation-model-versions-api?lang=zh)需要 Access Key 签名，本次不索取另一套密钥 | 两个既有 Seed 2.0 型号使用文档映射；`ep-…` 是不透明接入点，能力不从基础模型或名称继承 |

百炼北京旧通用 Base URL `https://dashscope.aliyuncs.com/compatible-mode/v1` 保留，不猜测新目录地址，也不会把 Key 转发到另一个地区。需要动态目录时，在“接口来源 → 百炼业务空间专属地址”填写控制台提供的完整 Base URL。千问平台已有配置继续可用，未核实目录协议时同样采用维护清单。

百度千帆、腾讯混元、硅基流动和 OpenRouter 的厂商入口已移除。历史配置仍按原作用域读取加密密钥，界面统一显示为自定义服务；不自动改动其地址、模型、Key，也不把 Key 转发给其他厂商。用户编辑历史接口地址时，改为新的自定义作用域并清空未保存的 Key。新自定义服务查询用户指定 Base URL 的 `/models`，未知能力不进入图片模型下拉框。

## 能力规则与未能识别的范围

`ModelCapabilities` 包含文本输入、图片理解、图片生成、视频理解、音频输入、工具调用、深度推理、结构化输出八项，每项为 `supported / unsupported / unknown`。

证据优先级为明确官方 API 字段 → 精确 ID 官方文档映射 → 用户触发的实际验证。每项已知能力都有证据来源和时间。API 字段缺失或为 null 不推导为 false；包含 `vl`、`vision`、`reasoning` 的名字也不作为证据。完整模态数组只有文本时可以明确排除图片；空数组或新模态值本身不能判断。

尚未自动确认的情况：

- OpenAI 普通列表没有能力字段；未维护的型号、别名、微调 ID 不继承已知型号能力。
- Claude Opus 5.5 的图片和推理由官方模型页补充；原生目录的服务端工具字段不能证明客户端 Function Calling，音频 / 视频等缺失字段也不作否定。
- Gemini 的 `generateContent` 不能证明图片、音频、视频或生成图片；精确文档没有覆盖的新模型可测试图片。
- 智谱、方舟的现有 API Key 配置采用文档清单，只覆盖已核实 ID，不声称枚举了账号全部可用模型。
- 接入点 ID、自定义服务和其他未维护 ID 默认 unknown；不透明接入点只能通过调用验证其图片能力。
- 图像编辑 / 生成模型接受图片作为条件，不自动等同于能用文字解释图片。模态输出只有图片时不据此确认图片理解。
- 结构化输出是模型的 JSON / 结构化能力标记，不保证每家使用相同 JSON Schema 参数或支持相同严格程度。

图片测试与官方字段冲突时保留高优先级官方证据，同时保留真实测试结果，避免把权限、错误端点或账号策略当作模型本身能力变化。手动 ID 的验证结论只适用于该厂商、接口、Key 和模型组合。

## 使用步骤与 UI

1. 打开“设置 → 模型配置 → 配置…”，选厂商 / 接口，填写原始 Key。输入停顿后查询目录；模型下拉框左边的刷新图标可强制重新获取。
2. 下拉框直接使用目录结果，仅列出 `vision=supported` 的模型。未知和明确不支持图片的条目保留内部三态，不出现在可选图片模型中。原下方目录表、筛选及测试操作区已移除。
3. 刷新不切换当前模型，失败保留同一凭据下的原列表并就地提示。更换厂商、接口或 Key 后立即隔离旧列表；延迟响应不串入另一配置。成功列出模型并不等于账号实际调用成功。
4. “手动填写模型 ID…”保留原手动输入能力，适用于 `ep-…` 接入点、自定义服务或尚未收录的 ID；手动输入不自动证明图片能力，也不作为已确认模型插入列表。
5. 选择模型仍需“保存并使用”。[GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol)、[GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra)、[GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna)、[GPT-6 Sol](https://developers.openai.com/api/docs/models/gpt-6-sol)使用官方精确 ID 与图片输入文档映射。全新配置默认 GPT-6.1 Sol；已保存的 GPT-4.1 等配置不会被自动替换。
6. 无 Key 或没有已核实目录协议时使用官方文档维护清单；有动态目录时以返回的账号列表为准，不将未返回的预设混入结果。

### 保留的图片验证服务

本次移除目录 UI 后，主进程验证接口与既有验证记录继续保留，不会自动发起收费请求。调用该接口仍需要系统原生费用确认，默认取消；当前配置界面不再提供单独的测试区。

图片测试：固定 64×64 PNG，仅含红、蓝、白色区域，不读取用户截图、文件、笔记或聊天。Claude 使用原生 Messages 的 Base64 image，Gemini 使用原生 generateContent 的 inlineData，其余使用官方 Chat Completions image_url / data URI。正确识别两个区域才判定测试通过；HTTP 200、空回复、格式错误或错误颜色都不足以确认。

测试结果区分鉴权、权限、余额 / 额度、限流、网络 / 服务不可用、模型不可用、请求格式和无法确认。只有 HTTP 400/422 且服务明确拒绝图片输入时记录 unsupported；图片损坏、尺寸限制或 `max_tokens` 参数错误保留未知。原生确认也在 Main 完成，Renderer 伪造 `confirmCost` 不能绕过系统费用提示。

## 缓存与安全

- `userData/model-catalog.json`：目录修订号变化时自动更新，保留手动 ID / 验证记录；24 小时 TTL、本机缓存、手动模型和验证结果；刷新绕过 TTL。刷新失败显示旧缓存及过期 / 错误提示，无旧缓存时明确报错。
- 缓存按 `provider:endpoint` 与 Key 指纹隔离。更换 Key 不继承另一账号的目录或验证结果；最多 32 份、每份 3000 个动态 / 300 个手动或验证条目，总文件限制 16 MB。损坏缓存可重建。
- Key 仍仅由 Main 的 safeStorage 保护；可在保存前用输入中的 Key 查询，目录模块不会另存 Key。缓存、IPC 返回值和提示不包含 Key 或上游响应正文；模型 ID / 名称反射 Key 时丢弃。
- 官方接口按预设白名单和明确的业务空间域名校验，自定义服务只使用用户指定地址。HTTP 禁止重定向、30 秒超时、4 MB 响应上限、最多 30 页；不自动切换其他厂商或地区。
- 目录最多四个不同作用域并发查询，同一作用域请求去重；同一客户端一次只执行一个图片测试。没有自动付费探测、自动重试或批量收费测试。
- 缓存和模型能力不会上传 Snipvia 控制台。当前可选 Jev 图片预测由客户端直连并使用独立凭据，不经过此聊天模型目录，见 [Jev 图片预测](JEV_PREDICTION.md)。

## 修改清单

新增：

- `src/shared/models.ts`：统一三态结构、证据、目录 / 测试 IPC Schema。
- `src/main/ai/models/adapters.ts`：统一适配器与官方格式归一化。
- `src/main/ai/models/catalogue-mapping.ts`：带来源与核对日期的精确 ID 映射。
- `src/main/ai/models/http.ts`：受限网络请求与脱敏错误边界。
- `src/main/ai/models/vision-test.ts`：固定图片、原生 / 兼容请求、结果分类。
- `src/main/ai/models/ModelCatalog.ts`：目录、缓存、手动 ID 与验证记录。
- `src/renderer/src/settings/ModelSelectRow.tsx`：现有配置弹窗内的模型下拉框与左侧刷新按钮，替代原目录表格。
- `tests/unit/model-catalog.test.ts`、`tests/integration/model-catalog.spec.ts`：Mock 协议与桌面 UI 验证。

修改：`providers.ts`、`contracts.ts`、`storage/settings.ts`、`main/index.ts`、`preload/index.ts`、`SettingsPanel.tsx`、`refined.css`；原厂商预设 / 凭据 / 请求测试扩展；README、目录与设计语言同步。

## 验证与遗留问题

2026-10-09 本轮：Lint、类型检查、构建与 917 项单元测试通过。目录测试覆盖 GPT-6 精确映射、旧缓存升级、API 证据优先级以及移除厂商后的配置兼容。4 项 Electron 验收通过，覆盖下拉框直接刷新、仅图片模型筛选、失败保留列表、跨厂商延迟响应隔离、缓存、手动接入点、原 DeepSeek 截图 Agent 和完整设置 / 自定义接口 / 截图对话回归。视觉截图：[模型选择（Mock）](ui/client-model-catalog.png)。

原推理上下文算法未修改，GPT-6 目前仍使用已有保守预算，不因新增目录而扩大上下文或改变请求参数。

测试只使用 Mock 响应、合成 Key、合成图片及临时存储；未使用真实 API Key，不宣称完成任一厂商的真实接口调用验证。Windows 真机、各地区账号、余额、套餐限制与模型下线情况仍需用户实际验收。新模型进入目录不代表已完成所有流式、工具参数或长对话兼容性实测。本轮没有重新发布安装包或云端镜像。

## 推荐 DeepSeek

截图问答与算法笔记可优先配置 `DeepSeek → deepseek-flash`。当前[官方图片输入文档](https://api-docs.deepseek.com/guides/vision/)提供直接图片调用，[官方目录](https://api-docs.deepseek.com/api/list-models/)返回模态和推理元数据，方便动态确认；现有客户端继续采用非思考参数保存可见文本历史。配置后用算法截图与工具写笔记验证真实调用。DeepSeek V4 Pro 仍按当前文档作为纯文本模型，不推荐用于截图输入；原截图配置限制继续保留。
