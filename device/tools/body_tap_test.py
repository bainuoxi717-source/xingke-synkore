"""Read actual board renderings and exercise paired mood/dialogue reactions.

NEXT shares the body-tap action. This test does not claim physical touch coverage.
The existing dual_test.py separately checks microphone/TF/recording integration.
"""
import hashlib
import json
from pathlib import Path
import re
import sys
import time

from PIL import Image, ImageDraw
from dual_test import DualLink, ROOT


class QuietLink(DualLink):
    def command(self, command, seconds=.6):
        self.serial.write(command.encode('ascii') + b'\n')
        self.last_text = self.read_for(seconds)
        return self.last_text


def main():
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    output = ROOT / 'reproduction/dual/body-tap'
    output.mkdir(parents=True, exist_ok=True)
    result = {'passed': False, 'physical_touches_tested': False, 'reactions': []}
    sequence = ('HAPPY', 'SHY', 'SURPRISE', 'SLEEPY', 'LOVE', 'CURIOUS', 'GRUMPY',
                'WINK', 'SAD', 'EXCITED', 'PROUD', 'THINKING', 'HUNGRY', 'CHEER', 'COOL', 'CALM')
    sheet = Image.new('RGB', (320 * 4, 264 * 4), '#192c28')
    draw = ImageDraw.Draw(sheet)
    link = QuietLink()
    try:
        with link:
            initial = link.status()
            assert initial['STATE'] == 'IDLE', 'Do not interrupt a recording'
            assert (initial['MOODS'], initial['LINES']) == (16, 48)
            result['initial'] = initial
            link.command('MODE PET')
            link.command('DISPLAY ON')
            link.command('MOOD CALM')
            prev = link.status()
            captions, pictures = set(), set()
            for cycle in range(3):
                for index, expected in enumerate(sequence):
                    reply = link.command('NEXT')
                    assert reply.count('ACTION REACTION ') == 1, 'One command did not produce one reaction'
                    state = link.status()
                    assert state['STATE'] == 'IDLE' and state['MODE'] == 'PET'
                    assert state['MOOD'] == expected, f'Unexpected mood at {cycle}/{index}'
                    assert state['REACTIONS'] == prev['REACTIONS'] + 1, 'Repeated/missed reaction or external touch'
                    assert state['ACTIONS'] == prev['ACTIONS'] + 1, 'Unexpected competing action'
                    assert state['TOUCHES'] == initial['TOUCHES'], 'Physical touch interfered with automated test'
                    match = re.search(r'^CAPTION (.+)$', link.last_text, re.MULTILINE)
                    assert match, 'No displayed dialogue returned'
                    text = match.group(1).strip()
                    assert text not in captions, 'Dialogue repeated before all 48 lines were used'
                    captions.add(text)
                    result['reactions'].append({'cycle': cycle, 'mood': expected, 'variant': state['VARIANT'], 'text': text})
                    if cycle == 0:
                        picture, digest = link.snapshot(output / (expected.lower() + '.png'))
                        # Hero content, excluding changing status text and caption.
                        face_digest = hashlib.sha256(picture.crop((25, 38, 225, 186)).tobytes()).hexdigest()
                        assert face_digest not in pictures, 'Two expressions rendered identically'
                        pictures.add(face_digest)
                        x, y = index % 4 * 320, index // 4 * 264
                        sheet.paste(picture, (x, y))
                        draw.text((x + 10, y + 243), expected, fill='#eeefe4')
                        result['reactions'][-1]['snapshot_sha256'] = digest
                    prev = state
            assert len(captions) == 48 and len(pictures) == 16
            sheet.save(output / 'expressions.png')
            # Verify screen pause/resume and the same shared recording page.
            link.command('DISPLAY OFF')
            off = link.status()
            assert off['ON'] == 0
            time.sleep(.8)
            assert link.status()['PET_FRAMES'] == off['PET_FRAMES']
            link.command('DISPLAY ON')
            assert link.status()['ON'] == 1
            link.command('MODE RECORDER', 2)
            recorder = link.status()
            assert recorder['MODE'] == 'RECORDER' and recorder['REC_READY'] == 1
            link.snapshot(output / 'recorder-ready.png')
            link.command('MODE PET')
            link.command('MOOD CALM')
            result['final'] = link.status()
            assert result['final']['UPTIME_MS'] > initial['UPTIME_MS'], 'Board restarted during checks'
            assert result['final']['PET_FRAMES'] > initial['PET_FRAMES']
            link.snapshot(output / 'final.png')
            result['passed'] = True
    finally:
        (output / 'serial.txt').write_bytes(link.log)
        (output / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps({'passed': result['passed'], 'checked_reactions': len(result['reactions']), 'output': str(output)}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
