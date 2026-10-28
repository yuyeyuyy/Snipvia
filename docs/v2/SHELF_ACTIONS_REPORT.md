# 收纳区阴影与复制交互改造

## 实现行为

- 修复阴影硬截断：旋转后的完整图堆轮廓适配布局，原图预览也保留 24 DIP 留白；图片阴影反向补偿父级缩放。滚动边缘和原生窗口边缘只做透明度过渡，收起动画经过边界时也不会突然切断阴影。
- 收起时移除“张截图 · 点击展开”和像素尺寸入口；拖动左下角调整大小及原有偏好文件保留，展开后仍可精确设置尺寸。
- 收起、展开都使用同排三个图标：全部复制、合并复制、导出 PNG。保留悬浮标题及无障碍名称；点击图堆或顶栏展开图标即可展开。
- 全部复制一次提交多个独立原图条目，始终复制全部收纳内容；多选仍只影响合并和导出。
- 单张复制、全部复制、合并复制、导出成功后，仅对应按钮显示对号，1000ms 后恢复。取消导出不显示成功；错误继续显示，按钮可以重试。重复点击和卸载时的定时器清理均在共享组件处理。

## 文件范围

| 文件 | 改动 |
| --- | --- |
| src/main/storage/CollectionClipboard.ts | 原图单次复制、顺序和来源引用生命周期 |
| src/main/index.ts | Shelf 专用 copy-all IPC，严格参数和 revision 校验 |
| src/preload/index.ts、src/shared/collection.ts | 新增窄接口；共享阴影留白和旋转适配几何 |
| src/main/windows/ShelfWindow.ts | 飞入目标沿用新的内容起点，截图入口不变 |
| src/renderer/src/collection/ShelfActionButton.tsx | 按钮内成功状态、取消/异常、重复点击及定时器清理 |
| src/renderer/src/collection/ScreenshotShelf.tsx | 图标工具条、成功反馈、收起入口和原图预览留白 |
| src/renderer/src/collection/shelf.css | 固定视觉阴影、边缘透明过渡及按钮布局 |
| tests/unit/collection-clipboard.test.ts | 原始字节/顺序、单次提交、异步引用和异常保全 |
| tests/unit/collection-geometry.test.ts | 最小尺寸、横/竖/方形图堆的旋转后阴影边界 |
| tests/unit/monochrome.test.ts | 仍禁止装饰性渐变和图片灰度，区分仅透明度遮罩 |
| tests/integration/shelf-column-headless.spec.ts | 原图复制、按钮反馈、取消/失败、尺寸和透明边缘 |
| tests/integration/transparent-shelf.spec.ts、v2-continuous.spec.ts、capture-opacity-real.spec.ts | 适配本次移除的入口和成功反馈，保留原有行为断言 |

图标复用已有 Icon；没有新增依赖，未改变快捷键、主题、截图持久数据或应用身份。尺寸和收纳业务接口保持兼容，仅新增 copyAll。Main 六个截图关键函数逐一提取 AST 源文本比较，SHA-256 与开工前一致；原生 Helper、CaptureOverlay、输出队列及编码 Worker 均未改动。

## 验证

- Lint、类型检查及单元测试：38 个文件、195 项通过。
- 最终离屏专项 1 项通过（9.3 秒），保留全部断言；此前同一业务源码的完整流程亦通过（9.5 秒）。测试加入退出前停止 offscreen 绘制的资源清理及阶段日志，不修改生产退出逻辑。
- 指定工作区 pnpm lint、pnpm build（含 typecheck 和依赖声明生成）、git diff --check 通过。构建仅有既有依赖的 PURE 注释警告，未引入新依赖。
- 开发实例已重载到新代码；既有 5 个暂存文件保持不变，未触碰恢复参考目录或私有仓库。
- 原图复制集成断言：8 个独立 PNG 条目，顺序及 SHA-256 与 Main 中的来源逐一一致，宽高仍为原始尺寸；开启多选且只选择两张时仍复制全部八张。
- 成功对号在实际复制完成后出现；单张复制约一秒后恢复。导出取消无对号，剪贴板失败保留错误和原图；过期 revision、额外路径参数和错误窗口角色被拒绝。
- 收起动画中及静止状态、浅/深色、原图预览、最小尺寸与极窄截图纳入专项；用整张透明窗口 PNG 的周边 Alpha 验证边界，不只检查默认尺寸截图。
- 既有可见桌面和真实屏幕专项仅适配入口，未执行；没有重复截图压力验收，也没有使用用户真实剪贴板。所有新验证用临时数据和合成图片，测试窗口强制隐藏。

开发期间离屏专项曾出现超时，同代码的重跑通过；上轮单列测试也有同类记录。具名测试阶段及不含内容的阶段日志已补充以便后续定位，未放宽超时阈值或跳过断言。不能用一次成功替代 Windows、多屏/混合 DPI 或真实跨应用粘贴验收。

## 平台和兼容性边界

实现沿用当前 Electron 的 ClipboardItem 数组接口。[官方剪贴板文档](https://www.electronjs.org/docs/latest/api/clipboard)说明该 Main 接口接受多个条目；本轮通过测试替身核对送入接口的条目和原始字节，没有假定所有目标软件都会接收多图。只支持单图的目标应用可能仅粘贴一张，应使用合并复制；Windows 原生多图粘贴需在对应机器和目标软件确认。

[收起预览](../ui/v2/shelf-actions-collapsed-light.png)、[展开浅色](../ui/v2/shelf-actions-expanded-light.png)、[展开深色](../ui/v2/shelf-actions-expanded-dark.png)、[原图预览](../ui/v2/shelf-actions-focused-light.png)均使用合成图片。

Main 只从当前 Collection 取得截图，Renderer 不能指定 MIME、原始字节、任意路径或平台剪贴板格式；引用持有到异步提交结束，清空/删除不会造成中途失效。没有写入复制用的临时截图文件。

## 恢复和本地同步

本轮开始先在 .dev-runtime/shelf-actions/ 建立 285 个现存文件的哈希、暂存与工作区 binary diff、隔离副本。用户明确确认没有未导出截图并允许重载后才同步。

before-files/ 保存本轮改动的原文件，sync-manifest.json 记录每个路径的前后 SHA-256。恢复前先比较当前文件与 afterSha256，若有后续修改应合并；新增文件仅在内容仍相同时移出。不要 reset、clean 或覆盖既有暂存内容。本轮不提交、不推送、不打包。
