import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import wave

from app import card_import, card_report, course_import, db


class CardImportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.database = self.root / 'test.db'
        with db.connection(self.database) as conn:
            conn.executescript(db.SCHEMA)
        connection = lambda: db.connection(self.database)
        self.patches = [
            patch.object(card_import, 'COURSES_DIR', self.root / 'stored'),
            patch.object(card_import, 'IMPORTS_DIR', self.root / 'staging'),
            patch.object(course_import, 'COURSES_DIR', self.root / 'stored'),
            patch.object(card_import, 'connection', connection),
            patch.object(course_import, 'connection', connection),
            patch.object(card_report, 'connection', connection),
            patch.object(card_report, 'STATIC_DIR', self.root / 'static'),
        ]
        for item in self.patches: item.start()

    def tearDown(self):
        for item in reversed(self.patches): item.stop()
        self.temp.cleanup()

    def make_course(self, group='card', name='course_021', sample=b'\x01\x00'):
        path = self.root / group / 'courses' / name
        path.mkdir(parents=True)
        with wave.open(str(path / 'audio.wav'), 'wb') as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
            w.writeframes(sample * 8000)
        (path / 'marks.json').write_text(json.dumps({'marks':[{'time_ms':100,'type':'confused'}]}),encoding='utf-8')
        (path / 'meta.json').write_text(json.dumps({'title':'测试课程'}),encoding='utf-8')
        return path

    def test_import_validates_copy_and_leaves_source_unchanged(self):
        source = self.make_course()
        before = {p.name:p.read_bytes() for p in source.iterdir()}
        result = card_import.import_card_course(source)
        self.assertFalse(result['already_imported'])
        self.assertEqual(result['audio_duration_ms'], 500)
        self.assertEqual(result['mark_count'], 1)
        self.assertEqual(card_import.file_sha256(self.root/'stored'/result['course_id']/'audio.wav'), result['audio_sha256'])
        self.assertEqual(before, {p.name:p.read_bytes() for p in source.iterdir()})

    def test_duplicate_preserves_transcript_and_feedback(self):
        source = self.make_course()
        first = card_import.import_card_course(source)
        with db.connection(self.database) as conn:
            conn.execute("UPDATE courses SET transcript_status='ready', document_name='notes.pdf' WHERE id=?", (first['course_id'],))
            conn.execute("INSERT INTO posts(id,course_id,kind,title,body,priority,knowledge_point,replies_json) VALUES('p',?,'concept','t','b',90,'k','[]')", (first['course_id'],))
            conn.execute("INSERT INTO feedback VALUES('p','mastered','now')")
        second = card_import.import_card_course(source)
        self.assertTrue(second['already_imported'])
        with db.connection(self.database) as conn:
            self.assertEqual(conn.execute('SELECT status FROM feedback').fetchone()[0], 'mastered')
            self.assertEqual(conn.execute('SELECT document_name FROM courses').fetchone()[0], 'notes.pdf')

    def test_same_number_different_recording_gets_separate_course(self):
        first = card_import.import_card_course(self.make_course())
        second = card_import.import_card_course(self.make_course('second-card', sample=b'\x02\x00'))
        self.assertNotEqual(first['course_id'], second['course_id'])
        self.assertEqual(card_import.file_sha256(self.root/'stored'/first['course_id']/'audio.wav'), first['audio_sha256'])
        self.assertTrue(second['course_id'].startswith('course_021_sd_'))

    def test_invalid_mark_does_not_create_course(self):
        source = self.make_course()
        (source/'marks.json').write_text('{"marks":[{"time_ms":99999}]}')
        with self.assertRaisesRegex(ValueError, '标记时间'):
            card_import.import_card_course(source)
        with db.connection(self.database) as conn:
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM courses').fetchone()[0], 0)

    def test_invalid_wav_is_rejected(self):
        source = self.make_course()
        (source/'audio.wav').write_bytes(b'not a wav')
        with self.assertRaises(ValueError): card_import.import_card_course(source)

    def test_discovery_ignores_unfinished_pcm(self):
        complete = self.make_course()
        incomplete = complete.parent/'course_022'
        incomplete.mkdir()
        (incomplete/'audio.pcm').write_bytes(b'partial')
        self.assertEqual(card_import.discover_card_courses(complete.parent.parent), [complete])

    def test_report_escapes_text_and_preserves_playback(self):
        result = card_import.import_card_course(self.make_course())
        with db.connection(self.database) as conn:
            conn.execute("INSERT INTO transcripts(course_id,start_ms,end_ms,text) VALUES(?,0,400,?)", (result['course_id'], '<script>alert(1)</script>'))
        page = card_report.publish_card_report(result['course_id'])
        body = page.read_text(encoding='utf-8')
        self.assertIn('&lt;script&gt;', body)
        self.assertNotIn('<script>', body)
        self.assertIn('<audio controls', body)
        self.assertEqual(card_import.file_sha256(page.with_suffix('.wav')), result['audio_sha256'])


if __name__=='__main__': unittest.main()
