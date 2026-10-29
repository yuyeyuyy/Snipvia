# 当前分发状态

更新源以 src/shared/release-source.json 为准，目标仓库为 yuyeyuyy/Snipvia。

当前 package.json 已准备为 1.0.0 发布候选，源码位于 refactor/snipvia-v2，尚未创建 v1.0.0 标签、Release 或上传安装包。既有 v0.3.2 为旧 AI 客户端，不包含新的截图、收纳与快速切换工作流。

正式发布必须先完成源码 commit 与推送。macOS 正式脚本要求完整 Xcode、有效 Developer ID 身份及钥匙串公证 Profile，并从干净源码构建 arm64 / x64，完成签名、公证、Gatekeeper 和最终元数据验证。发布标签必须指向验收报告中的 sourceCommit，不能固定为 main，也不能覆盖指向其他提交的标签。

当前 Electron 44.4.1 命中运行时安全公告，全依赖审计仍有 28 条公告（9 high / 14 moderate / 5 low），需先完成独立的运行时与构建依赖升级及回归；不能用仅生产依赖审计为零代替完整安全检查。当前构建环境的完整 Xcode 配置不可用；Windows 真机及安装、卸载、混合 DPI 验收也未完成。本轮不以旧包、未签名包或只通过源码测试替代正式发行验收。详细结果见 [v1.0.0 审查记录](review/V1_0_0_REVIEW.md)。

公开更新说明草稿见 [v1.0.0 更新说明](RELEASE_NOTES_v1.0.0.md)。没有修改仓库可见性、停止线上服务或改写 Git 历史。
