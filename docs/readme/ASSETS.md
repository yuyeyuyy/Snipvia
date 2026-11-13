# README 展示素材

本页素材用于介绍当前 Snipvia 桌面客户端，不引入运行时依赖。

| 文件 | 来源与用途 |
| --- | --- |
| `hero.svg` | 本项目原创封面插画。品牌轮廓复用客户端 `src/renderer/src/components/Icon.tsx`；右侧为截图到目标选择的流程示意，不作为真实窗口尺寸或操作验收证据。 |
| `download-*.svg` | 本项目原创下载按钮，文字与最低系统版本来自 v1.0.0 发行说明；可直接修改 SVG。 |
| `screenshot-to-codex.gif` | 从[官网当前演示视频](https://umbraticus.cn/media/snipvia-desktop-workflow.mp4)的第 3–26 秒导出：1.5 倍速、960px 宽、10fps、128 色、无音轨。网站与 Codex 对话为原创虚构场景，选择条纹理来自当前真实 Renderer。此图是流程演示，不是无人干预的产品录屏，不表示 Snipvia 内置 AI 或自动发送功能。 |
| `editor.png` | 复用[官网编辑器展示图](https://umbraticus.cn/product/editor-final.png)，保留原始字节；来自真实编辑器与原创虚构看板，不含用户私人截图。 |

GIF 源视频 SHA-256：`d422b9e6cd2480ee68d513b47b41efd9424c6fbb8f62ada53ab01bb1589a13ac`。本页不分发源视频或配乐。GIF 导出命令（`source.mp4` 需与上述摘要匹配）：

```sh
ffmpeg -ss 3 -t 23 -i source.mp4 -an \
  -filter_complex '[0:v]setpts=PTS/1.5,fps=10,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle' \
  -loop 0 screenshot-to-codex.gif
```

README 还引用 `docs/ui/v2/` 中已在仓库的收纳区和设置截图，它们使用临时环境与合成内容。没有新增真实录屏、读取用户截图或录制当前桌面。

Codex、ChatGPT、DeepSeek 等名称和标志仅用于辨认演示目标，不表示官方合作或背书。OpenAI / DeepSeek 矢量标志的来源与 MIT 通知保留在 [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md)；其余素材沿用[项目素材声明](../opensource/ASSET_PROVENANCE.md)。

信息组织参考 [DSH Go 的 README](https://github.com/ccch1mneyyy/dsh-go)，本页封面、按钮和文案为 Snipvia 重写，未复制对方品牌、吉祥物、截图或项目代码。
