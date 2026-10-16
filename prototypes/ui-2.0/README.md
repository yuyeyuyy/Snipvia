# Snipvia UI 2.0 独立设计原型

阶段 1 评审用。正式 Electron 客户端未接入此目录。推荐从 [设计审查文档](../../docs/UI_2_0_DESIGN_REVIEW.md) 开始阅读。

## 启动

在项目根目录运行：

```bash
node prototypes/ui-2.0/serve.mjs
```

打开 <http://127.0.0.1:3202/>。端口冲突时：

```bash
SNIPVIA_PROTOTYPE_PORT=3203 node prototypes/ui-2.0/serve.mjs
```

只监听本机，无新增依赖。关闭终端或 Ctrl+C 停止。改文件后刷新浏览器；不使用正式 Vite、Electron 或后端端口。

## 演示顺序

1. 顶部审查栏切换 A/B、五个页面和 Light/Dark/System。此工具栏不属于最终软件。
2. 笔记：折叠主导航、文件列表与大纲，切源码编辑，换主题检查草稿；展开文件夹、跳转标题、复制代码；从笔记本菜单演示移除链接。
3. 历史：搜索「括号」，点选记录检查列表仍在；回答下点击已编辑文件、查看变更。
4. 日程：点选日期、换月份，点击条目查看已保存详情；点「从截图创建」演示识别后自动存入当天日程，无待核对步骤。重复点击不会重复创建同一合成条目。仅内存保存，刷新还原。
5. 浮窗：快捷态输入或按 Return，观察「正在理解截图 → 正在编辑文件 → 回复与文件链接」；切换双栏，关闭/复制不会切回主窗口，返回软件会打开历史。
6. 设置：切分类与主题、打开模型配置（刷新在选择左侧）、分支编辑。API Key 字段禁用，请勿填写真实凭据。
7. 顶栏 `⌘K`/`Ctrl+K` 搜索命令；`⌘,`/`Ctrl+,` 打开设置；Esc 关闭弹层。浮窗进行中 Esc 停止，空闲时 Esc 关闭。
8. 「状态」可选空内容、加载、失败、待确认、无会员。待确认适用于历史/浮窗，无会员演示适用于浮窗；其他页保留正常内容。

## 原型边界

- 仅合成的算法学习内容，内存保存，刷新还原；不访问用户实际截图与笔记。
- 没有真实 API、IPC、系统权限/日历或后端调用；不收集 Key。CSP 禁止网络连接。
- 搜索命令、部分编辑/开关可交互；次要操作弹出设计说明。
- 二分查找是完整内容示例，其他记录只演示选择状态，复用合成正文，不作为算法内容验收。
- Markdown 阅读是静态示意；源码和实时预览用 textarea 验证布局，不测试或替换正式 CodeMirror。
- 模型、分支表单和日程自动保存示意不提交真实业务；「保存」不代表磁盘或云端成功。
- 合并浮窗仅为浏览器视觉原型，不代表 Electron 窗口合并已验证。

## 文件

| 文件 | 职责 |
| --- | --- |
| `index.html` | 审查工具栏与独立入口、CSP |
| `app.js` | 五页合成数据与内存交互、主题和状态切换 |
| `prototype.css` | 两种布局、页面/浮窗组件与响应式 |
| `tokens.json` | Light/Dark 与尺寸 Token 唯一源 |
| `generate-tokens.mjs` | 从 JSON 生成 CSS；修改 Token 后运行 |
| `tokens.css` | 生成的 CSS 变量，仅原型使用 |
| `validate-tokens.mjs`、`contrast.json` | 亮暗颜色一致性和 48 组文字对比度验证 |
| `serve.mjs` | 只监听 127.0.0.1 的静态预览服务 |
| `assets/app-icon.png` | 复用项目既有品牌图标，无新图标设计 |
| `AUDIT_INVENTORY.md` | 当前生产 UI 的审查与复用清单 |
| `VALIDATION.md`、`VALIDATION.json` | 浏览器验证证据与未验证范围 |
| `screenshots/` | 合成数据的亮暗预览 |

```bash
node prototypes/ui-2.0/generate-tokens.mjs
node --check prototypes/ui-2.0/app.js
node prototypes/ui-2.0/validate-tokens.mjs
```

本轮无需安装依赖、构建 DMG/EXE、上传 ACR 或修改正式应用。确认设计后再进入第二阶段。
