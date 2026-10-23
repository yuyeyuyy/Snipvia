# V2 Phase 2 增量审计

基线：ae7db9e，分支 refactor/snipvia-v2，开始时工作区干净。源码恢复快照：本地忽略目录 .dev-runtime/v2-phase2/phase1-ae7db9e.tar；所有阶段保留独立提交，可逐步 revert，不重置用户数据。

- Quick 的实际实现为临时 ScreenshotItem → clipboard → Pin；改为直接内存 PNG → clipboard → 有条件结束当前 Session。
- CaptureModeRouter 当前拒绝 collect；新增独立 handler。
- ScreenshotStore 当前会淘汰最早临时项。增加引用保护和明确容量错误，保持 32 项 / 256 MiB / 单图 64 MiB 限额，不静默删除收纳图片。此 MVP 不增加磁盘暂存；到达上限先导出/移除，错误保留当前截图可重试。
- 收纳为本次运行内的 ID 有序列表；隐藏、收起、取消新截图均不清空；清空使用确认。
- 新增一个延迟创建、复用的 ShelfWindow；动画复用该 Renderer，短暂扩展至当前屏幕并点击穿透，完成/中断立即还原，不增加常驻动画窗口。
- 批量输出：有界 Renderer Canvas 合并 PNG → Main 剪贴板；Main 顺序导出独立 PNG 至用户选定的新目录，失败回滚本次输出，不动原图。
- 核心截图引擎、原生 Helper、fallback 算法保持哈希不变。设置沿用分组行；收纳使用工作区语言，黑白灰。
- 修改前同环境 Electron 合成截图轻量 9 样本已实际运行通过；原始埋点及环境见 PHASE2_PERFORMANCE_BEFORE.json。后续对比不把合成数据称为真机 ScreenCaptureKit。

实施顺序：Quick → Collection 单元 → Shelf → 动画 → 输出 → 快捷键 → 全量现有验证与轻量真实 SCK。每步独立提交，本阶段不推送、打包或发布。
