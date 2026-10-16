# Agent 命令与脚本

更新：2026-10-06。当前源码已接入 `run_command` 与 `run_script`，由模型通过现有 Tool Calling 循环调用。macOS 原生命令与 Electron 内置 Node 路径已使用临时笔记本验证；Linux 后端尚未真机验收，依赖 bubblewrap 等系统组件；Windows 暂不开放，返回 `SANDBOX_UNAVAILABLE`。旧安装包需重新构建。

## 使用方式

在截图对话中选择笔记本，使用支持 Tool Calling 的模型，然后提出具体任务，例如：

> 创建「算法题目」目录，把二分查找和栈的笔记移进去；运行一个小脚本验证二分查找的边界，再把结果整理进笔记。

Agent 可以自行调用命令，不需要用户手动创建父目录。是否需要用户确认见下文「审批规则」。未选择笔记本时不向模型提供命令工具。明确输入「不要写入笔记」或「只读」时，本轮命令沙箱也改为只读；仍可以执行计算，并使用随调用清理的临时目录。

执行中底部状态行显示「正在执行命令」或「正在运行 JavaScript / Python / Shell 脚本」；完成后，命令作为一行进入对话时间线，显示命令文本、退出码与耗时，不显示中间输出。Main 把 stdout、stderr、退出码返回模型；Agent 必须等待进程退出，再作最终回复。Markdown 的实际新建、编辑、移动和删除合并到回复下方的笔记清单，移动显示旧路径到新路径，点击打开新位置。删除项不可打开，但可以查看差异。停止或命令报错后，已发生的文件变更仍显示，不会自动撤销。

![执行命令时的状态行](ui/agent-command-inline.png)

![命令后的实际笔记变更](ui/agent-command-changes.png)

## 审批规则

更新：2026-10-07。编辑选定笔记、检索和联网不需要确认；执行脚本以及可能修改环境变量、系统设置的命令必须由用户确认。规则由 Main 的 `permissions/NotebookCommandPolicy.ts` 判定，Renderer 和模型都不能改变结果。

| 情况 | 行为 |
| --- | --- |
| 字面只读命令：`ls`、`pwd`、`cat`、`head`、`tail`、`wc`、`grep`、`find`（不带 `-exec`/`-delete` 等）、`tree`、`stat`、`diff`、`echo` 等，参数均为笔记本内相对路径 | 直接执行 |
| 笔记本内整理：`mkdir`（仅 `-p`/`-v`）、`touch`、`mv -n`、`cp -n`，不涉及隐藏文件或目录 | 直接执行，视同编辑选定笔记本 |
| 以上命令用 `&&`、`\|\|`、`;`、`\|` 连接 | 每一段都满足上两行时直接执行 |
| `run_script`（JavaScript、Python、Shell） | 每次都需要确认 |
| 重定向写入、变量展开、命令替换、通配符、heredoc、后台执行、不带 `-n` 的 `mv`/`cp`、删除及其他未列出的命令 | 需要确认 |
| `export`、环境变量赋值、`launchctl`、`defaults write`、`sudo`、`crontab`、`chmod`，以及涉及 `.zshrc`、`/etc/`、`LaunchAgents` 等 | 需要确认，并标注「可能修改环境变量或系统设置」 |

需要确认的请求为 `DANGEROUS`：只提供「拒绝」和「运行」（单次），没有始终允许；会话授权也只匹配完全相同的参数，界面不提供。确认卡片嵌在对话时间线中，显示完整命令或脚本、原因和工作目录；回车不会批准，拒绝在左、运行在右。审批有 5 分钟有效期，等待时间不计入 10 秒执行超时。用户拒绝时工具返回 `APPROVAL_DENIED`，不启动进程，模型被要求不要换写法重试同一操作。

免确认只是审批策略，不是安全边界：所有命令仍在 OS 沙箱中运行，不联网、不能写笔记本外的文件、不继承应用密钥。静态分析判断不了的命令一律交给用户确认，而不是直接拒绝。

![脚本运行前的行内确认](ui/agent-command-approval.png)

## 工具协议

`run_command` 支持 Bash 命令链、管道、重定向和 heredoc。各调用没有持久 shell 会话，默认从笔记本根目录开始。`cwd` 只允许当前笔记本内的相对目录；创建或移动前应检查冲突，移动优先 `mv -n`。

```json
{
  "command": "mkdir -p '算法题目' && mv -n '二分查找.md' '算法题目/二分查找.md'",
  "cwd": ".",
  "timeoutMs": 10000
}
```

`run_script` 支持 `javascript`、`python` 和 `shell`。脚本通过标准输入交给解释器，不把代码拼入 shell 参数。

```json
{
  "language": "javascript",
  "code": "import { writeFileSync } from 'node:fs';\nconst result = [1, 3, 5].indexOf(3);\nconsole.log(result);\nwriteFileSync('算法题目/验证.md', '# 算法验证\\n返回 ' + result + '。\\n');",
  "cwd": ".",
  "timeoutMs": 10000
}
```

JavaScript 使用 Electron 自带的 Node，不要求另装 Node。Python 使用电脑已有的 `python3`；macOS 优先实际安装的 Homebrew / Command Line Tools 解释器。没有可用 Python 时应改用 JavaScript，不自动下载解释器或依赖。

