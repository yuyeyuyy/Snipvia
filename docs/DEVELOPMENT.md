# 本地开发与测试

## 环境和启动

使用 Node.js 24.15.x、pnpm 11.1.3，依赖按锁文件安装：

~~~sh
pnpm install --frozen-lockfile
pnpm electron:install
pnpm dev
~~~

本机可通过 `export PATH="/opt/homebrew/opt/node@24/bin:$PATH"` 使用 Node 24。macOS 的 dev-stable-app.sh 使用固定 `~/Applications/截然 Dev.app`，普通源码更改不替换运行时；Electron 版本不符或签名损坏时会停止，避免无提示改变权限主体。Windows 用 `pnpm dev:raw`。

开发数据目录为 `~/Library/Application Support/snipvia-dev`；正式包继续使用既有 userData。不要把原始恢复目录或私有服务仓库作为开发工作区。

## 录屏权限

首次截图按界面引导，到系统设置的屏幕录制权限中授权实际应用。固定开发版可在 Finder 选中后拖入授权列表；系统要求重启时重新运行 pnpm dev。不要用 tccutil reset 作为常规恢复步骤，不将开发版授权等同于正式包授权。

## 验证

~~~sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:smoke
~~~

默认 Electron 回归使用临时目录和合成图片。实际屏幕须显式 opt-in，禁用屏幕图像留档；小样本 SCK：

~~~sh
SNIPVIA_REAL_SCREEN=1 pnpm exec playwright test tests/integration/v2-sck-light.spec.ts
~~~

不要自动运行高负载耐久测试。测试与构建通过不代表 Windows 真机、签名、公证或正式安装包通过。[验证复用规则](VALIDATION_POLICY.md)。

## 原生构建与图标

`pnpm native:build` 构建 Universal Helper；默认脚本沿用 xcode-select -p，可用实际工具链的 DEVELOPER_DIR 覆盖。`pnpm native:test` 先构建再检查 ping、会话 ID、取消、未知命令、dispose，以及已移除 OCR 命令的拒绝行为。截图算法、缓存与故障回退保留；Helper 不再链接 Vision。正式图标编译需要完整 Xcode，`pnpm icons:build` 从 UI 原稿导出，`pnpm icons:tray` 生成菜单栏资源。

## 当前功能与源码阅读

快捷键、收纳边界及界面见[产品范围](PRD.md)；模块入口见[项目结构](PROJECT_STRUCTURE.md)和[review 清单](review/CLEANUP_REVIEW.md)。旧格式兼容模块不能凭文件名直接删除。

## 连续截图输出调试

Helper 协议或 Swift 源码变化后先 pnpm native:build，再重启 pnpm dev；不能仅因旧二进制存在就复用它。Quick/Collect 的最终 PNG 在 Helper/独立 Worker 编码，失败可从原生应用菜单或托盘菜单重试/放弃。新增 capture-png-worker.js 必须随 Main 打包。

~~~sh
SNIPVIA_PERF=1 pnpm dev
~~~

此开关输出分段数值，并开启进程内存/事件循环诊断；默认不开启重型采样。Main 回调进入不等于物理按键发出。隐藏/无窗口回归须先构建，再单独运行，不展示测试桌面：

~~~sh
pnpm exec playwright test tests/integration/capture-output-headless.spec.ts tests/integration/capture-png-worker.spec.ts --workers=1
~~~

原生冻结帧组件可独立验证，不调用屏幕捕获 API：

~~~sh
DEVELOPER_DIR="$(xcode-select -p)" xcrun swiftc -O -parse-as-library native/screen-capture-kit-helper/FrozenFrameCache.swift tests/native/frozen-frame-cache.swift -o /tmp/snipvia-frozen-frame-test
/tmp/snipvia-frozen-frame-test
~~~

[优化记录与未验真机场景](v2/CAPTURE_OPTIMIZATION_REPORT.md)。可见测试须事先确认不会打断正在使用的桌面。

## 真实快捷键入口诊断

开发实例可用 SNIPVIA_CAPTURE_LATENCY_LOG=1 启动；或放置忽略目录中的 .dev-runtime/capture-latency.enabled 后重启。记录最多 30 个会话，仅含固定事件与数值，写入 .dev-runtime/capture-latency.json；正式版不启用。关闭时移除开关并不再设置此环境变量，再重启开发实例。

[入口延迟追查、开源参考与未验边界](v2/CAPTURE_ENTRY_LATENCY_REPORT.md)。试用期间不要修改运行源码触发重载，否则需重新区分冷启动和连续截图。

## 收纳区交互与尺寸

收起照片充分使用宽度；点击图堆后沿右侧单列向下展开，默认占屏幕工作区高度的 3/4，超出视口后滚动。收起时照片底部悬停显示全部复制、合并复制和导出；展开后这三项固定在顶栏，单图复制、删除仍在照片上悬停显示。普通拖动照片可拖出原图文件；内部排序改为按住 Alt 拖动，Alt+方向键保留。点顶栏多选才显示选择按钮；全部复制始终取全部独立原图，写原生多文件引用供文件夹/支持附件粘贴的输入区域接收；多选只影响合并/导出。成功在按钮显示一秒对号，取消不显示成功，失败仍提示。

展开后再点击单张照片才平滑放大到屏幕中央，再点照片、空白或 Esc 返回。宽度、展开高度模式（屏幕 3/4 或自定义）、自动贴边、等待时间、合并参数及确认清空均在设置 → 收纳区；不再有临时加宽按钮。默认离开 1800ms 后缩入右边缘，悬停手柄即可拉出，点击也保留；内部排序、合并/导出和预览不会触发自动收起。手柄操作不会打开设置窗口。

偏好写入当前 userData/shelf-preferences.json。缺少高度模式的旧配置在内存采用屏幕 3/4，原高度保留为自定义值；已明确保存的自定义高度不变；首次显式保存才更新文件；原 settings.json 等数据不迁移。Collection 图片仍仅本次运行保留，重载开发版前请导出需要保留的截图。

以下专项用临时数据、合成图片及强制隐藏窗口，不使用真实剪贴板、全局快捷键或屏幕截图：

~~~sh
pnpm build
pnpm exec playwright test tests/integration/shelf-column-headless.spec.ts tests/integration/capture-entry-headless.spec.ts tests/integration/capture-output-headless.spec.ts --workers=1
~~~

[实现、验证范围与恢复记录](v2/SHELF_DRAG_REPORT.md)。可见窗口、真实权限和混合 DPI 专项需显式执行，离屏通过不能替代真机结果。

## 原生多文件剪贴板专项（macOS）

默认单测和离屏回归模拟剪贴板；以下 opt-in 命令另用真实系统剪贴板与 AppKit 文件接收接口核验合成原图。原剪贴板全部格式只在内存保全并恢复（超过 64 MiB 或无法读取则中止）；不创建可见窗口，不录屏，不写原剪贴板内容到日志或文件。运行期间避免其他应用改写剪贴板；检测到外部复制时保留新内容，不用旧快照覆盖。

~~~sh
SNIPVIA_REAL_CLIPBOARD=1 node scripts/test-collection-clipboard-native.mjs
~~~

该专项检查原生文件 URL、数量、顺序、原字节及退出后的延迟读取，不代表已逐个验收所有聊天软件；Windows 真实粘贴另验。见[修复记录](v2/SHELF_COPY_ALL_FIX.md)。
