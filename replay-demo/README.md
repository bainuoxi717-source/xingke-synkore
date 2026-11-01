# 五分钟随堂伴学（公开示例）

使用人工编写的 300 秒教学脚本、字幕与 13 张卡片；与网站和开发板按播放进度同步。播放时不会调用 ASR、网络搜索或付费模型。本目录没有真实教师音视频或学校回放链接。

1. 在仓库根目录执行 `npm ci`、`npm run seed`、`npm run build`、`npm start`。
2. 另开终端安装本目录 `requirements.txt`，运行 `python replay-demo/bridge.py`。
3. 打开 `http://localhost:3930/replay-demo`。可直接浏览；有开发板时连接串口。

七类卡片：回答提问、课堂评论、标注重点、提出问题、引申材料、解释术语、关联旧知。支持暂停、变速、跳转、重点/疑问标记和屏幕预览。串口有客户端归属、序号和帧校验；录音时固件拒绝远程图卡。

`media/research-methods-5min.mp4` 是同项目人工脚本生成的**无声示例幻灯视频**，不是录播画面。可用 `python replay-demo/make-sample.py` 重建（需 Pillow、ffmpeg、中文字体）。`demo.json` 的 `disclosure` 和 `source` 标明示例性质。

需要自己的课程时，在获得许可后把本地 5 分钟片段替换到该路径，并编辑 `demo.json` 的字幕、卡片及来源；视频、字幕和卡片必须使用同一时间轴。真实资料应留在私有数据目录，勿推送公开仓库。网络素材不能仅因能访问而视为可再分发。

桥接默认绑定 `127.0.0.1:8771`；网页默认端口 3930。中文图卡通过 `SYNKORE_FONT` 指定字体，或使用系统 Noto Sans CJK、微软雅黑、苹方。首次启动即生成全部播放/暂停图卡；没有开发板也可以预览。

测试：`python -m unittest discover -s replay-demo -p test_bridge.py -v`。该测试使用模拟串口，不操作实际设备。
