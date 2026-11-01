const DB_NAME = 'synkore-listening';
let opening;
export function openListeningDB() {
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('当前浏览器无法保存录音，请使用 Chrome、Edge 或 Safari。'));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('sessions', { keyPath: 'id' });
      const chunks = db.createObjectStore('chunks', { keyPath: ['sessionId', 'index'] });
      chunks.createIndex('sessionId', 'sessionId');
      db.createObjectStore('locks', { keyPath: 'id' });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); opening = null; };
      resolve(db);
    };
    request.onerror = () => reject(request.error || new Error('无法打开录音存储。'));
    request.onblocked = () => reject(new Error('录音存储被其他标签页占用，请关闭旧标签页后重试。'));
  }).catch((error) => { opening = null; throw error; });
  return opening;
}
const resultOf = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error('无法读取录音。'));
});
const completed = (transaction) => new Promise((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onabort = transaction.onerror = () => reject(transaction.error || new Error('录音写入失败，请检查浏览器剩余空间。'));
});
export async function createRecording(session) {
  const db = await openListeningDB();
  const tx = db.transaction('sessions', 'readwrite');
  const done = completed(tx);
  tx.objectStore('sessions').add(session);
  await done;
  return session;
}
async function changeSession(id, transform, extra) {
  const db = await openListeningDB();
  const tx = db.transaction(extra ? ['sessions', 'chunks'] : ['sessions'], 'readwrite');
  const done = completed(tx);
  const sessions = tx.objectStore('sessions');
  let output, failure;
  const read = sessions.get(id);
  read.onsuccess = () => {
    try {
      if (!read.result) throw new Error('找不到这次录音，请先导出当前音频。');
      output = transform(read.result);
      sessions.put(output);
      if (extra) extra(tx);
    } catch (error) { failure = error; tx.abort(); }
  };
  try { await done; } catch (error) { throw failure || error; }
  return output;
}
export const updateRecording = (id, patch) => changeSession(id, (session) => ({ ...session, ...patch, updatedAt: Date.now() }));
export const addRecordingMarker = (id, marker) => changeSession(id, (session) => ({ ...session,
  markers: [...(session.markers || []), marker], updatedAt: Date.now(),
}));
export function saveRecordingChunk(id, index, blob, checkpoint) {
  return changeSession(id, (session) => ({ ...session, ...checkpoint,
    bytes: (session.bytes || 0) + blob.size, chunkCount: (session.chunkCount || 0) + 1, updatedAt: Date.now(),
  }), (tx) => tx.objectStore('chunks').add({ sessionId: id, index, blob }));
}
export async function listRecordings() {
  const db = await openListeningDB();
  const records = await resultOf(db.transaction('sessions').objectStore('sessions').getAll());
  return records.sort((a, b) => b.startedAt - a.startedAt);
}
export async function getRecording(id) {
  const db = await openListeningDB();
  return resultOf(db.transaction('sessions').objectStore('sessions').get(id));
}
export async function getRecordingBlob(id) {
  const db = await openListeningDB();
  const chunks = await resultOf(db.transaction('chunks').objectStore('chunks').index('sessionId').getAll(id));
  const session = await getRecording(id);
  return new Blob(chunks.sort((a, b) => a.index - b.index).map((part) => part.blob), { type: session?.mimeType || 'audio/webm' });
}
export async function recoverInterruptedRecordings() {
  const sessions = await listRecordings();
  const interrupted = sessions.filter((session) => ['recording', 'paused', 'saving'].includes(session.status));
  for (const session of interrupted) {
    await updateRecording(session.id, { status: 'interrupted', endedAt: session.updatedAt || session.startedAt,
      spans: (session.spans || []).map((span) => span.wallEnd == null ? { ...span, wallEnd: session.updatedAt || session.startedAt, audioEndMs: session.durationMs || 0 } : span),
      recoveryNote: '录音意外中断，已保留写入本机的音频分片和标记。' });
  }
  return interrupted.length;
}

// Web Locks keep three open app tabs from opening the microphone at the same time.
// The IndexedDB lease is a fallback for browsers without Web Locks.
export async function acquireRecordingLock() {
  if (globalThis.navigator?.locks) {
    return new Promise((resolve, reject) => {
      navigator.locks.request('synkore-microphone', { ifAvailable: true }, async (lock) => {
        if (!lock) { resolve(null); return; }
        await new Promise((release) => resolve(release));
      }).catch(reject);
    });
  }
  const db = await openListeningDB();
  const owner = crypto.randomUUID();
  const tx = db.transaction('locks', 'readwrite');
  const done = completed(tx), store = tx.objectStore('locks');
  let acquired = false;
  const read = store.get('microphone');
  read.onsuccess = () => {
    if (!read.result || read.result.expiresAt < Date.now()) {
      store.put({ id: 'microphone', owner, expiresAt: Date.now() + 60000 }); acquired = true;
    }
  };
  await done;
  if (!acquired) return null;
  const renew = setInterval(async () => {
    try {
      const current = db.transaction('locks', 'readwrite'), locks = current.objectStore('locks');
      const request = locks.get('microphone');
      request.onsuccess = () => { if (request.result?.owner === owner) locks.put({ ...request.result, expiresAt: Date.now() + 60000 }); };
    } catch { /* Capture persistence reports storage failures separately. */ }
  }, 15000);
  return () => {
    clearInterval(renew);
    try {
      const current = db.transaction('locks', 'readwrite'), locks = current.objectStore('locks');
      const request = locks.get('microphone');
      request.onsuccess = () => { if (request.result?.owner === owner) locks.delete('microphone'); };
    } catch { /* Browser releases the lease after timeout if the page is gone. */ }
  };
}
