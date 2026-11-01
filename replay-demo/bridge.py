"""Local historical replay + USB display bridge. No model/API billing calls."""
from __future__ import annotations

from collections import deque
from contextlib import asynccontextmanager
from pathlib import Path
import bisect
import hashlib
import io
import json
import os
import re
import threading
import time
import uuid
import zlib

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from PIL import Image, ImageDraw, ImageFont
from pydantic import BaseModel, Field
import serial
from serial.tools import list_ports

ROOT = Path(__file__).resolve().parent
DEMO = json.loads((ROOT / 'demo.json').read_text(encoding='utf-8'))
CUES = DEMO['cues']
TIMES = [x['at'] for x in CUES]
KINDS = {'answer': '参考回答', 'comment': '课堂评论', 'keypoint': '标注重点',
         'question': '想一想', 'material': '拓展材料', 'term': '专有名词', 'history': '历史关联'}
FONT = next((str(p) for p in [Path(os.getenv('SYNKORE_FONT', '__not_configured__')),
    Path('C:/Windows/Fonts/Noto Sans SC (TrueType).otf'), Path('C:/Windows/Fonts/msyh.ttc'),
    Path('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'),
    Path('/System/Library/Fonts/PingFang.ttc')] if p.is_file()), None)
if not FONT:
    raise RuntimeError('Chinese font not found. Set SYNKORE_FONT to a CJK .ttf/.otf/.ttc font.')
ORIGINS = {'http://localhost:3930', 'http://127.0.0.1:3930',
           'http://localhost:3911', 'http://127.0.0.1:3911', 'http://localhost:8771', 'http://127.0.0.1:8771'}


def cue_at(position: float) -> dict:
    return CUES[max(0, bisect.bisect_right(TIMES, position) - 1)]


def wrapped(text: str, font, width=232) -> list[str]:
    lines, line = [], ''
    for char in text:
        if char == '\n' or (line and font.getlength(line + char) > width):
            lines.append(line); line = ''
        if char != '\n':
            line += char
    if line:
        lines.append(line)
    return lines


def pack_bitmap(data: bytes) -> bytes:
    """PackBits: token 0..127 literal run, 128..255 repeated byte run."""
    output, index = bytearray(), 0
    while index < len(data):
        run = 1
        while index + run < len(data) and run < 128 and data[index + run] == data[index]:
            run += 1
        if run >= 3:
            output.extend((127 + run, data[index])); index += run
            continue
        start = index; index += run
        while index < len(data) and index - start < 128:
            run = 1
            while index + run < len(data) and run < 128 and data[index + run] == data[index]:
                run += 1
            if run >= 3:
                break
            index += min(run, 128 - (index - start))
        output.append(index - start - 1); output.extend(data[start:index])
    return bytes(output)


def card_image(cue: dict, playing: bool) -> Image.Image:
    image = Image.new('1', (256, 160), 0)
    draw = ImageDraw.Draw(image)
    small = ImageFont.truetype(FONT, 14)
    body = ImageFont.truetype(FONT, 18)
    footer = ImageFont.truetype(FONT, 12)
    draw.text((12, 3), KINDS[cue['type']], font=small, fill=1)
    timing = f"{int(cue['at']) // 60:02}:{int(cue['at']) % 60:02} {'跟随' if playing else '暂停'}"
    draw.text((244 - small.getlength(timing), 3), timing, font=small, fill=1)
    draw.line((12, 28, 244, 28), fill=1)
    lines = wrapped(cue['shortText'], body)
    if len(lines) > 4:
        raise ValueError('Card exceeds four readable lines: ' + cue['id'])
    for index, line in enumerate(lines):
        draw.text((12, 37 + index * 23), line, font=body, fill=1)
    draw.text((12, 141), '预分析演示 · 网页看依据', font=footer, fill=1)
    return image


# Prepare both playback states once. Playback sends verified cached assets.
CARD_BITMAPS = {(cue['id'], playing): card_image(cue, playing).tobytes()
                for cue in CUES for playing in (False, True)}
PACKED_BITMAPS = {key: pack_bitmap(bitmap) for key, bitmap in CARD_BITMAPS.items()}


class BoardClosed(Exception):
    pass


