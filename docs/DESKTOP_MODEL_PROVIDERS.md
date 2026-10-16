# 客户端模型厂商

更新日期：2026-10-09。当前的动态模型目录、9 个官方厂商、能力三态与图片筛选规则见[模型目录与能力识别](MODEL_DISCOVERY.md)。下文记录原有预设与调用协议，仍然复用。

当前入口为 OpenAI、Anthropic Claude、xAI Grok、通义千问、Google Gemini、DeepSeek、Kimi、智谱、豆包与自定义服务。百度、腾讯、硅基流动和 OpenRouter 不再作为厂商入口；其历史配置统一显示为自定义服务，内部保留原凭据作用域以避免丢失或串用密钥。

## 使用方式

1. 打开标题栏的设置，点击「配置…」，选择模型厂商。
2. 有多个接口来源时，选择与 API Key 对应的平台或地区。API 地址自动显示；百炼业务空间地址可手动填写。
3. 点击模型下拉框左侧的刷新图标，结果直接进入下拉框，只显示已确认支持图片理解的模型；或在「手动填写模型 ID…」输入账号可用的视觉模型 / 推理接入点 ID。Agent 还需要该模型支持 Function Calling。
4. 填写此接口的原始 API Key，点击「保存并使用」。留空保留该接口的旧 Key，切换厂商或接口不会把输入中的 Key 带过去。
5. 已配置项可在设置页及对话输入框切换。通常只显示模型 ID；同名配置出现多个来源时增加厂商 / 接口后缀，避免选错凭据。

各厂商和接口的凭据按 `provider:endpoint` 独立保存，继续由 Main 和 Electron `safeStorage` 保护。新厂商无需新增服务端数据库或本机模型进程；已保存配置保留原模型和凭据作用域；全新安装的 OpenAI 默认模型更新为 GPT-6.1 Sol。

## 预设接口与模型

以下是无 Key / 目录协议未核实时的图片模型预设；配置 Key 后刷新会优先使用账号动态列表。模型权限、地区、套餐和下线情况仍以厂商控制台为准。

| 厂商 | 默认 Base URL | 图片模型预设 |
| --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | `gpt-6.1-sol`、`gpt-6-astra`、`gpt-6-luna`、`gpt-6-sol`；保留 GPT-4.1 兼容项 |
| Anthropic Claude | `https://api.anthropic.com/v1` | `claude-opus-5-5` |
| xAI Grok | `https://api.x.ai/v1` | `grok-4.3-latest` |
| 通义千问 | 原百炼北京地址保留；可选千问平台、新加坡、香港及业务空间地址 | 原 Qwen3.8 / Qwen VL 模型保留，新增 `qwen3-vl-plus`、`qwen3-vl-flash` |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-3.8-flash` |
| DeepSeek | `https://api.deepseek.com` | `deepseek-flash`；阻止将不支持图片的 `deepseek-v4-pro` 保存为截图模型 |
| Kimi | `https://api.moonshot.cn/v1`，可选国际平台 `https://api.moonshot.ai/v1` | `kimi-k2.6` |
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4`，可选 Z.AI 国际平台 | `glm-4.6v`、`glm-4.6v-flash` |
| 豆包 | `https://ark.cn-beijing.volces.com/api/v3` | `doubao-seed-2-0-lite-260428`、`doubao-seed-2-0-mini-260428`；可手填 `ep-` 接入点 |
| 自定义服务 | 用户填写 | 用户填写支持图片的 Chat Completions 模型 ID |

千问平台为 `https://maas.qianwenaiapi.com/compatible-mode/v1`。百炼地区与业务空间地址必须对应其 Key；不能因为服务器在新加坡就自动选择新加坡接口。切换来源时若模型在该来源不可用，应选择账号可用的模型。

## 协议与验证边界

所有预设复用 Chat Completions 的 `image_url`、Bearer 鉴权、流式文本与 Function Calling，图片使用选中区域的内嵌 JPEG，不增加文件上传或其他视觉厂商兜底。厂商参数集中在 `src/main/ai/chat-completion-options.ts`，普通问答、分类、日程提取与 Agent 共用：

