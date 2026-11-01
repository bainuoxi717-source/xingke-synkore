import test from 'node:test';
import assert from 'node:assert/strict';
import { lessonSegments, makeScheduledLesson, makeFreeLesson, upcomingLessons, chooseLesson, lessonProgress, lessonDurations } from '../../web/src/utils/listeningTimeline.js';
import { ListeningRecorder } from '../../web/src/lib/listeningRecorder.js';

const periods = [{ number: 1, start: 480, end: 525 }, { number: 2, start: 535, end: 580 }, { number: 3, start: 600, end: 645 }, { number: 4, start: 655, end: 700 }];
test('a 100-minute timetable block includes two classes and the actual 10-minute break', () => {
  const lesson = makeScheduledLesson({ id: 1, course_name: '示例课程', start_min: 600, end_min: 700 }, '2026-11-02', periods);
  assert.deepEqual(lesson.segments.map((p) => [p.kind, p.start, p.end]), [['class', 600, 645], ['break', 645, 655], ['class', 655, 700]]);
  assert.deepEqual(lessonDurations(lesson), { total: 100, breaks: 10, classes: 90 });
  const rest = lessonProgress(lesson, Date.parse('2026-11-02T10:50:00+08:00'));
  assert.equal(rest.segment.kind, 'break'); assert.equal(rest.ratio, .5);
});
test('multi-section blocks retain 20-minute and 10-minute breaks; missing periods remain unknown', () => {
  assert.deepEqual(lessonSegments(535, 700, periods).filter((p) => p.kind === 'break').map((p) => p.end - p.start), [20, 10]);
  assert.equal(lessonSegments(100, 145, periods)[0].inferred, true);
  assert.deepEqual(lessonSegments(700, 600, periods), []);
});
test('dated lessons respect Shanghai dates, teaching weeks and odd/even rules', () => {
  const data = { semester: { firstWeekMonday: '2026-10-19', totalWeeks: 18 }, periods,
    slots: [{ id: 1, day_of_week: 1, start_min: 600, end_min: 700, weeks: '1-16', week_parity: 1 },
      { id: 2, day_of_week: 1, start_min: 480, end_min: 580, weeks: '1-16', week_parity: 2 }] };
  const now = new Date('2026-11-02T10:30:00+08:00');
  const result = upcomingLessons(data, now);
  assert.equal(result.lessons.length, 1); assert.equal(result.lessons[0].slotId, 1);
  assert.equal(chooseLesson(result.lessons, +now).slotId, 1);
  assert.equal(upcomingLessons({ ...data, semester: {} }, now).lessons.length, 0);
});
test('schedule progress clamps at either endpoint and free listening does not invent breaks', () => {
  const lesson = makeFreeLesson(100000, 45);
  assert.equal(lessonProgress(lesson, 0).ratio, 0);
  assert.equal(lessonProgress(lesson, lesson.endAt + 1).ratio, 1);
  assert.equal(lesson.breaksKnown, false); assert.equal(lesson.segments.length, 1);
});

