"""Verify the actual board's ghost app and capture its LVGL-rendered pixels.

These commands test firmware/UI logic; they don't simulate physical touches.
No TF-card or network APIs are used by this test or the pet firmware.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
import time
import zlib

import serial
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
MOODS = ('CALM', 'HAPPY', 'SHY', 'SURPRISE', 'SLEEPY', 'LOVE', 'CURIOUS', 'GRUMPY')


class GhostLink:
    def __init__(self, port='COM3'):
        self.serial = serial.Serial(port=None, baudrate=921600, timeout=.1, write_timeout=5)
        self.serial.dtr = False
        self.serial.rts = False
        self.serial.port = port
        self.log = bytearray()

    def __enter__(self):
        self.serial.open()
        return self

    def __exit__(self, *args):
        self.serial.close()

    def read_for(self, seconds):
        deadline = time.monotonic() + seconds
        data = bytearray()
        while time.monotonic() < deadline:
            data.extend(self.serial.read(self.serial.in_waiting or 1))
        self.log.extend(data)
        return data.decode('utf-8', errors='replace')

    def command(self, command, seconds=.6):
        self.serial.write(command.encode('ascii') + b'\n')
        text = self.read_for(seconds)
        print(text, end='', flush=True)
        return text

    def status(self):
        text = self.command('STATUS')
        assert 'READY=1 APP=GHOST_T5_V1' in text, 'Ghost app not ready'
        assert 'SIZE=320x240' in text
        fields = dict(re.findall(r'(\w+)=([\w]+)', text))
        return {k: int(v) if v.isdigit() else v for k, v in fields.items()}

    def snapshot(self, output):
        self.serial.write(b'SNAPSHOT\n')
        deadline = time.monotonic() + 20
        header = bytearray()
        metadata = None
        # Read one byte at a time until the metadata newline, so no pixels are lost.
        while time.monotonic() < deadline:
            ch = self.serial.read(1)
            if not ch:
                continue
            header.extend(ch)
            if ch == b'\n':
                metadata = re.search(rb'SNAPSHOT RGB565 (\d+) (\d+) STRIDE=(\d+) BYTES=(\d+) CRC32=([0-9A-Fa-f]+)\r?\n$', header)
                if metadata:
                    break
                if b'ERROR SNAPSHOT' in header:
                    raise RuntimeError(header.decode(errors='replace'))
        assert metadata, f'Snapshot header missing: {header!r}'
        width, height, stride, size = map(int, metadata.groups()[:4])
        expected_crc = int(metadata.group(5), 16)
        assert (width, height) == (320, 240) and stride >= width * 2 and size == stride * height
        data = bytearray()
        while len(data) < size and time.monotonic() < deadline:
            data.extend(self.serial.read(size - len(data)))
        assert len(data) == size, f'Incomplete snapshot: {len(data)}/{size}'
        assert zlib.crc32(data) & 0xffffffff == expected_crc, 'Snapshot CRC32 mismatch'
        footer = self.read_for(.3)
        assert 'SNAPSHOT END' in footer, f'Missing snapshot terminator: {footer}'
        # LVGL RGB565 snapshots use native little-endian, unlike the SPI wire format.
        rgb = bytearray(width * height * 3)
        for y in range(height):
            for x in range(width):
                p = y * stride + x * 2
                color = data[p] | data[p + 1] << 8
                r, g, b = (color >> 11) & 31, (color >> 5) & 63, color & 31
                q = (y * width + x) * 3
                rgb[q:q + 3] = bytes(((r * 255 + 15) // 31, (g * 255 + 31) // 63, (b * 255 + 15) // 31))
        image = Image.frombytes('RGB', (width, height), bytes(rgb))
        assert len(image.getcolors(320 * 240) or []) > 10, 'Frame is blank or unrendered'
        output.parent.mkdir(parents=True, exist_ok=True)
        image.save(output)
        print(f'SNAPSHOT {output.name} bytes={size} CRC32=OK', flush=True)
        return image, hashlib.sha256(data).hexdigest()


def main():
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    p = argparse.ArgumentParser()
    p.add_argument('--port', default='COM3')
    p.add_argument('--soak-seconds', type=int, default=180)
    p.add_argument('--capture-only', action='store_true')
    p.add_argument('--output', type=Path, default=ROOT / 'reproduction/ghost/tests' / time.strftime('%Y%m%d-%H%M%S'))
    a = p.parse_args()
    a.output.mkdir(parents=True, exist_ok=True)
    result = {'passed': False, 'port': a.port, 'physical_touches_tested': False, 'snapshots': {}, 'soak': []}
    link = GhostLink(a.port)
    try:
        with link:
            start = link.status()
            result['initial'] = start
            if a.capture_only:
                link.snapshot(a.output / 'current.png')
            else:
                assert 'PONG GHOST_T5_V1' in link.command('PING')
                link.command('DISPLAY ON')
                before = link.status()
                link.read_for(1)
                after = link.status()
                assert after['FRAMES'] > before['FRAMES'] and after['FLUSHES'] > before['FLUSHES'], 'Animation/flush stalled'
                link.command('DISPLAY OFF')
                off = link.status()
                assert off['ON'] == 0
                link.read_for(1)
                assert link.status()['FRAMES'] == off['FRAMES'], 'Screen-off animation did not pause'
                link.command('DISPLAY ON')
                assert link.status()['ON'] == 1
                link.command('SLEEP')
                link.read_for(8.5)
                assert link.status()['MOOD'] == 'SLEEPY', 'Pet sleep unexpectedly expired'
                link.command('WAKE')
                assert link.status()['MOOD'] == 'HAPPY'
                link.command('PET')
                assert link.status()['MOOD'] == 'LOVE'
                link.command('TALK')
                assert link.status()['MOOD'] == 'CURIOUS'
                link.command('MOOD INVALID')
                assert link.status()['MOOD'] == 'CURIOUS'
                link.command('X' * 120)
                assert 'PONG GHOST_T5_V1' in link.command('PING'), 'Parser did not recover after oversized command'
                sheet = Image.new('RGB', (320 * 4, 264 * 2), '#192c28')
                draw = ImageDraw.Draw(sheet)
                for i, mood in enumerate(MOODS):
                    link.command('MOOD ' + mood)
                    assert link.status()['MOOD'] == mood
                    image, sha = link.snapshot(a.output / (mood.lower() + '.png'))
                    result['snapshots'][mood] = sha
                    sheet.paste(image, ((i % 4) * 320, (i // 4) * 264))
                    draw.text(((i % 4) * 320 + 10, (i // 4) * 264 + 243), mood, fill='#b7d6ac')
                assert len(set(result['snapshots'].values())) == len(MOODS), 'Expressions have identical renderings'
                sheet.save(a.output / 'expressions.png')
                link.command('MOOD CALM')
                # Every sample must keep rendering and remain in the same boot.
                deadline = time.monotonic() + a.soak_seconds
                previous = link.status()
                while time.monotonic() < deadline:
                    link.read_for(min(15, max(0, deadline - time.monotonic())))
                    current = link.status()
                    assert current['UPTIME_MS'] > previous['UPTIME_MS'], 'Device restarted'
                    assert current['FRAMES'] > previous['FRAMES'] and current['FLUSHES'] > previous['FLUSHES'], 'Display stopped updating'
                    result['soak'].append(current)
                    previous = current
                # Compare warm samples, allowing small driver/log allocations.
                if len(result['soak']) >= 3:
                    assert result['soak'][-1]['HEAP'] >= result['soak'][1]['HEAP'] - 4096, 'Heap decreased across soak'
                link.command('MOOD CALM')
                result['final'] = link.status()
                link.snapshot(a.output / 'final.png')
            result['passed'] = True
    finally:
        (a.output / 'serial.txt').write_text(link.log.decode('utf-8', errors='replace'), encoding='utf-8')
        (a.output / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
        print('RESULT_DIRECTORY=' + str(a.output), flush=True)
        print(json.dumps({'passed': result['passed'], 'snapshots': len(result['snapshots'])}), flush=True)


if __name__ == '__main__':
    main()
