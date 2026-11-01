"""Exercise the real two-mode board, including animation during TF recording."""
import argparse
import array
import json
import math
from pathlib import Path
import re
import shutil
import sys
import time
import wave

from ghost_test import GhostLink, ROOT

sys.path.insert(0, str(ROOT))
from app.serial_import import receive_course


class DualLink(GhostLink):
    def status(self):
        text = self.command('STATUS')
        assert 'READY=1 STATE=' in text and 'APP=ZHILIU_DUAL_V1' in text, 'Dual app not ready'
        assert 'SIZE=320x240' in text
        fields = dict(re.findall(r'(\w+)=([\w]+)', text))
        return {k: int(v) if v.isdigit() else v for k, v in fields.items()}


def wait_idle(link, timeout=30):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        status = link.status()
        if status['STATE'] == 'IDLE':
            return status
        link.read_for(.3)
    raise AssertionError('Recorder did not finish saving')


def main():
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    p = argparse.ArgumentParser()
    p.add_argument('--port', default='COM3')
    p.add_argument('--duration', type=int, default=25)
    p.add_argument('--soak-seconds', type=int, default=120)
    p.add_argument('--output', type=Path, default=ROOT / 'reproduction/dual/tests' / time.strftime('%Y%m%d-%H%M%S'))
    a = p.parse_args()
    a.output.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(ROOT / 'reproduction/dual/firmware/build-manifest.json', a.output / 'build-manifest.json')
    result = {'passed': False, 'port': a.port, 'physical_touches_tested': False, 'samples': [], 'cycles': []}
    link = DualLink(a.port)
    owned_course = None
    try:
        with link:
            initial = link.status()
            assert initial['STATE'] == 'IDLE', 'Do not interrupt an existing recording'
            result['initial'] = initial
            link.command('MODE PET')
            p0 = link.status()
            link.read_for(1)
            p1 = link.status()
            assert p1['PET_FRAMES'] > p0['PET_FRAMES'] and p1['MODE'] == 'PET'
            link.snapshot(a.output / 'pet.png')
            link.command('MODE RECORDER', 2)
            ready = link.status()
            assert ready['REC_READY'] == 1 and ready['MODE'] == 'RECORDER', 'Card/audio not ready'
            link.snapshot(a.output / 'recorder-ready.png')
            started = link.command('START', 1.2)
            match = re.search(r'STATE RECORDING (course_\d{3})', started)
            assert match, 'Recording did not start'
            owned_course = match.group(1)
            record_start = time.monotonic()
            result['course_id'] = owned_course
            r0 = link.status()
            assert r0['STATE'] == 'RECORDING' and r0['MODE'] == 'RECORDER'
            link.command('MARK')
            busy = link.command('MODE PET')
            assert 'Busy; stop and save' in busy
            link.read_for(2)
            r1 = link.status()
            assert r1['STATE'] == 'RECORDING' and r1['MODE'] == 'RECORDER'
            assert r1['REC_FRAMES'] > r0['REC_FRAMES'], 'Ghost animation stopped during recording'
            assert r1['PCM_BYTES'] > r0['PCM_BYTES'], 'Audio stopped during animation'
            assert r1['PET_FRAMES'] == r0['PET_FRAMES'], 'Hidden full-size pet kept rendering'
            result['recording_animation'] = {'before': r0, 'after': r1}
            protected = link.command('SNAPSHOT')
            assert 'Snapshot unavailable' in protected, 'Slow debug transfer was allowed during capture'
            link.command('DISPLAY OFF')
            off0 = link.status()
            assert off0['ON'] == 0
            link.read_for(2)
            off1 = link.status()
            assert off1['PCM_BYTES'] > off0['PCM_BYTES'] and off1['STATE'] == 'RECORDING'
            assert off1['REC_FRAMES'] == off0['REC_FRAMES'], 'Screen-off animation did not pause'
            result['screen_off_recording'] = {'before': off0, 'after': off1}
            link.command('DISPLAY ON')
            on = link.status()
            assert on['ON'] == 1 and on['REC_FRAMES'] > off1['REC_FRAMES']
            link.command('MARK')
            link.read_for(max(0, a.duration - (time.monotonic() - record_start)))
            final_recording = link.status()
            assert final_recording['STATE'] == 'RECORDING' and final_recording['MARKS'] == 2
            result['last_recording'] = final_recording
            save_started = time.monotonic()
            saved = link.command('STOP', .1)
            save_query = link.command('STATUS', .6)
            assert 'STATE=SAVING' in save_query or 'STATE=IDLE' in save_query, 'No status response during saving'
            saved += save_query
            result['saving_status_responsive'] = True
            deadline = time.monotonic() + 30
            while f'STATE SAVED {owned_course} MARKS 2' not in saved and time.monotonic() < deadline:
                saved += link.read_for(.5)
            assert f'STATE SAVED {owned_course} MARKS 2' in saved, 'Recording did not save'
            result['save_elapsed_seconds'] = round(time.monotonic() - save_started, 3)
            assert b'SAVE_PROGRESS COPIED=' in link.log, 'Saving progress not reported'
            result['saved_course'] = owned_course
            owned_course = None
            wait_idle(link)
            link.snapshot(a.output / 'saved.png')
            link.command('MODE PET')
            assert link.status()['MODE'] == 'PET'

        # The existing receiver validates frame CRCs and whole-file SHA256.
        transfer = receive_course(result['course_id'], a.port, destination=a.output / 'imports', timeout_s=30)
        result['transfer'] = transfer
        course = Path(transfer['directory'])
        marks = json.loads((course / 'marks.json').read_text(encoding='utf-8'))['marks']
        meta = json.loads((course / 'meta.json').read_text(encoding='utf-8'))
        with wave.open(str(course / 'audio.wav'), 'rb') as wav:
            rate, channels, width, count = wav.getframerate(), wav.getnchannels(), wav.getsampwidth(), wav.getnframes()
            pcm = wav.readframes(count)
        assert (rate, channels, width) == (16000, 1, 2)
        audio_duration = count / rate
        assert audio_duration >= a.duration - 1
        assert abs(audio_duration - meta['audio_duration_ms'] / 1000) < .25, 'Audio timeline differs from recording timer'
        assert len(marks) == 2 and 0 < marks[0]['time_ms'] < marks[1]['time_ms'] <= meta['audio_duration_ms']
        samples = array.array('h', pcm)
        rms = math.sqrt(sum(int(s) * int(s) for s in samples) / len(samples))
        assert rms > 1, 'Microphone samples contain no useful signal'
        result['audio'] = {'duration_seconds': audio_duration, 'meta_duration_ms': meta['audio_duration_ms'],
                           'sample_rate': rate, 'channels': channels, 'bits': width * 8, 'rms': rms,
                           'marks': marks, 'bytes': len(pcm) + 44}

        # Reuse opened audio/storage while switching the one shared display.
        with link:
            link.command('MODE PET')
            warm = link.status()
            for i in range(6):
                link.command('MODE RECORDER')
                rc = link.status()
                assert rc['MODE'] == 'RECORDER' and rc['REC_READY'] == 1
                link.command('MODE PET')
                pc = link.status()
                assert pc['MODE'] == 'PET' and pc['STATE'] == 'IDLE'
                assert pc['UPTIME_MS'] > warm['UPTIME_MS'], 'Mode switch rebooted the board'
                result['cycles'].append(pc)
            assert result['cycles'][-1]['PSRAM'] >= warm['PSRAM'] - 4096, 'Mode switching lost PSRAM'
            deadline = time.monotonic() + a.soak_seconds
            prev = link.status()
            while time.monotonic() < deadline:
                link.read_for(min(15, max(0, deadline - time.monotonic())))
                cur = link.status()
                assert cur['UPTIME_MS'] > prev['UPTIME_MS'] and cur['PET_FRAMES'] > prev['PET_FRAMES']
                assert cur['FLUSHES'] > prev['FLUSHES'], 'Display stopped flushing'
                result['samples'].append(cur)
                prev = cur
            if len(result['samples']) > 2:
                assert result['samples'][-1]['PSRAM'] >= result['samples'][1]['PSRAM'] - 4096
            link.command('MOOD CALM')
            result['final'] = link.status()
            link.snapshot(a.output / 'final.png')
        result['passed'] = True
    finally:
        if owned_course:
            # Finalize only the course this test created, never someone else's.
            try:
                if link.serial.is_open:
                    link.serial.close()
                with link:
                    st = link.status()
                    if st.get('COURSE') == owned_course and st.get('STATE') == 'RECORDING':
                        link.command('STOP', 1)
                        wait_idle(link)
                    if link.status()['STATE'] == 'IDLE':
                        link.command('MODE PET')
                        link.command('DISPLAY ON')
            except Exception as error:
                result['cleanup_error'] = str(error)
        (a.output / 'serial.txt').write_text(link.log.decode('utf-8', errors='replace'), encoding='utf-8')
        (a.output / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
        print('RESULT_DIRECTORY=' + str(a.output), flush=True)
        print(json.dumps({'passed': result['passed'], 'course_id': result.get('course_id')}), flush=True)


if __name__ == '__main__':
    main()
