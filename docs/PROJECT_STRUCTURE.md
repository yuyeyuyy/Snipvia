# 当前项目结构与阅读顺序

~~~text
src/
  main/
    index.ts                  启动、窗口编排、Main IPC 与快捷键
    capture/                  路由、CaptureEngine、SCK 与 Electron fallback
    windows/                  Overlay、Pin 与 Shelf 生命周期
    storage/                  ScreenshotStore、Collection、导出和偏好兼容
    legacy/                   旧记录的只读查看与显式导出/导入
    platform/                 权限、自启与平台差异
    updates/                  GitHub 检查、下载与安装边界
    performance/              截图性能记录
  preload/                    窄 IPC 桥
  renderer/src/
    capture/                  框选、编辑器与 Pin
    collection/               Shelf 与合并 Canvas
    settings/                 设置、快捷键、旧记录和更新
    components/               共用标题、反馈与基础控件
    design/                   中性色 Token 与 CSS
  shared/                     IPC 类型、schema、几何与当前/兼容格式
native/screen-capture-kit-helper/
tests/unit/                   核心与边界单测
tests/integration/            Electron 合成回归及 opt-in 真机测试
scripts/                      开发、图标、构建、许可证、发布与诊断工具
UI/                           平台图标源文件
build/                        打包资源与 entitlement
docs/                         当前产品/开发规范、许可证据和 V2 验收
~~~

建议先读[架构](TECHNICAL_DESIGN.md)，再按 Main → 路由 → Store/Collection → 窗口 → Preload → Renderer → 测试的顺序 review。精确链接和文件级清理结果见[review 清单](review/CLEANUP_REVIEW.md)。

`storage/settings.ts` 只读取旧快捷键和主题；主题保存合并原 JSON，并保留其余字段/密文。旧模型、预测、日程类型及凭据读写/迁移接口已删除。`tests/fixtures/legacy-settings.ts` 只用于旧数据兼容测试，不进入产品构建。

依赖、产物与恢复资料由 `.gitignore` 排除：`node_modules/`、`out/`、`dist/`、`test-results/`、`performance-results/`、`.dev-runtime/`、`build/native/`。恢复快照不属于待 review 的业务源码，也没有在此次清理中删除。
