# Phase 2 批量输出与剪贴板边界

## 已实现

合并复制输出一个 PNG；按收纳顺序纵向排列，最大宽度 800 / 1600 / 2048 / 4096 px，窄图不放大并居中，间距 0 / 8 / 12 / 24 px，白色背景与原图像素保留。解码画布最多 32 Mpx、高 32768 px，编码 PNG 最多 64 MiB。超限报错且原图不变。单张原图逐张读取、解码、绘制后释放，画布 finally 释放。

多文件导出：选择目标目录后新建 Snipvia-随机后缀私有目录，001-稳定ID.png 起按 Collection 顺序命名；选择顺序不覆盖收纳顺序。新建目录避免覆盖已有文件；失败只清理本次目录，保留收纳与原图。取消原生选择框不写文件。清空发生在导出中时，export 引用保护尚在读取的图片。

## 系统契约与应用差异

Apple 的 NSPasteboard.writeObjects 接受实现 NSPasteboardWriting 的对象数组，NSImage / NSPasteboardItem 可表示多个原生对象；这不保证接收软件接受多个独立图片。来源：[Apple writeObjects](https://developer.apple.com/documentation/appkit/nspasteboard/writeobjects(_:))、[NSPasteboardWriting](https://developer.apple.com/documentation/appkit/nspasteboardwriting)。

Electron 当前 clipboard.write 接受 ClipboardItem 数组并原子提交，但接收应用决定如何解释图片、文件 URL 与其他表示，不能据此承诺一次粘贴所有图片。来源：[Electron clipboard](https://www.electronjs.org/docs/latest/api/clipboard)。本阶段产品使用单 PNG 合并兜底，不注入系统按键，不新增原生 Helper 剪贴板协议。

| 接收端 | 本阶段状态 | 可用兜底 |
| --- | --- | --- |
| Finder | 不承诺把多个位图粘贴为文件；未做目标版本实机验收 | 导出 PNG 文件夹后正常拖放/复制文件 |
| 飞书 | 多对象图片粘贴未实测，不标记支持 | 合并 PNG 或从导出目录手动选文件 |
| 微信 | 多对象图片粘贴未实测，不标记支持 | 合并 PNG 或从导出目录手动选文件 |
| Word | 多对象图片/格式选择未实测，不标记支持 | 合并 PNG；必要时插入导出文件 |
| 浏览器输入区域 | 取决于网页 paste 处理与权限；普通文本框不能承载图片 | 支持图片粘贴的输入区使用合并 PNG；否则选择导出文件 |

上述应用逐项端到端验收仍是已知缺口，不将 NSPasteboard 对象读回等同于跨应用粘贴验证。单个合并 PNG 的系统剪贴板读回与真实 Electron 输出在集成测试验证。
