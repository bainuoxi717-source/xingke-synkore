# T5 小幽灵、录音与伴学

适配 **NiceMCU T5 DEV V1.2 / Tuya T5**，2.8 英寸触屏，320×240 横屏。USB 默认朝左。当前整合版是 `firmware/companion_recorder`；另保留纯录音与独立桌宠版本的源码。

## 操作

- 点击小幽灵身体：切换表情和台词，并跳动反馈；16 种表情、48 句本地台词。
- 左上角进入录音，开始后可标记疑问；停止并保存后返回桌宠。录音时保留小幽灵动画。
- BOOT 短按开关屏幕，关屏不停止录音；轻触唤醒，长按约 1.5 秒唤醒并重绘。
- TF 卡保存每节课的 WAV、标记与元数据；停止保存后断电取卡，用读卡器导入电脑。
- USB 伴学由仓库根目录的 `replay-demo/bridge.py` 发送图卡；录音、保存或导出期间拒绝远程卡片。

## 使用已验证固件

`prebuilt/companion_recorder.ino_QIO.bin` 是已实板验证的整合版镜像。`prebuilt/build-manifest.json` 记录二进制与源码摘要。公开版仅删除了生成字体注释中的本机路径，另记录 `publishedSources`；二进制保持不变。

先安装 Tuya T5 官方烧录工具，确认串口，关闭占用串口的监视器和陪学连接，再手动执行：

```powershell
.\tools\flash_prebuilt.ps1 -Port COM3 -Flasher C:\path\to\tyutool_cli.exe
```

脚本先核对镜像 SHA-256，并检查烧录结果的 CRC；不会自动格式化 TF 卡。串口与本机可能不同。

## 从源码构建

已验证环境：TuyaOpen Arduino Core **1.2.5**、T5 SDK **0.0.9**、GCC **10.3**、tyutool **2.1.0**、Windows x64。

1. 从 [Arduino CLI 官方发布页](https://github.com/arduino/arduino-cli/releases) 安装 CLI，将可执行文件放到 `tools/arduino-cli/arduino-cli.exe`。
2. 用 Python 3.12+ 运行 `python reproduction/firmware/install_t5_dependencies.py`。脚本根据附带的官方索引下载 T5 所需依赖并校验 SHA-256；不需要下载其他芯片工具。
3. 在当前 `device` 目录运行：

```powershell
.\tools\ghost_firmware.ps1 -Sketch companion_recorder -Action Build -BuildRoot C:\synkore_t5_build
.\tools\ghost_firmware.ps1 -Sketch companion_recorder -Action Flash -Port COM3 -BuildRoot C:\synkore_t5_build
```

旧 GCC 对中文路径支持有限，`BuildRoot` 必须为无空格的 ASCII 路径。依赖与产物均被 Git 忽略。修改台词时运行 `tools/generate_ghost_font.py --sketch companion_recorder --font <中文字体路径>` 后重新构建，避免缺字。

GPIO 与资源协调见 [硬件适配说明](../docs/HARDWARE.md)。硬件本身为现成开发板，仓库提供板级程序与适配，不包含自研 PCB 或外壳 CAD；本机项目中没有对应 CAD 源文件。

## 电脑录音导入服务

```powershell
py -3.12 -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.\start_zhiliu.bat
```

启动器从 8765 起选择空闲端口。网页可通过串口导入、上传课件、运行本地 Whisper 转写、生成学习流并记录反馈。也可以双击 `读卡器导入并转写.bat`，或运行：

```powershell
.venv\Scripts\python tools/tf_card_import.py --source E:\courses --all
```

首次使用 faster-whisper 会下载模型；需要联网或自行准备本地模型，通过 `ZHILIU_ASR_MODEL` 指定。Python 环境、模型与录音不随仓库分发。未配置大模型时使用模板生成，界面会注明。

单元测试（不操作设备）：设置临时 `ZHILIU_DATA_DIR` 后执行 `python -m unittest discover -s tests -v`。真实串口脚本位于 `tools/`，运行前核对 COM 口与录音状态。
