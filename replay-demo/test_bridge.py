import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import time
from fastapi.testclient import TestClient

spec = importlib.util.spec_from_file_location('replay_bridge', Path(__file__).with_name('bridge.py'))
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class ReplayTests(unittest.TestCase):
    def test_public_sample_and_complete_five_minute_timeline(self):
        demo = bridge.DEMO
        self.assertEqual(demo['originalEndSeconds'] - demo['originalStartSeconds'], 300)
        self.assertEqual(demo['courId'], 900002)
        self.assertEqual(demo['source'], 'authored-public-sample')
        self.assertEqual(len(set(c['type'] for c in demo['cues'])), 7)
        self.assertTrue(all(c['sources'] and c['prepared'] for c in demo['cues']))
        self.assertTrue(all(s['date'] < demo['date'] for c in demo['cues'] for s in c['sources'] if s['kind'] == 'history'))

    def test_seek_and_exact_cue_boundaries(self):
        self.assertEqual(bridge.cue_at(35.99)['id'], 'variables')
        self.assertEqual(bridge.cue_at(36)['id'], 'pretest')
        self.assertEqual(bridge.cue_at(300)['id'], 'recap')
        self.assertEqual(bridge.cue_at(0)['id'], 'follow-x-y')

    def test_every_screen_card_fits_without_truncation(self):
        for cue in bridge.CUES:
            for playing in (True, False):
                with self.subTest(cue=cue['id'], playing=playing):
                    image = bridge.card_image(cue, playing)
                    self.assertEqual(image.size, (256, 160))
                    self.assertEqual(len(image.tobytes()), 5120)
                    self.assertGreater(sum(image.tobytes()), 0)

    def test_packed_frames_round_trip_with_bounded_run_lengths(self):
        for data in [bytes(5120), bytes([255]) * 5120, bytes(range(256)) * 20, *bridge.CARD_BITMAPS.values()]:
            packed = bridge.pack_bitmap(data)
            decoded, index = bytearray(), 0
            while index < len(packed):
                token = packed[index]; index += 1
                count = (token & 127) + 1
                if token & 128:
                    decoded.extend([packed[index]] * count); index += 1
                else:
                    decoded.extend(packed[index:index + count]); index += count
            self.assertEqual(bytes(decoded), data)

    def test_stale_network_updates_do_not_rewind_the_board(self):
        board = bridge.Board(); board.owner = 'owner'; board.state['connected'] = True
        self.assertTrue(board.position('owner', 10, 248, True)['accepted'])
        self.assertFalse(board.position('owner', 9, 0, True)['accepted'])
        self.assertEqual(board.pending[1]['id'], 'web-extension')
        self.assertFalse(board.position('other-page', 11, 0, True)['accepted'])
        self.assertTrue(board.position('owner', 11, 36, False)['accepted'])
        self.assertEqual(board.pending[1]['id'], 'pretest')

    def test_serial_reader_keeps_partial_lines_until_newline(self):
        class Fragments:
            def __init__(self):
                self.parts = [b'SCREEN RE', b'ADY 19\nCAP', b'TION ', '前测'.encode('utf-8')[:2], '前测'.encode('utf-8')[2:] + b'\n']
                self.written = b''
            @property
            def in_waiting(self):
                return len(self.parts[0]) if self.parts else 0
            def read(self, count):
                return self.parts.pop(0) if self.parts else b''
            def write(self, data):
                self.written += data
        board = bridge.Board(); board.serial = Fragments()
        self.assertEqual(board._line(time.monotonic() + .1), 'SCREEN READY 19')
        self.assertEqual(board._line(time.monotonic() + .1), 'CAPTION 前测')
        board._write(b'PING\n')
        self.assertEqual(board.serial.written.rstrip(b'\n'), b'PING')
        self.assertTrue(board.serial.written.endswith(b'\n' * 9))

    def test_origin_checks_and_idempotent_markers(self):
        old = bridge.marker_file
        with tempfile.TemporaryDirectory() as tmp:
            bridge.marker_file = Path(tmp) / 'marks.json'
            try:
                with TestClient(bridge.app) as client:
                    body = {'id': '00000000-0000-4000-8000-000000000001', 'position': 40, 'kind': 'important'}
                    self.assertEqual(client.post('/marks', json=body, headers={'Origin': 'https://unrelated.example'}).status_code, 403)
                    headers = {'Origin': 'http://localhost:3930'}
                    self.assertEqual(client.post('/marks', json=body, headers=headers).status_code, 200)
                    self.assertEqual(client.post('/marks', json=body, headers=headers).status_code, 200)
                    self.assertEqual(len(client.get('/marks').json()['marks']), 1)
                    self.assertEqual(client.post('/marks', json={**body, 'position': 41}, headers=headers).status_code, 409)
                    self.assertEqual(client.post('/position', json={'client_id': '00000000-0000-4000-8000-000000000001', 'sequence': 1, 'position': 301, 'playing': True}, headers=headers).status_code, 422)
            finally:
                bridge.marker_file = old


if __name__ == '__main__':
    unittest.main(verbosity=2)
