# 网站图标解析与浏览器角标

日期：2026-10-28。仅修改 `Snipvia-public-baseline`，基于当前未提交的快速切换功能继续开发。未提交、推送、打包发布或改变系统授权。

## 已实现行为

- 开启快速切换后，后台读取已配置网页的公开首页，解析 `icon` / `shortcut icon` / `apple-touch-icon` 声明；支持相对地址、属性顺序与常见 HTML 字符实体。没有声明或读取失败时尝试站点 `favicon.ico`、`apple-touch-icon.png`。
- 只请求 origin 的首页，不发送用户保存网址中的会话路径、查询参数和片段；不带 Cookie、Authorization、Referer，也不执行页面脚本。
- 接受有界 PNG，以及包含 PNG 或未压缩 24/32 位 DIB 的 ICO。图像转换成最多 68px 的 PNG，在原有 34 DIP 图标位展示；不把下载的 HTML、SVG 或任意 URL 交给 Renderer。
- 成功结果在原有 userData 下单独缓存，有效期 7 天。过期先展示旧图，再后台更新；失败在本次进程中退避 1 小时。读取不到时保留原有 OpenAI / DeepSeek 本地图标或通用地球图标。
- 主进程按目标 ID 更新图标，设置页与切换条同步；不重新展示浮条，不改变焦点、候选、忙碌状态或倒计时。截图快捷键、编码、剪贴板提交和目标激活不等待网络。
- 网页图标左下角增加 15 DIP 浏览器角标。Chrome 已有标签模式显示 Chrome；普通打开模式按网址的 HTTP/HTTPS 协议读取系统默认浏览器。浏览器图标在内存中缓存最多 5 分钟，读取失败显示通用浏览器标志。

## 网络与数据边界

网络仅使用标准 HTTP(S) 端口，重定向逐次检查，HTTPS 不降级；拒绝账号密码 URL、回环、常规内网、链路本地、元数据和保留地址。连接使用已检查的 DNS 路由，避免检查后再次解析。公开页面可以声明 CDN 图标，因此站点和对应 CDN 会收到请求 IP 与固定 User-Agent。

当前实际网络把 ChatGPT / DeepSeek 映射到透明代理的虚拟路由（IPv4 `198.18.0.0/15`、IPv6 `2001:2::/48`）。已兼容域名解析中的这两种别名，直接填写这类 IP 的 URL 仍被拒绝。代理模式下网关负责上游解析，客户端不能独立验证网关后的最终 IP；没有通过这个分支放行其他内网或元数据地址。

首页上限 192 KiB，单图上限 256 KiB，每次下载最多 3 次重定向，处理最多 8 个配置目标、并发最多 2 个；请求有空闲超时和 8 秒操作预算。操作系统 DNS 查询本身不可中断，可能在取消后才返回，但返回后不再发起连接，不进入截图同步路径。

`userData/website-icons/` 只保存 origin 的 SHA-256 文件名、时间和小型 PNG；目录/文件使用 0700/0600（Windows 依赖 ACL）。不保存首页、源图标地址或会话网址。关闭功能会取消排队和进行中的任务，保留离线缓存；后续配置包含网页时清理不再使用的衍生缓存，移除全部网页时保留最后的离线副本。缓存损坏、磁盘不可写或网络错误不会改写用户偏好。

