"""Render a silent, authored sample video; no recorded classroom media is used."""
from pathlib import Path
import json, os, shutil, subprocess, tempfile
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
demo = json.loads((ROOT / 'demo.json').read_text('utf-8'))
font_path = next((str(p) for p in [Path(os.getenv('SYNKORE_FONT', '__unset__')),
    Path('C:/Windows/Fonts/Noto Sans SC (TrueType).otf'), Path('C:/Windows/Fonts/msyh.ttc'),
    Path('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'),
    Path('/System/Library/Fonts/PingFang.ttc')] if p.is_file()), None)
if not font_path: raise SystemExit('Set SYNKORE_FONT to a Chinese font.')
ffmpeg = shutil.which('ffmpeg')
if not ffmpeg: raise SystemExit('ffmpeg is required to rebuild the sample video.')
large, body, small = [ImageFont.truetype(font_path, size) for size in (42, 30, 20)]
with tempfile.TemporaryDirectory(prefix='synkore-sample-') as temp:
    folder = Path(temp); lines = []
    for i, cue in enumerate(demo['cues']):
        image = Image.new('RGB', (960, 540), '#0c1411'); draw = ImageDraw.Draw(image)
        draw.text((56, 38), 'SYNKORE / 公开教学示例', font=small, fill='#b2c396')
        draw.text((56, 104), cue['title'], font=large, fill='#f0f1e9')
        y = 210
        for line in cue['shortText'].splitlines():
            draw.text((60, y), line, font=body, fill='#d3dccb'); y += 52
        draw.text((56, 478), '人工脚本 · 无声幻灯视频 · 预分析伴学演示', font=small, fill='#a3b0a7')
        filename = folder / f'{i:02}.png'; image.save(filename)
        end = demo['cues'][i+1]['at'] if i+1 < len(demo['cues']) else 300
        lines += [f"file '{filename.as_posix()}'", f"duration {end-cue['at']}"]
    lines.append(f"file '{filename.as_posix()}'")
    playlist = folder / 'frames.txt'; playlist.write_text('\n'.join(lines), encoding='utf-8')
    output = ROOT / 'media/research-methods-5min.mp4'; output.parent.mkdir(exist_ok=True)
    subprocess.run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', str(playlist),
        '-t', '300', '-vf', 'fps=5,format=yuv420p', '-c:v', 'libx264', '-crf', '28', '-movflags', '+faststart', str(output)], check=True)
print('Rendered authored 300-second sample video.')
