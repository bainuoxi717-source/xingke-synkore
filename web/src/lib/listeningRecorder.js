import * as localStorage from './listeningStorage.js';

export const ACTIVE_RECORDING_STATES = ['requesting', 'recording', 'paused', 'saving'];
export function microphoneError(error) {
  if (['NotAllowedError', 'PermissionDeniedError'].includes(error?.name)) return '麦克风未获允许。请在地址栏的权限设置中允许麦克风，再点击开始听课。';
  if (['NotFoundError', 'DevicesNotFoundError'].includes(error?.name)) return '没有找到麦克风，请连接麦克风后重试。';
  if (['NotReadableError', 'TrackStartError'].includes(error?.name)) return '麦克风暂时无法使用，可能被其他应用占用。请检查设备后重试。';
  return error?.message || '录音没有启动，请重试。';
}
export function chooseRecordingMime(Recorder) {
  return ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm']
    .find((type) => Recorder.isTypeSupported?.(type)) || '';
}

// One controller per app document. SPA navigation does not unmount the recorder.
export class ListeningRecorder {
  constructor(options = {}) {
    this.storage = options.storage || localStorage;
    this.wallNow = options.wallNow || (() => Date.now());
    this.clock = options.clock || (() => performance.now());
    this.media = options.media || (() => navigator.mediaDevices);
    this.Recorder = options.Recorder || (() => globalThis.MediaRecorder);
    this.makeId = options.makeId || (() => crypto.randomUUID());
    this.listeners = new Set();
    this.state = { status: 'idle', ready: false, session: null, history: [], elapsedMs: 0, error: '', notice: '', muted: false, storageFailure: false };
    this.requestToken = 0;
    this.writes = Promise.resolve();
    this.memoryChunks = [];
    this.spans = [];
    this.recordedMs = 0;
    this.activeSince = null;
    this.subscribe = (listener) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
    this.getSnapshot = () => this.state;
  }
  update(patch) { this.state = { ...this.state, ...patch }; this.listeners.forEach((listener) => listener()); }
  async initialize() {
    if (this.initializing) return this.initializing;
    this.initializing = (async () => {
      await this.storage.openListeningDB();
      const release = await this.storage.acquireRecordingLock();
      let recovered = 0;
      if (release) { try { recovered = await this.storage.recoverInterruptedRecordings(); } finally { release(); } }
      this.update({ ready: true, history: await this.storage.listRecordings(),
        notice: recovered ? '已恢复上次意外中断的录音。可以回听和导出已保存的音频与标记。' : '' });
    })().catch((error) => { this.initializing = null; this.update({ ready: false, error: microphoneError(error) }); throw error; });
    return this.initializing;
  }
  duration() { return this.recordedMs + (this.activeSince == null ? 0 : Math.max(0, this.clock() - this.activeSince)); }
  beginSpan() {
    this.activeSince = this.clock();
    this.spans = [...this.spans, { wallStart: this.wallNow(), wallEnd: null, audioStartMs: this.recordedMs }];
  }
  closeSpan() {
    this.recordedMs = this.duration(); this.activeSince = null;
    this.spans = this.spans.map((span, index) => index === this.spans.length - 1 && span.wallEnd == null ? { ...span, wallEnd: this.wallNow(), audioEndMs: this.recordedMs } : span);
  }
  checkpoint() { return { durationMs: this.duration(), spans: this.spans, status: this.state.status === 'paused' ? 'paused' : 'recording' }; }
  enqueue(action) {
    this.writes = this.writes.then(async () => {
      if (!this.writeFailure) await action();
    }).catch((error) => {
      this.writeFailure = error;
      this.update({ storageFailure: true, error: '本机存储写入失败。本次音频仍保留在当前页面，请先导出音频和标记。' });
      if (['recording', 'paused'].includes(this.state.status)) this.stop('storage-error');
    });
    return this.writes;
  }
  async start(lesson) {
    if (ACTIVE_RECORDING_STATES.includes(this.state.status)) return false;
    if (this.state.storageFailure && !this.emergencyExported && this.memoryChunks.length) {
      this.update({ error: '请先导出本次音频，再开始下一节课。' }); return false;
    }
    if (!lesson || !Number.isFinite(lesson.startAt) || lesson.endAt <= lesson.startAt) { this.update({ error: '课程时间不完整，请选择课程或自由听课。' }); return false; }
    const token = ++this.requestToken;
    this.update({ status: 'requesting', error: '', notice: '', muted: false });
    let release, stream, session;
    try {
      await this.initialize();
      if (token !== this.requestToken) return false;
      release = await this.storage.acquireRecordingLock();
      if (!release) throw new Error('另一个标签页正在听课，请回到那个标签页继续录音。');
      if (token !== this.requestToken) { release(); return false; }
      this.releaseLock = release;
      const Recorder = this.Recorder();
      const media = this.media();
      if (!Recorder || !media?.getUserMedia) throw new Error('当前浏览器不能录音。请用 Chrome、Edge 或 Safari 打开 localhost 或 HTTPS 页面。');
      stream = await media.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }, video: false });
      if (token !== this.requestToken) { stream.getTracks().forEach((track) => track.stop()); release(); return false; }
      const type = chooseRecordingMime(Recorder);
      const recorder = new Recorder(stream, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 64000 });
      session = { id: this.makeId(), title: lesson.title, lesson: structuredClone(lesson), startedAt: this.wallNow(), updatedAt: this.wallNow(),
        status: 'recording', mimeType: recorder.mimeType || type || 'audio/webm', markers: [], spans: [], durationMs: 0, bytes: 0, chunkCount: 0 };
      await this.storage.createRecording(session);
      if (token !== this.requestToken) {
        stream.getTracks().forEach((track) => track.stop()); release();
        await this.storage.updateRecording(session.id, { status: 'cancelled' }); return false;
      }
      this.recorder = recorder; this.stream = stream; this.memoryChunks = []; this.spans = []; this.recordedMs = 0; this.activeSince = null;
      this.writeFailure = null; this.emergencyExported = false; this.writes = Promise.resolve(); this.chunkIndex = 0;
      this.stopReason = 'user'; this.finalizing = false;
      this.finished = new Promise((resolve) => { this.resolveFinished = resolve; });
      recorder.ondataavailable = (event) => {
        if (!event.data?.size) return;
        this.memoryChunks.push(event.data);
        const index = this.chunkIndex++, checkpoint = this.checkpoint();
        this.enqueue(async () => {
          const saved = await this.storage.saveRecordingChunk(session.id, index, event.data, checkpoint);
          if (this.state.session?.id === session.id) this.update({ session: { ...this.state.session, bytes: saved.bytes, chunkCount: saved.chunkCount } });
        });
      };
      recorder.onstop = () => this.finalize();
      recorder.onerror = (event) => {
        this.stopReason = 'device-error';
        this.update({ error: `录音设备发生中断。${microphoneError(event.error)}` });
        if (recorder.state !== 'inactive') this.stop('device-error');
      };
      for (const track of stream.getAudioTracks()) {
        track.onended = () => { if (!this.stopping) { this.update({ error: '麦克风已断开，已停止录音并保存可用内容。' }); this.stop('device-error'); } };
        track.onmute = () => this.update({ muted: true });
        track.onunmute = () => this.update({ muted: false });
      }
      this.update({ status: 'recording', session, elapsedMs: 0, storageFailure: false });
      this.beginSpan();
      recorder.start(1000);
      this.stopping = false;
      this.timer = setInterval(() => { if (this.state.status === 'recording') this.update({ elapsedMs: this.duration() }); }, 250);
      this.startMeter(stream);
      this.addPageListeners();
      return true;
    } catch (error) {
      stream?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
      release?.(); if (this.releaseLock === release) this.releaseLock = null;
      if (session) await this.storage.updateRecording(session.id, { status: 'interrupted', error: microphoneError(error) }).catch(() => {});
      if (token === this.requestToken) this.update({ status: 'idle', session: null, error: microphoneError(error) });
      return false;
    }
  }
  cancelStart() {
    if (this.state.status !== 'requesting') return;
    ++this.requestToken; this.releaseLock?.(); this.releaseLock = null;
    this.update({ status: 'idle', error: '', notice: '已取消启动录音。' });
  }
  pause() {
    if (this.state.status !== 'recording' || this.recorder?.state !== 'recording') return;
    try {
      this.recorder.pause(); this.closeSpan(); this.update({ status: 'paused', elapsedMs: this.recordedMs });
      const patch = { ...this.checkpoint(), status: 'paused' };
      this.enqueue(() => this.storage.updateRecording(this.state.session.id, patch));
    } catch (error) { this.update({ error: microphoneError(error) }); }
  }
  resume() {
    if (this.state.status !== 'paused' || this.recorder?.state !== 'paused') return;
    try {
      this.recorder.resume(); this.beginSpan(); this.update({ status: 'recording' });
      const patch = this.checkpoint(); this.enqueue(() => this.storage.updateRecording(this.state.session.id, patch));
    } catch (error) { this.update({ error: microphoneError(error) }); }
  }
  mark(kind) {
    if (this.state.status !== 'recording' || !['unclear', 'important'].includes(kind)) return null;
    const now = this.wallNow(), lesson = this.state.session.lesson;
    const marker = { id: this.makeId(), kind, audioMs: Math.round(this.duration()), wallTime: now,
      classOffsetMs: now - lesson.startAt, inBreak: lesson.segments?.some((part) => part.kind === 'break' && now >= part.startAt && now < part.endAt) || false };
    this.update({ session: { ...this.state.session, markers: [...this.state.session.markers, marker] }, elapsedMs: this.duration() });
    this.enqueue(() => this.storage.addRecordingMarker(this.state.session.id, marker));
    return marker;
  }
  stop(reason = 'user') {
    if (this.state.status === 'requesting') { this.cancelStart(); return Promise.resolve(); }
    if (this.state.status === 'saving') return this.finished;
    if (!['recording', 'paused'].includes(this.state.status)) return Promise.resolve();
    this.stopReason = reason; this.stopping = true;
    if (this.activeSince != null) this.closeSpan();
    clearInterval(this.timer);
    this.update({ status: 'saving', elapsedMs: this.recordedMs });
    try {
      if (this.recorder?.state !== 'inactive') this.recorder.stop();
      else this.finalize();
    } catch (error) { this.update({ error: microphoneError(error) }); this.finalize(); }
    return this.finished;
  }
  async finalize() {
    if (this.finalizing) return;
    this.finalizing = true; this.stopping = true;
    clearInterval(this.timer);
    if (this.activeSince != null) this.closeSpan();
    const endedAt = this.wallNow();
    const id = this.state.session?.id;
    this.stream?.getTracks().forEach((track) => { track.onended = track.onmute = track.onunmute = null; track.stop(); });
    this.stream = null;
    this.audioContext?.close().catch(() => {}); this.audioContext = null; this.analyser = null;
    this.removePageListeners();
    try {
      await this.writes;
      let session = { ...this.state.session, durationMs: this.recordedMs, spans: this.spans, endedAt,
        status: this.writeFailure ? 'storage-error' : this.stopReason === 'user' ? 'finished' : 'interrupted' };
      if (!this.writeFailure) session = await this.storage.updateRecording(id, { status: session.status, durationMs: this.recordedMs, spans: this.spans, endedAt });
      else await this.storage.updateRecording(id, { status: 'interrupted', endedAt }).catch(() => {});
      const history = await this.storage.listRecordings().catch(() => this.state.history);
      this.update({ status: 'finished', session, elapsedMs: this.recordedMs, history, muted: false,
        notice: !this.writeFailure ? this.stopReason === 'user' ? '这节课已保存在本机。点击标记即可回到对应片段。' : '录音已中断，可用内容和标记已保存在本机。' : '',
      });
    } catch (error) {
      this.writeFailure = error;
      this.update({ status: 'finished', storageFailure: true, error: '本机保存未完成。本次音频仍在当前页面，请先导出音频和标记。',
        session: { ...this.state.session, durationMs: this.recordedMs, spans: this.spans, endedAt, status: 'storage-error' } });
    } finally {
      this.releaseLock?.(); this.releaseLock = null; this.resolveFinished?.(this.state.session);
    }
  }
  async blob(id) {
    if (id === this.state.session?.id && this.memoryChunks.length) return new Blob(this.memoryChunks, { type: this.state.session.mimeType });
    return this.storage.getRecordingBlob(id);
  }
  async refreshHistory() { try { this.update({ history: await this.storage.listRecordings() }); } catch (error) { this.update({ error: microphoneError(error) }); } }
  noteExported(id) { if (id === this.state.session?.id) this.emergencyExported = true; }
  getAnalyser() { return this.state.status === 'recording' ? this.analyser : null; }
  startMeter(stream) {
    try {
      const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Audio) return;
      this.audioContext = new Audio(); this.analyser = this.audioContext.createAnalyser(); this.analyser.fftSize = 256;
      this.audioContext.createMediaStreamSource(stream).connect(this.analyser);
      this.audioContext.resume().catch(() => {});
    } catch { /* Meter support is optional; the recording itself continues. */ }
  }
  addPageListeners() {
    if (!globalThis.window) return;
    this.beforeUnload = (event) => { if (['recording', 'paused', 'saving'].includes(this.state.status)) { event.preventDefault(); event.returnValue = ''; } };
    this.visibility = () => { if (document.hidden && this.recorder?.state === 'recording') { try { this.recorder.requestData(); } catch {} } };
    window.addEventListener('beforeunload', this.beforeUnload); document.addEventListener('visibilitychange', this.visibility);
  }
  removePageListeners() {
    if (!globalThis.window) return;
    window.removeEventListener('beforeunload', this.beforeUnload); document.removeEventListener('visibilitychange', this.visibility);
  }
}
export const listeningRecorder = new ListeningRecorder();