function fixture(options = {}) {
  const sessions = new Map(), chunks = new Map();
  let mono = 0, wall = Date.parse('2026-11-02T10:00:00+08:00'), sequence = 0, locked = false, stoppedTracks = 0;
  const track = { stop() { stoppedTracks++; }, onended: null };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  class FakeRecorder {
    static isTypeSupported(type) { return type === 'audio/webm;codecs=opus'; }
    constructor() { this.mimeType = 'audio/webm'; this.state = 'inactive'; }
    start() { this.state = 'recording'; }
    pause() { this.state = 'paused'; }
    resume() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; queueMicrotask(() => { this.ondataavailable?.({ data: new Blob(['final audio']) }); this.onstop?.(); }); }
  }
  const storage = {
    openListeningDB: async () => {}, recoverInterruptedRecordings: async () => 0,
    acquireRecordingLock: async () => { if (locked) return null; locked = true; return () => { locked = false; }; },
    createRecording: async (session) => { sessions.set(session.id, structuredClone(session)); },
    updateRecording: async (id, patch) => { const next = { ...sessions.get(id), ...structuredClone(patch) }; sessions.set(id, next); return next; },
    addRecordingMarker: async (id, marker) => { const old = sessions.get(id); old.markers.push(structuredClone(marker)); return old; },
    saveRecordingChunk: async (id, index, blob, checkpoint) => {
      if (options.storageFail) throw new DOMException('Storage full', 'QuotaExceededError');
      chunks.set(`${id}:${index}`, blob);
      const next = { ...sessions.get(id), ...structuredClone(checkpoint), bytes: (sessions.get(id).bytes || 0) + blob.size, chunkCount: (sessions.get(id).chunkCount || 0) + 1 };
      sessions.set(id, next); return next;
    },
    listRecordings: async () => [...sessions.values()], getRecordingBlob: async () => new Blob([...chunks.values()]),
  };
  const controller = new ListeningRecorder({ storage, Recorder: () => FakeRecorder, media: () => ({ getUserMedia: options.getUserMedia || (async () => stream) }),
    clock: () => mono, wallNow: () => wall, makeId: () => `test-${++sequence}` });
  return { controller, sessions, chunks, stream, track,
    advance(ms) { mono += ms; wall += ms; }, lesson: makeFreeLesson(wall, 45),
    get locked() { return locked; }, get stoppedTracks() { return stoppedTracks; } };
}
test('audio timestamps exclude pauses, marks survive saving, and the microphone is released', async () => {
  const f = fixture();
  assert.equal(await f.controller.start(f.lesson), true);
  f.advance(1000); const first = f.controller.mark('unclear'); assert.equal(first.audioMs, 1000);
  f.controller.pause(); f.advance(5000); assert.equal(f.controller.duration(), 1000);
  assert.equal(f.controller.mark('important'), null);
  f.controller.resume(); f.advance(2000); const second = f.controller.mark('important'); assert.equal(second.audioMs, 3000);
  await f.controller.stop();
  const saved = f.sessions.get(f.controller.state.session.id);
  assert.equal(saved.durationMs, 3000); assert.equal(saved.markers.length, 2); assert.equal(saved.spans.length, 2);
  assert.equal(saved.status, 'finished'); assert.ok(saved.bytes > 0); assert.equal(f.locked, false); assert.ok(f.stoppedTracks > 0);
});
test('permission denial produces a useful message, no session, and no retained capture lock', async () => {
  const f = fixture({ getUserMedia: async () => { throw new DOMException('Denied', 'NotAllowedError'); } });
  assert.equal(await f.controller.start(f.lesson), false);
  assert.equal(f.sessions.size, 0); assert.equal(f.locked, false); assert.equal(f.controller.state.status, 'idle');
  assert.match(f.controller.state.error, /麦克风未获允许/);
});
test('cancelling a pending permission request discards a late stream without starting recording', async () => {
  let resolvePermission;
  const permission = new Promise((resolve) => { resolvePermission = resolve; });
  const f = fixture({ getUserMedia: () => permission });
  const start = f.controller.start(f.lesson);
  await new Promise((resolve) => setImmediate(resolve));
  f.controller.cancelStart(); resolvePermission(f.stream);
  assert.equal(await start, false); assert.equal(f.sessions.size, 0); assert.ok(f.stoppedTracks > 0); assert.equal(f.controller.state.status, 'idle');
});
test('storage failure stops capture and keeps an exportable in-memory audio fallback', async () => {
  const f = fixture({ storageFail: true });
  await f.controller.start(f.lesson); f.advance(1500);
  f.controller.recorder.ondataavailable({ data: new Blob(['first audio']) });
  await new Promise((resolve) => setImmediate(resolve)); await f.controller.finished;
  assert.equal(f.controller.state.status, 'finished'); assert.equal(f.controller.state.storageFailure, true);
  assert.ok((await f.controller.blob(f.controller.state.session.id)).size > 0);
  assert.equal(await f.controller.start(f.lesson), false); assert.equal(f.locked, false);
});