成功结果含 `exitCode`、`stdout`、`stderr`、取消/超时/截断标记、`noteChanges`、新建及移除目录。失败也可以包含这些实际结果：非零退出不代表文件没有改变。界面修改列表来自 Main 的文件核对，不采信命令打印的 JSON 或模型声称的修改。

## 执行边界

- 笔记本由用户选择，Main 生成不可伪造的运行能力；模型不能通过参数选择其他目录、环境变量或关闭沙箱。每次执行前刷新会员资格，等待编辑器保存，并重新核对笔记本登记、目录身份和 cwd。
- 使用固定版本 `@anthropic-ai/sandbox-runtime@0.0.78` 的 OS 沙箱：macOS Seatbelt、Linux bubblewrap。沙箱初始化失败时拒绝执行，不退回普通进程。
- 可持久写入的范围只有当前笔记本；另提供私有临时 HOME/TMP。系统解释器与运行库可以读取，其他用户目录、应用数据、凭据目录和敏感文件不可读取。笔记本内 `.env`、`.ssh`、`.aws`、`.git`、私钥等受到额外保护；包含硬链接的笔记本拒绝执行，符号链接不能扩大 OS 访问范围。
- 不继承 Main 的 API Key、SMTP、账号令牌、`NODE_OPTIONS` 或 `BASH_ENV`。命令不允许联网、Unix socket 或 Apple Events；联网检索继续使用已有受限 Web 工具。
- 一次只运行一个命令；输入最多 64 KiB，单次最多 10 秒，模型可降低到 100ms。限制 CPU 时间、打开文件数与单文件大小；内置 JavaScript 堆上限 256 MiB。这些限制不构成所有进程总内存或总磁盘配额。
- stdout / stderr 各保留前 16 KiB；合计输出超过 1 MiB 时终止进程。模型反馈进一步受 Runtime 8 KiB 预算约束，保留退出结果和截断说明；实际笔记清单通过独立的可信事件传递，不随输出截断丢失。
- 取消、超时或资格/工作区撤销时终止普通进程组，等待实际退出再记录变更并清理临时目录。暂不支持 PTY、交互程序、后台服务、跨调用进程会话；不能将此机制描述为任意守护进程隔离或绝对防逃逸保证。

命令可以修改笔记本内的普通文件和附件；界面目前汇总 Markdown，`assets/` 附件不会显示在笔记清单。命令移动不会自动调用 NotebookService 的 Wiki 链接改写，Agent 应按任务检查和更新相关引用。笔记专用工具仍提供原子提交和冲突检查；任意 shell 命令本身没有跨文件事务、回滚或同等并发冲突保护。

Main 文件核对最多 10000 个条目、40 层目录，最多读取 8 MiB 文本、单篇 256 KiB；每轮清单最多 100 篇。较大 Markdown 只报告元数据，差异标记截断。超出目录范围上限时拒绝开始；执行后无法完整核对时明确提醒用户刷新检查。隐藏文件和附件不读取正文。

## 实现与开源参考

执行结构参考 [OpenAI Codex](https://github.com/openai/codex) 的本机工具循环，OS 隔离直接采用 [Anthropic sandbox-runtime](https://github.com/anthropics/sandbox-runtime)。这不是把 Codex CLI 或其账号接入应用，模型仍使用用户配置的兼容接口。

| 文件 | 职责 |
| --- | --- |
| `commands/registerCommandTools.ts` | 严格 Schema、模型描述与执行意图 |
| `commands/CommandRunner.ts` | Main 能力、资格/保存检查、真实执行和结果 |
| `commands/ProcessSandbox.ts` | 原生隔离计划、干净环境、输出上限和进程组终止 |
| `commands/CommandFiles.ts` | 不跟随链接的有界文件核对、移动与差异 |
| `notes/NotebookWriter.ts` | 命令与专用笔记工具共享修改 id、净差异和打开权限 |
| `AgentLoop.ts` / `ContextManager.ts` | 等待工具结果、模型反馈与可信变更事件 |
| `ui/AgentExecutionService.ts` | 按当前笔记本和只读意图创建运行能力 |

## 验证

`tests/unit/agent-commands.test.ts` 使用真实系统沙箱和临时文件，涵盖中文路径、命令链/管道、三种脚本、敏感环境、外部读写、网络、只读、cwd、软硬链接、取消、超时、输出上限、严格参数、资格检查、沙箱失效拒绝及混合笔记变更。

`tests/integration/agent-commands.spec.ts` 启动真实 Electron，使用合成截图与模拟模型，验证整理命令免确认、脚本先行内确认（回车不批准）、系统命令和应用自带 Node 确实执行、状态行与时间线、先执行再回复、取消后变更清单、差异预览、点击打开与历史保存。测试不执行用户笔记里的脚本，也不依赖真实模型 Key。

本次结果：20 项命令单元用例通过；完整单元测试 726 项通过，Electron 18 项通过、10 项真机/特定环境用例跳过。Lint、类型检查、构建通过。另在临时打包的 macOS 应用中验证 ASAR 依赖、真实命令和应用自带 Node，1 项安装包检查通过；使用本机合成能力，不登录生产账号。

安装包验证还发现首次启动没有会话文件却先初始化系统密钥库可能阻塞。AccountSessionStore 现在先检查已有会话文件，再验证加密能力；不改已有会话的加密要求。新增用例及真实账号登录/恢复回归通过。