class Board:
    def __init__(self):
        self.lock = threading.RLock()
        self.stop = threading.Event()
        self.thread = None
        self.serial = None
        self.pending = None
        self.owner = None
        self.sequence = -1
        self.frame = int(time.time()) & 0x7fffffff
        self.logs = deque(maxlen=180)
        self.rx = bytearray()
        self.expected_reply = ''
        self.state = {'connected': False, 'port': None, 'error': '', 'lastCue': None,
                      'lastFrame': None, 'sentFrames': 0, 'lastTransferMs': None}

    def snapshot(self):
        with self.lock:
            return dict(self.state)

    def _line(self, deadline, ignore_closed=False):
        while time.monotonic() < deadline:
            if b'\n' not in self.rx:
                self.rx.extend(self.serial.read(self.serial.in_waiting or 1))
                if len(self.rx) > 8192:
                    self.rx.clear()
                    raise RuntimeError('串口返回的数据行过长')
                continue
            raw, _, tail = self.rx.partition(b'\n')
            self.rx = bytearray(tail)
            text = raw.decode('utf-8', errors='replace').strip()
            if text:
                self.logs.append(text)
                if text == 'CLASSROOM CLOSED' and self.state['connected'] and not ignore_closed:
                    raise BoardClosed('已在开发板返回桌宠；需要时可重新连接')
                return text
        raise TimeoutError('开发板回复超时')

    def _expect(self, prefix, seconds=1.5):
        self.expected_reply = prefix
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            line = self._line(deadline)
            if line.startswith('SCREEN ERROR'):
                raise RuntimeError(line)
            if line.startswith(prefix):
                return line
        raise TimeoutError('开发板回复超时')

    def _write(self, command: bytes):
        # The T5 UART callback can retain the tail of a short USB burst until
        # more bytes arrive. Empty lines flush that tail without adding actions.
        self.serial.write(command + b'\n' * 8)

    def _status(self):
        self._write(b'\nPING\n')
        self._expect('PONG', 3)
        self._write(b'STATUS\n')
        deadline, lines = time.monotonic() + 2.5, []
        while time.monotonic() < deadline:
            line = self._line(deadline)
            lines.append(line)
            if line.startswith('CAPTION '):
                break
        text = '\n'.join(lines)
        if 'READY=1 STATE=IDLE' not in text or 'APP=ZHILIU_DUAL_V1' not in text:
            raise RuntimeError('开发板未就绪或正在录音，请先停止并保存')
        if 'SCREEN_FRAME=' not in text:
            raise RuntimeError('需要先更新支持课堂卡片的固件')
        fields = dict(re.findall(r'(\w+)=([\w]+)', text))
        with self.lock:
            self.state['device'] = {key: int(fields[key]) if fields[key].isdigit() else fields[key]
                                    for key in ('UPTIME_MS', 'HEAP', 'PSRAM', 'MODE', 'SCREEN_FRAME', 'CLASS_FRAMES') if key in fields}
        return text

    def connect(self, port, client_id):
        with self.lock:
            if self.thread and self.thread.is_alive():
                if self.owner == client_id and self.state['connected']:
                    return self.snapshot()
                raise HTTPException(409, '另一个页面正在连接开发板，请先断开')
            if port not in {x.device for x in list_ports.comports()}:
                raise HTTPException(400, '没有找到这个串口')
            device = serial.Serial(port=None, baudrate=921600, timeout=.06, write_timeout=2)
            device.dtr = False; device.rts = False; device.port = port
            try:
                device.open(); device.reset_input_buffer(); self.serial = device; self.rx.clear()
                self._status()
            except Exception as error:
                device.close(); self.serial = None
                raise HTTPException(409, str(error)) from error
            self.owner = client_id; self.sequence = -1; self.pending = None; self.stop.clear()
            self.state.update(connected=True, port=port, error='', lastCue=None)
            self.thread = threading.Thread(target=self._run, name='replay-usb', daemon=True)
            self.thread.start()
            return self.snapshot()

    def position(self, client_id, sequence, position, playing):
        cue = cue_at(position)
        with self.lock:
            if self.owner != client_id or not self.state['connected']:
                return {'accepted': False, 'cueId': cue['id'], 'board': self.snapshot()}
            if sequence <= self.sequence:
                return {'accepted': False, 'cueId': cue['id'], 'board': self.snapshot()}
            self.sequence = sequence
            key = (cue['id'], playing)
            self.pending = (key, cue, playing)
            return {'accepted': True, 'cueId': cue['id'], 'board': self.snapshot()}

    def disconnect(self, client_id=None):
        with self.lock:
            if client_id and self.owner not in (None, client_id):
                raise HTTPException(409, '请在连接开发板的页面断开')
            self.stop.set(); thread = self.thread
        if thread and thread is not threading.current_thread():
            thread.join(timeout=4)
        return self.snapshot()

    def _send(self, cue, playing):
        key = (cue['id'], playing)
        bitmap = CARD_BITMAPS[key]
        if len(bitmap) != 5120:
            raise RuntimeError('Unexpected bitmap size')
        self.frame = (self.frame + 1) & 0x7fffffff or 1
        fid, crc = self.frame, zlib.crc32(bitmap) & 0xffffffff
        packed = PACKED_BITMAPS[key]
        began = time.monotonic()
        self._write(f'SCREEN BEGIN {fid} {crc:08X} RLE {len(packed)}\n'.encode('ascii'))
        self.logs.append(f'TX SCREEN BEGIN {fid} RLE={len(packed)}')
        ready = self._expect(f'SCREEN READY {fid}', 4)
        if 'WINDOW=2' not in ready:
            raise RuntimeError('请更新开发板课堂卡片固件')
        for index, offset in enumerate(range(0, len(packed), 32)):
            if self.stop.is_set():
                return False
            with self.lock:
                if self.pending and self.pending[0] != key:
                    return False  # A seek superseded this unfinished card.
            chunk = packed[offset:offset + 32]
            command = f'SCREEN DATA {fid} {offset} {chunk.hex()}\n'.encode('ascii')
            if len(command) > 96:
                raise RuntimeError('Command exceeds board input size')
            self._write(command)
            time.sleep(.008)
            if index % 2 == 1 or offset + len(chunk) == len(packed):
                self._expect(f'SCREEN ACK {fid} {offset + len(chunk)}')
        with self.lock:
            if self.pending and self.pending[0] != key:
                return False
        self._write(f'SCREEN END {fid}\n'.encode('ascii'))
        line = self._expect(f'SCREEN SHOWN {fid} CRC=', 3)
        if int(line.rsplit('=', 1)[1], 16) != crc:
            raise RuntimeError('Displayed frame CRC mismatch')
        with self.lock:
            self.state.update(lastCue=cue['id'], lastFrame=fid, sentFrames=self.state['sentFrames'] + 1,
                              lastTransferMs=round((time.monotonic() - began) * 1000), error='')
            event = {'time': time.time(), 'cueId': cue['id'], 'playing': playing, 'frameId': fid,
                     'crc32': f'{crc:08X}', 'packedBytes': len(packed), 'elapsedMs': self.state['lastTransferMs']}
        folder = ROOT / 'state'; folder.mkdir(exist_ok=True)
        with (folder / 'transfer-events.jsonl').open('a', encoding='utf-8') as output:
            output.write(json.dumps(event, ensure_ascii=False) + '\n')
        return True

    def _run(self):
        shown = None
        heartbeat = time.monotonic()
        try:
            while not self.stop.is_set():
                with self.lock:
                    pending = self.pending; self.pending = None
                if pending and pending[0] != shown:
                    if self._send(pending[1], pending[2]):
                        shown = pending[0]
                elif self.serial.in_waiting:
                    try:
                        self._line(time.monotonic() + .3)
                    except TimeoutError:
                        pass
                elif time.monotonic() - heartbeat > 15:
                    self._status(); heartbeat = time.monotonic()
                else:
                    self.stop.wait(.05)
        except BoardClosed as error:
            with self.lock:
                self.state['error'] = str(error)
        except Exception as error:
            with self.lock:
                self.state['error'] = '屏幕连接已中断：' + str(error)
            (ROOT / 'state/last-transport-error.txt').write_text('WAITING ' + self.expected_reply + '\n' + '\n'.join(self.logs), encoding='utf-8')
        finally:
            if self.serial:
                try:
                    self._write(b'SCREEN CLOSE\n')
                    deadline = time.monotonic() + 2
                    while time.monotonic() < deadline:
                        line = self._line(deadline, ignore_closed=True)
                        if line == 'SCREEN CLOSED':
                            break
                except Exception:
                    pass
                self.serial.close()
            with self.lock:
                self.serial = None; self.pending = None; self.state['connected'] = False


