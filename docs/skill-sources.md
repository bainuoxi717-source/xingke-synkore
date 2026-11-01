# 人物讲解技能来源

课程笔记方法另参考 [Jellypod-Inc/school-skills 的 lecture-to-study-guide](https://github.com/Jellypod-Inc/school-skills/blob/main/skills/lecture-to-study-guide/SKILL.md)（MIT）。采用其概念、例子、复习提问与来源定位的组织思路，使用本项目独立的JSON结构、全文分块、引用验证与数据库流程；没有安装其插件或执行其工具。它上游依赖的Claude/PDF能力不能视为本项目已具备的解析能力。

本次接入以 [alchaincyf/nuwa-skill](https://github.com/alchaincyf/nuwa-skill) 官方仓库为唯一人物素材来源。核对日期：2026-10-31；固定提交：`7c7edfeb9d90a28b1f79e7847e1ba27a698cdc24`。上游采用 MIT 许可，作者声明为 `Copyright (c) 2026 Huashu (花叔)`。

| 资源 | 上游路径 | 项目用途 |
| --- | --- | --- |
| 女娲 | `SKILL.md`、`references/extraction-framework.md`、`references/fidelity-scorecard.md`、`references/skill-template.md` | 归档在 `server/personas/nuwa-source/`，作为创建人物的方法资料，不是人物选项 |
| 费曼 | `examples/feynman-perspective/SKILL.md` | `skill:feynman`；用具体例子、类比边界和反例检查理解 |
| Andrej Karpathy | `examples/andrej-karpathy-perspective/SKILL.md` | `skill:karpathy`；用最小实例、逐步构建和预测验证讲清技术原理 |

每个目录保留原始 `LICENSE` 和 `SOURCE.json`，后者记录固定提交、上游相对路径与原文 SHA-256。人物原文放在各自 `upstream/SKILL.md`，未改写；未复制上游脚本、第三方网页或研究语料全文。

## 运行时适配

`feynman.json` 与 `karpathy.json` 的 `promptFile` 只加载本项目编写的 `TEACHING.md`，不加载上游原始角色提示和调研材料。人物原文仅用于可追溯审计。教学适配文件基于对应 MIT 方法文本编写，保留其方法差异。

审读发现上游要求自称本人、强制联网并维护角色，其中费曼示例的量子迷宫类比有失真风险。运行时适配因此保留教学方法，去掉本人身份宣称、虚构经历、强制工具行为和示例知识；原课程事实、来源与教师归属始终优先。人物背景、当时的行业判断和预测也不作为当前课程事实库。

女娲归档包含部分脚本及自动更新的文字说明，但项目未复制或运行这些脚本，不安装系统级 skill，不因读取人物配置而联网。女娲方法的项目适配见 `server/personas/nuwa-source/ADAPTATION.md`。文件归档不代表已完成一位新老师的蒸馏，也不代表教学效果经过真人评测。

## 本地资源核查

本机常用 skill 目录未发现已安装的女娲主体。已有 `fanzi-style`（锦观世界）以及《纳瓦尔宝典》、一舟商业思考等方法资源；它们的使用范围和公开人物库不同，本次没有自动复制用户私有表达资料，也没有把书籍方法合集当作完整人物身份。

## 更新方式

更新时先审读新版本、核对许可，再替换原文快照并更新哈希和教学适配。不能把新下载的任意 `SKILL.md` 直接加入 `referenceFiles`。人物注册器依据实际运行提示词计算版本，使问答和重讲内容能跟踪其使用的讲解配置。
