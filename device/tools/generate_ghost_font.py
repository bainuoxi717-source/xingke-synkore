"""Build a Chinese subset font for the standalone ghost firmware."""
import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--font', default='C:/Windows/Fonts/Noto Sans SC (TrueType).otf')
parser.add_argument('--converter', type=Path)
parser.add_argument('--sketch', default='ghost_companion', choices=('ghost_companion', 'companion_recorder'))
args = parser.parse_args()
firmware = ROOT / 'firmware' / args.sketch
source = ''.join(p.read_text(encoding='utf-8') for p in firmware.iterdir() if p.suffix in ('.ino', '.cpp', '.h'))
characters = ''.join(sorted(set(re.findall(r'[\u3000-\u9fff\uff00-\uffef]', source))))
output = firmware / 'lv_font_ghost_16.c'
command = ([shutil.which('node'), str(args.converter)] if args.converter else
           [shutil.which('npx.cmd') or shutil.which('npx'), '--yes', 'lv_font_conv'])
command += ['--no-compress', '--no-prefilter', '--bpp', '4', '--size', '16',
            '--font', args.font, '-r', '0x20-0x7f', '--symbols', characters,
            '--format', 'lvgl', '--lv-font-name', 'lv_font_ghost_16', '-o', str(output)]
subprocess.run(command, check=True)
generated = output.read_text(encoding='utf-8').replace('#include "lvgl/lvgl.h"', '#include "lvgl.h"')
generated = generated.replace('LV_FONT_GHOST_16', 'GHOST_SUBSET_FONT_16')
codepoints = {int(value, 16) for value in re.findall(r'U\+([0-9A-Fa-f]{4,6})', generated)}
missing = ''.join(c for c in characters if ord(c) not in codepoints)
report = {'source_font': Path(args.font).name, 'size': 16, 'bpp': 4,
          'chinese_characters': len(characters), 'missing': missing,
          'ascii_covered': all(i in codepoints for i in range(32, 127))}
if missing or not report['ascii_covered']:
    raise RuntimeError(report)
output.write_text(generated, encoding='utf-8')
report_path = ROOT / 'reproduction' / ('dual' if args.sketch == 'companion_recorder' else 'ghost') / 'font-coverage.json'
report_path.parent.mkdir(parents=True, exist_ok=True)
report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False))
