# 项目人物讲解配置

现有老师的已蒸馏讲法从 `teacher_styles` 读取；外部人物配置放在此目录的 JSON 文件中。选择人物只读取配置，不生成画像，不执行 skill 自带脚本。

```json
{
  "id": "example-person",
  "name": "人物名称",
  "summary": "讲解方式简介",
  "source": "经过审阅的来源说明",
  "promptFile": "example-person.md",
  "referenceFiles": [],
  "enabled": true
}
```

`promptFile` 和 `referenceFiles` 必须位于本目录内。也可以用 `instructions` 字符串直接保存讲解规则。配置正文总长度上限为 60000 字符，引用单个文件不超过 192000 字节。不要导入凭据、执行脚本或无关个人资料。

人物 ID 为 `skill:example-person`；老师 ID 为 `teacher:` 加 URI 编码后的姓名。配置内容变化会更新版本，旧版本生成结果不会冒充新版本。

课堂原文决定知识事实，人物配置只影响讲解方法、结构、视角和表达。源课次与所选讲解人物分别记录。
