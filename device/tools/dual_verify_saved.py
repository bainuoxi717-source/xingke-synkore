"""Verify an existing board recording, then exercise both views without rerecording."""
import argparse
import array
import json
import math
from pathlib import Path
import shutil
import sys
import time
import wave

from dual_test import DualLink, ROOT, receive_course


def main():
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    parser = argparse.ArgumentParser()
    parser.add_argument('course_id')
    parser.add_argument('--port', default='COM3')
    parser.add_argument('--marks', type=int, default=2)
    parser.add_argument('--soak-seconds', type=int, default=90)
    parser.add_argument('--output', type=Path, required=True)
    a = parser.parse_args()
    a.output.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(ROOT / 'reproduction/dual/firmware/build-manifest.json', a.output / 'build-manifest.json')
    result = {'passed': False, 'existing_course': a.course_id, 'creates_recording': False, 'cycles': [], 'samples': []}
    link = DualLink(a.port)
    try:
        with link:
            initial = link.status()
            assert initial['STATE'] == 'IDLE', 'Leave an existing active recording untouched'
            result['initial'] = initial
        transfer = receive_course(a.course_id, a.port, destination=a.output / 'imports', timeout_s=30)
        result['transfer'] = transfer
        folder = Path(transfer['directory'])
        meta = json.loads((folder / 'meta.json').read_text(encoding='utf-8'))
        marks = json.loads((folder / 'marks.json').read_text(encoding='utf-8'))['marks']
        with wave.open(str(folder / 'audio.wav'), 'rb') as f:
            rate, channels, width, count = f.getframerate(), f.getnchannels(), f.getsampwidth(), f.getnframes()
            pcm = f.readframes(count)
        assert (rate, channels, width) == (16000, 1, 2)
        duration = count / rate
        assert duration >= 5 and abs(duration - meta['audio_duration_ms'] / 1000) < .25
        assert len(marks) == a.marks
        assert all(0 <= m['time_ms'] <= meta['audio_duration_ms'] for m in marks)
        samples = array.array('h', pcm)
        rms = math.sqrt(sum(int(x) * int(x) for x in samples) / len(samples))
        assert rms > 1, 'Microphone has no useful signal'
        result['audio'] = {'duration_seconds': duration, 'meta_duration_ms': meta['audio_duration_ms'],
                           'sample_rate': rate, 'channels': channels, 'bits': width * 8,
                           'rms': rms, 'marks': marks, 'bytes': len(pcm) + 44}
        print('AUDIO ' + json.dumps(result['audio']), flush=True)
        with link:
            assert link.status()['STATE'] == 'IDLE'
            link.command('MODE PET')
            warm = link.status()
            link.snapshot(a.output / 'pet.png')
            for i in range(6):
                link.command('MODE RECORDER')
                rc = link.status()
                assert rc['MODE'] == 'RECORDER' and rc['REC_READY'] == 1 and rc['STATE'] == 'IDLE'
                if i == 0:
                    link.snapshot(a.output / 'recorder.png')
                link.command('MODE PET')
                pc = link.status()
                assert pc['MODE'] == 'PET' and pc['STATE'] == 'IDLE'
                assert pc['UPTIME_MS'] > warm['UPTIME_MS'], 'Mode switching restarted the MCU'
                result['cycles'].append(pc)
            assert result['cycles'][-1]['PSRAM'] >= warm['PSRAM'] - 4096
            deadline = time.monotonic() + a.soak_seconds
            previous = link.status()
            while time.monotonic() < deadline:
                link.read_for(min(15, max(0, deadline - time.monotonic())))
                current = link.status()
                assert current['STATE'] == 'IDLE' and current['MODE'] == 'PET', 'Unexpected manual mode/recording action'
                assert current['UPTIME_MS'] > previous['UPTIME_MS'] and current['PET_FRAMES'] > previous['PET_FRAMES']
                assert current['FLUSHES'] > previous['FLUSHES']
                result['samples'].append(current)
                previous = current
            if len(result['samples']) > 2:
                assert result['samples'][-1]['PSRAM'] >= result['samples'][1]['PSRAM'] - 4096
            link.command('MOOD CALM')
            result['final'] = link.status()
            link.snapshot(a.output / 'final.png')
        result['passed'] = True
    finally:
        (a.output / 'serial.txt').write_text(link.log.decode('utf-8', errors='replace'), encoding='utf-8')
        (a.output / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
        print('RESULT_DIRECTORY=' + str(a.output), flush=True)
        print(json.dumps({'passed': result['passed'], 'existing_course': a.course_id}), flush=True)


if __name__ == '__main__':
    main()