board = Board()


@asynccontextmanager
async def lifespan(app):
    yield
    board.disconnect()


app = FastAPI(title='醒课 · 五分钟回放陪学', lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=sorted(ORIGINS), allow_methods=['GET', 'POST'], allow_headers=['Content-Type'])


@app.middleware('http')
async def local_control_only(request: Request, call_next):
    if request.method not in ('GET', 'HEAD', 'OPTIONS') and request.headers.get('origin') not in ORIGINS:
        return Response('Local website origin required', status_code=403)
    return await call_next(request)


class Connection(BaseModel):
    client_id: str = Field(pattern=r'^[a-f0-9-]{36}$')
    port: str = Field(default='COM3', pattern=r'^COM[1-9][0-9]{0,2}$')


class Position(BaseModel):
    client_id: str = Field(pattern=r'^[a-f0-9-]{36}$')
    sequence: int = Field(ge=0, le=2147483647)
    position: float = Field(ge=0, le=300, allow_inf_nan=False)
    playing: bool


class Marker(BaseModel):
    id: str = Field(pattern=r'^[a-f0-9-]{36}$')
    position: float = Field(ge=0, le=300, allow_inf_nan=False)
    kind: str = Field(pattern=r'^(important|unclear)$')


@app.get('/health')
def health():
    return {'ok': True, 'mediaReady': (ROOT / 'media/research-methods-5min.mp4').exists(),
            'mode': 'prepared-replay', 'paidModelCalls': 0}


