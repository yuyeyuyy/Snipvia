# 第三方组件声明

Snipvia 原创代码采用 [Apache License 2.0](LICENSE)。第三方组件继续适用各自许可证，本文件不重新授权这些组件或商标。

`pnpm build` 在 `out/licenses/` 生成当前安装的 production 依赖清单、原始 LICENSE / COPYING / NOTICE / COPYRIGHT / AUTHORS 文本，以及 Electron 自带的 LICENSE 和 Chromium 完整声明。打包配置将本文件、项目 LICENSE / NOTICE 和这些生成文件保留在应用包中。清单覆盖生产依赖图，可能多于最终包体使用的依赖；开发工具的历史审计快照另见 `docs/opensource/dependency-licenses.json`；它不代表清理后的安装状态，当前生产依赖以本次构建生成的清单为准。

`node-forge` 按其可选的 BSD-3-Clause 许可使用。其余包保留实际声明和原始通知，不根据名称猜测许可证。生成清单中的 `missingLicenseFiles` 必须人工核实，不能对未知缺失项仅凭 package.json 中的 license 字段放行。Electron/Chromium 与随依赖分发的原生工具也不因项目采用 Apache 2.0 而改变许可。

图标、产品标识和文档图片的来源另见 [素材来源核对表](docs/opensource/ASSET_PROVENANCE.md)。维护者已于 2026-10-16 确认清单中的 226 项素材均为原创或已有可再分发授权；第三方适用条款和贡献权属仍应按原始来源维护，本地生成通知不代表独立法律审查。

## lazy-val@1.0.5 的明确补充

上游发布包与对应 Git 提交均声明 MIT，作者为 Vladimir Krivosheev，但未附独立许可证或版权通知。构建时对精确版本、声明、作者及已核对 npm 完整性的全部 5 个发布文件逐一检查 SHA-256，再纳入 [许可补充文本](scripts/opensource/licenses/lazy-val-1.0.5.txt) 和 [来源记录](scripts/opensource/licenses/lazy-val-1.0.5.json)。文本明确标注为依据上游 MIT 声明补充的 SPDX 标准许可条款，并非上游原文件；不推定或编造版权年份、版权行。该补充不扩展至其他依赖或版本，文件不匹配将阻断构建。

这是有来源记录的许可文本补全，不代表已获得额外授权或完成律师审查；若将来取得上游正式通知，应优先保留其原文并重新核对。

## Lobe Icons: OpenAI / DeepSeek

`src/renderer/src/components/QuickTargetBrands.ts` 的本地矢量路径改编自 [Lobe Icons](https://github.com/lobehub/lobe-icons)，固定提交为 `8b7bbc433d38437fa2b0cca58ae896917162b812`，原文件为 [OpenAI](https://github.com/lobehub/lobe-icons/blob/8b7bbc433d38437fa2b0cca58ae896917162b812/src/OpenAI/components/Mono.tsx) 与 [DeepSeek](https://github.com/lobehub/lobe-icons/blob/8b7bbc433d38437fa2b0cca58ae896917162b812/src/DeepSeek/components/Mono.tsx)。仅内置矢量路径，未安装其 React 包，也不在运行时请求远程图标。适用 MIT 许可原文如下。标识仅用于辨认用户选择的目标，不代表官方合作或背书；商标权仍归原权利人。

```text
MIT License

Copyright (c) 2023 LobeHub

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