详见[隐私说明](../PRIVACY.md#网站图标与浏览器角标)。内置品牌回退继续遵守已有 [MIT 来源声明](../../THIRD_PARTY_NOTICES.md)，运行时网站图标不加入仓库素材或源码分发。

## 文件级修改

| 文件 | 职责 |
| --- | --- |
| `src/main/quick-target/WebsiteIconFetch.ts` | 有界首页/图标请求、DNS 路由验证、重定向、无脚本声明解析 |
| `src/main/quick-target/FaviconImage.ts` | PNG/ICO 结构与尺寸限制、DIB 像素及透明度处理 |
| `src/main/quick-target/WebsiteIconCache.ts` | origin 去重、后台队列、持久缓存、取消和失败退避 |
| `src/main/quick-target/QuickTargetRegistry.ts` | 组合本地缓存图标和对应浏览器角标，保留原有品牌回退 |
| `src/main/quick-target/QuickTargetService.ts` | 在现有展示中仅更新图标数据，保留会话与计时 |
| `native/quick-target-helper/main.swift`、`QuickTargetPlatform.ts` | 只读获取 Chrome / HTTP / HTTPS 默认浏览器图标；参数固定 |
| `src/main/index.ts`、`src/preload/index.ts`、`src/shared/quick-target.ts` | 缓存生命周期、PNG 规范化、设置图标更新通知与可选数据字段 |
| `src/renderer/src/components/QuickTargetIcon.tsx`、CSS | 网站 PNG、原有回退和左下浏览器角标，沿用主题 Token |
| `src/renderer/src/quick-target/QuickTargetBar.tsx`、CSS | 移除旧右下圆点，避免旧 CSS 放大角标图片 |
| `src/renderer/src/settings/QuickTargetSettings.tsx` | 订阅后台图标更新，复用同一组件 |
| `tests/unit/website-icon-{fetch,cache}.test.ts` | 请求边界、声明解析、格式边界、持久化、去重、退避与取消 |
| `tests/unit/quick-target-{registry,service}.test.ts` | 按协议选择浏览器、缓存复用，以及更新图标不重置展示 |
| `tests/integration/quick-target-headless.spec.ts` | 保留原场景，追加角标位置/大小、两处同步及异步替换断言 |

没有新增依赖、改变锁文件、迁移旧设置或修改截图、编辑、收纳和更新安装逻辑。

## 验证结果

- `pnpm lint`、`pnpm typecheck`、`pnpm build` 通过；构建只有原有 Zod 注释告警。
- `pnpm test` 最终 50 个文件、276 项通过；覆盖 DNS 虚拟路由与直接 IP 的区别、内网 DNS 混合返回拒绝、重定向、内容长度、离线、取消、PNG 尺寸及 ICO 透明遮罩。
- 原有 headless 集成测试增加上述场景后最终通过（5.6 秒）。初次失败是主图标 SVG 选择器同时命中新增角标，已改为精确的直接子元素选择器，未删除或跳过有效场景。测试中禁止真实网站请求，数据和截图均为合成。
- macOS arm64 / x86_64 原生编译通过。实际分别请求 Chrome 与系统 HTTP / HTTPS 默认浏览器，均取得有效 68×68 PNG；本机默认浏览器也是 Chrome，因此两张图像相同。无注册浏览器时实现了降级，非法选择参数在实测中被拒绝，未激活浏览器。
- 浏览器常驻协议小消息回归通过，预热约 133ms，3 次无效请求往返为 1/0/0ms；没有查询或激活浏览器，不作为真实跳转性能指标。
- 真实网络：DeepSeek 公开首页读取成功（8547 字节 HTML），解析的 PNG 读取成功（7384 字节），开发实例已产生本地规范化缓存；ChatGPT 这次探测未取得可用图标，保留内置回退，未声称远程读取成功。
- 用户此前确认的截图/跳转速度不重复要求人工验收。Windows、HTTP/HTTPS 配置不同默认浏览器及全屏多屏角标效果未做真机验收。

当前下载解码不支持 SVG、JPEG/WebP、调色板 ICO 或压缩 DIB；会继续尝试其他声明及站点回退地址。要求登录、反爬或网络不可达的网站也可能继续显示本地图标。没有通过请求登录态、执行远程脚本或放宽 Renderer CSP 绕过限制。

## 恢复与运行

修改前源码、已有未提交文件及旧 helper 完整保存在 `.dev-runtime/website-icons/before-20261028-204556/`，包含路径清单与 SHA-256；已有文件在同步前还与临时副本的原始哈希逐项比较。回滚先保全当前新增工作，再恢复该快照对应文件并移除清单标记的新文件；不要使用 `git reset --hard` 或 `git clean`。

缓存为衍生数据，可以在应用退出后单独移除 `website-icons` 目录；不涉及 settings、旧模型密文或历史。开发版继续沿用现有固定 Dev.app 和系统权限，源码通过原 watcher 重载，未修改 Info.plist、App ID、Bundle ID、签名或 TCC。