@app.get('/demo')
def demo():
    return {**DEMO, 'mediaReady': (ROOT / 'media/research-methods-5min.mp4').exists()}


@app.get('/media')
def media():
    filename = ROOT / 'media/research-methods-5min.mp4'
    if not filename.exists():
        raise HTTPException(503, '回放片段尚未下载完成，请稍后重试')
    return FileResponse(filename, media_type='video/mp4', headers={'Cache-Control': 'private, max-age=3600'})


@app.get('/preview/{cue_id}.png')
def preview(cue_id: str, playing: bool = False):
    cue = next((x for x in CUES if x['id'] == cue_id), None)
    if not cue:
        raise HTTPException(404)
    output = io.BytesIO(); image = Image.frombytes('1', (256, 160), CARD_BITMAPS[(cue_id, playing)]).convert('RGB')
    image.save(output, format='PNG')
    return Response(output.getvalue(), media_type='image/png')


@app.get('/board')
def status(client_id: str = ''):
    return {**board.snapshot(), 'owned': board.owner == client_id,
            'ports': [{'port': x.device, 'name': x.description} for x in list_ports.comports()]}


@app.post('/board/connect')
def connect(value: Connection):
    return board.connect(value.port, value.client_id)


@app.post('/board/disconnect')
def disconnect(value: Connection):
    return board.disconnect(value.client_id)


@app.post('/position')
def position(value: Position):
    return board.position(value.client_id, value.sequence, value.position, value.playing)


marker_lock = threading.Lock()
marker_file = ROOT / 'state/marks.json'


def read_marks():
    if not marker_file.exists():
        return []
    return json.loads(marker_file.read_text(encoding='utf-8'))


@app.get('/marks')
def marks():
    with marker_lock:
        return {'marks': read_marks()}


@app.post('/marks')
def mark(value: Marker):
    with marker_lock:
        data = read_marks()
        existing = next((x for x in data if x['id'] == value.id), None)
        item = {**value.model_dump(), 'clipId': DEMO['id']}
        if existing and existing != item:
            raise HTTPException(409, '标记编号已使用')
        if not existing:
            data.append(item); marker_file.parent.mkdir(exist_ok=True)
            temporary = marker_file.with_suffix('.tmp')
            temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
            temporary.replace(marker_file)
        return {'mark': item}


if __name__ == '__main__':
    import uvicorn
    prepared = {'mode': 'prepared-replay', 'demo_sha256': hashlib.sha256((ROOT / 'demo.json').read_bytes()).hexdigest(),
                'media_source': DEMO['courId'], 'models_called_during_playback': False,
                'cards': [{'id': cue['id'], 'at': cue['at'], 'frames': [
                    {'playing': value, 'crc32': f"{zlib.crc32(CARD_BITMAPS[(cue['id'], value)]) & 0xffffffff:08X}",
                     'bytes': 5120, 'packedBytes': len(PACKED_BITMAPS[(cue['id'], value)])}
                    for value in (False, True)]} for cue in CUES]}
    (ROOT / 'state').mkdir(exist_ok=True)
    (ROOT / 'state/preanalysis-manifest.json').write_text(json.dumps(prepared, ensure_ascii=False, indent=2), encoding='utf-8')
    uvicorn.run(app, host='127.0.0.1', port=8771, log_level='warning')