- DeepSeek Flash、Kimi K2.6、GLM-4.6V、豆包关闭思考模式，避免多轮工具历史缺少厂商要求的思考内容。
- Kimi K2.6 的非思考模式使用其固定温度 0.6；本地分类不会传入不被支持的温度 0。
- Qwen3-VL 关闭思考，原 Qwen3.8 继续关闭思考与历史思考保留。
- OpenAI、Gemini 与自定义兼容服务不自动附加其他厂商的参数。自定义模型的额外能力不会仅凭名字推断。

预设没有加入 Kimi K3 / K2.7 等必须保留思考历史的模型；手填其他模型不代表已完成其特有协议适配。未对未知模型做额外图片代理，纯文字模型不能由切换厂商自动获得视觉能力。未知能力和明确不支持图片的模型不会进入图片模型下拉框；手动 ID 仍可输入，不根据名字猜测能力。

协议测试使用模拟厂商响应、临时账号与合成截图，覆盖图片、鉴权隔离、工具消息、非思考参数、配置恢复和错误保护。真实厂商 Key、额度、地区及模型实际效果需要使用者配置后验证。

2026-10-06 验证通过：767 项单元测试、厂商配置 / 原桌面截图 / Agent 接续共 3 项 Electron 验收、Lint、类型检查及构建。新增桌面验收实际经过设置弹窗保存、同厂商跨接口切换、DeepSeek 图片请求与 Agent 回答；请求使用模拟响应，不发往正式厂商。配置截图见 [DeepSeek](ui/client-provider-deepseek.png) 与 [千问平台](ui/client-provider-qwen-platform.png)。

## 与服务端预测的区别

客户端厂商用于预测后实际回答、Agent 整理笔记、手动提问，以及后台未提供预测时的客户端分类。网页控制台的视觉理解 → Jev 是独立链路，继续使用管理员保存的服务端模型与密钥；本次只更新客户端，无需更换服务器镜像。

本文不改变服务端只保存累计预测次数的规则。历史聚合平台配置若继续以自定义服务使用，仍按其原接口发送，不会转换为模型原厂直连。

## 官方协议依据

- [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol)、[GPT-6 系列](https://developers.openai.com/api/docs/models)、[OpenAI 图像输入](https://developers.openai.com/api/docs/guides/images-vision)、[Gemini OpenAI 兼容接口](https://ai.google.dev/gemini-api/docs/openai)。
- [千问平台 API Key 与 Base URL](https://platform.qianwenai.com/docs/api-reference/preparation/api-key)、[百炼视觉兼容接口](https://www.alibabacloud.com/help/en/model-studio/qwen-vl-compatible-with-openai)。
- [DeepSeek 图片输入](https://api-docs.deepseek.com/guides/vision/)、[Chat Completions 参数](https://api-docs.deepseek.com/api/create-chat-completion/)。
- [Kimi K2.6 参数与图片输入](https://platform.kimi.ai/docs/guide/kimi-k2-6-quickstart)、[模型参数差异](https://platform.kimi.ai/docs/api/models-overview)、[国内 API 接口](https://platform.kimi.com/blog/posts/kimi-api-quick-start-guide)。
- [GLM-4.6V 图片与工具调用](https://docs.z.ai/guides/vlm/glm-4.6v)、[GLM 请求参数](https://docs.z.ai/api-reference/llm/chat-completion)。
- [火山方舟 Chat API](https://docs.volcengine.com/docs/ark/chat-api)、[模型迁移与思考参数](https://docs.volcengine.com/docs/ark/model-deprecation-migration-guide)。
- [硅基流动多模态输入](https://docs.siliconflow.cn/docs/userguide/capabilities/multimodal-vision)、[模型更新公告](https://docs.siliconflow.cn/docs/release-notes/overview)。
- [OpenRouter 兼容接口](https://openrouter.ai/docs/quickstart)、[图片输入指南](https://openrouter.ai/blog/tutorials/send-image-to-llm/)。
