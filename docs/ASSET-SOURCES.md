# 界面素材来源

记录日期：2026-10-31。

## 字体：Instrument Serif

字体由 Google Fonts 官方仓库下载并随项目自托管，无须运行时访问 Google Fonts。

| 文件 | 来源 |
| --- | --- |
| `web/public/assets/fonts/InstrumentSerif-Regular.ttf` | https://raw.githubusercontent.com/google/fonts/main/ofl/instrumentserif/InstrumentSerif-Regular.ttf |
| `web/public/assets/fonts/InstrumentSerif-Italic.ttf` | https://raw.githubusercontent.com/google/fonts/main/ofl/instrumentserif/InstrumentSerif-Italic.ttf |
| `web/public/assets/fonts/OFL-Instrument-Serif.txt` | https://raw.githubusercontent.com/google/fonts/main/ofl/instrumentserif/OFL.txt |

- 项目作者：The Instrument Serif Project Authors。
- 上游项目：https://github.com/Instrument/instrument-serif
- 字体清单：https://github.com/google/fonts/tree/main/ofl/instrumentserif
- 许可：SIL Open Font License 1.1；完整许可已与字体一同保存。分发字体时保留该许可和版权声明。
- 两个字体文件均为 400 字重，分别用于 normal 与 italic。中文文本应使用系统中文字体回退。

## 用户指定的设计参考：Asme

- MotionSites 官方参考页：https://motionsites.org/prompts/asme-hero
- 可访问演示：https://asme.motionverse.dev/
- 演示背景视频：https://asme.motionverse.dev/vendor/b10ef113e2.mp4
- 官方页面预览图：https://motionsites.org/assets/catalog-posters/asme-hero-8493beb60a.webp

### 历史本地参考（本公开版未分发）

- `web/public/assets/curious-motion.mp4`：取原视频开头 3 秒，960×536、24 fps、H.264、CRF 26、yuv420p、无音频、faststart，文件大小 224,909 字节。首尾各 0.35 秒淡入淡出，用于轻量循环背景。时长 3.000 秒，共 72 帧；转码和完整解码验证均无错误。
- `web/public/assets/curious-hero.webp`：取原视频第 2 秒，1200×672，WebP quality 88，作为静态海报和视频未播放时的背景。
- 完整原片约 20 MB、10.04 秒，未纳入交付；未完成的下载与分段临时文件不应随项目发布。

上述模板与人物光轨视频来自用户指定的设计参考。本公开版已排除 `curious-motion.mp4` 与 `curious-hero.webp`，现有界面使用项目提供的小幽灵素材。网页中的公开访问地址不等同于视频的再分发或商业使用授权。字体的 OFL 许可不覆盖视频、图片或模板。

实现参考要素包括黑色背景、衬线大标题、玻璃胶囊输入框、圆形箭头按钮，以及人物周围的蓝金色发光轨道。截图中的绿色 “Free” 是模板目录标签，不属于原 Asme 网站的导航。
