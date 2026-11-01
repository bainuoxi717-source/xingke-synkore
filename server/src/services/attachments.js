import express from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;
const SOURCE = 'agent-upload';
const PREVIEW_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'application/pdf',
  'audio/wav', 'audio/flac', 'audio/mpeg', 'audio/ogg', 'audio/mp4', 'audio/webm',
  'video/ogg', 'video/quicktime', 'video/mp4', 'video/webm',
]);
const fail = (status, message) => Object.assign(new Error(message), { status });

export function validateAttachmentName(name) {
  if (typeof name !== 'string' || !name.trim() || name.length > 255 ||
      !name.isWellFormed() || /[\x00-\x1f\x7f/\\]/.test(name) || name === '.' || name === '..') {
    throw fail(400, '文件名无效：请使用不含路径或控制字符的文件名（最多255字）');
  }
  return name;
}

// Browser-provided MIME types are not authoritative. Only known extension/signature
// pairs may be embedded; everything else (including SVG/HTML) remains a download.
export function detectPreviewType(name, head) {
  const ext = path.extname(name).toLowerCase();
  const ascii = (start, end) => head.subarray(start, end).toString('ascii');
  const starts = (...bytes) => bytes.every((value, i) => head[i] === value);
  if (ext === '.png' && starts(137, 80, 78, 71, 13, 10, 26, 10)) return 'image/png';
  if (['.jpg', '.jpeg'].includes(ext) && starts(255, 216, 255)) return 'image/jpeg';
  if (ext === '.gif' && ['GIF87a', 'GIF89a'].includes(ascii(0, 6))) return 'image/gif';
  if (ext === '.webp' && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ext === '.avif' && ascii(4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii(8, 12))) return 'image/avif';
  if (ext === '.pdf' && ascii(0, 5) === '%PDF-') return 'application/pdf';
  if (ext === '.wav' && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return 'audio/wav';
  if (ext === '.flac' && ascii(0, 4) === 'fLaC') return 'audio/flac';
  if (ext === '.mp3' && (ascii(0, 3) === 'ID3' || (head[0] === 255 && (head[1] & 0xe0) === 0xe0))) return 'audio/mpeg';
  if (['.ogg', '.oga', '.opus'].includes(ext) && ascii(0, 4) === 'OggS') return 'audio/ogg';
  if (ext === '.ogv' && ascii(0, 4) === 'OggS') return 'video/ogg';
  if (['.mp4', '.m4v', '.mov', '.m4a'].includes(ext) && ascii(4, 8) === 'ftyp') {
    return ext === '.m4a' ? 'audio/mp4' : ext === '.mov' ? 'video/quicktime' : 'video/mp4';
  }
  if (['.webm', '.weba'].includes(ext) && starts(0x1a, 0x45, 0xdf, 0xa3) && head.includes(Buffer.from('webm'))) {
    return ext === '.weba' ? 'audio/webm' : 'video/webm';
  }
  return null;
}

function publicAttachment(row) {
  const url = `/api/attachments/${Number(row.id)}/file`;
  const preview = PREVIEW_TYPES.has(row.content_type);
  return {
    id: Number(row.id), name: row.name, size: Number(row.size),
    content_type: preview ? row.content_type : 'application/octet-stream', url,
    ...(preview ? { preview_url: `${url}?preview=1` } : {}),
  };
}

function findAttachment(id, { filesDir, q1 }) {
  if (!['string', 'number'].includes(typeof id) || !/^[1-9]\d*$/.test(String(id)) || !Number.isSafeInteger(Number(id))) return null;
  const row = q1('SELECT * FROM materials WHERE id = ? AND source = ?', Number(id), SOURCE);
  if (!row) return null;
  const localPath = path.resolve(row.local_path || '');
  const uploadDir = path.resolve(filesDir, 'agent-attachments');
  if (path.dirname(localPath) !== uploadDir || !/^[a-f0-9-]{36}\.bin$/.test(path.basename(localPath))) return null;
  return row;
}

// Resolve metadata for conversation history only. File contents are never opened
// here or added to the model prompt; client-supplied names/types/URLs are ignored.
export function resolveAttachmentMetadata(attachmentIds, { filesDir, q1 }) {
  if (!Array.isArray(attachmentIds)) return [];
  const seen = new Set();
  const attachments = [];
  for (const id of attachmentIds.slice(0, 100)) {
    const row = findAttachment(id, { filesDir, q1 });
    if (!row || seen.has(Number(row.id))) continue;
    seen.add(Number(row.id));
    attachments.push(publicAttachment(row));
  }
  return attachments;
}

export function createAttachmentsRouter({ filesDir, q1, run, nowISO, maxBytes = MAX_ATTACHMENT_BYTES }) {
  const router = express.Router();
  const uploadDir = path.resolve(filesDir, 'agent-attachments');
  const lookup = (id) => {
    const row = findAttachment(id, { filesDir, q1 });
    if (!row) throw fail(404, '附件不存在');
    return row;
  };
  const respondError = (res, error) => {
    if (!res.destroyed && !res.headersSent) {
      res.status(error.status || 500).json({ ok: false, error: error.status ? error.message : '附件操作失败，请重试' });
    }
  };

  router.post('/upload', async (req, res) => {
    let handle, tempPath, savedPath, insertedId;
    try {
      const name = validateAttachmentName(req.query.name);
      if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') {
        throw fail(415, '请直接发送文件原始内容，不要压缩请求体');
      }
      const lengthHeader = req.headers['content-length'];
      if (lengthHeader !== undefined && (!/^\d+$/.test(lengthHeader) || !Number.isSafeInteger(Number(lengthHeader)))) {
        throw fail(400, '文件大小无效');
      }
      const expectedSize = lengthHeader === undefined ? null : Number(lengthHeader);
      if (expectedSize !== null && expectedSize > maxBytes) throw fail(413, '单个文件不能超过100 MiB');
      if (expectedSize === 0) throw fail(400, '不能上传空文件');
      await fs.mkdir(uploadDir, { recursive: true });
      savedPath = path.join(uploadDir, `${randomUUID()}.bin`);
      tempPath = `${savedPath}.part`;
      handle = await fs.open(tempPath, 'wx', 0o600);
      const signature = Buffer.alloc(4096);
      let size = 0, signatureSize = 0;
      // Keep the request socket alive on size errors so the client receives JSON 413.
      for await (const chunk of req.iterator({ destroyOnReturn: false })) {
        if (res.destroyed || req.aborted) throw fail(400, '上传已中断');
        size += chunk.length;
        if (size > maxBytes) throw fail(413, '单个文件不能超过100 MiB');
        if (signatureSize < signature.length) {
          signatureSize += chunk.copy(signature, signatureSize, 0, Math.min(chunk.length, signature.length - signatureSize));
        }
        await handle.writeFile(chunk);
      }
      if (req.aborted || res.destroyed || !req.complete) throw fail(400, '上传已中断');
      if (!size) throw fail(400, '不能上传空文件');
      if (expectedSize !== null && expectedSize !== size) throw fail(400, '文件内容不完整');
      await handle.close();
      handle = null;
      await fs.rename(tempPath, savedPath);
      tempPath = null;
      if (res.destroyed) throw fail(400, '上传已中断');
      const contentType = detectPreviewType(name, signature.subarray(0, signatureSize)) || 'application/octet-stream';
      const timestamp = nowISO();
      const result = run(
        `INSERT INTO materials (course_id, name, content_type, size, source, local_path, downloaded, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        null, name, contentType, size, SOURCE, savedPath, 1, timestamp, timestamp,
      );
      insertedId = Number(result.lastInsertRowid);
      res.status(201).json({ ok: true, attachment: publicAttachment({ id: insertedId, name, content_type: contentType, size }) });
    } catch (error) {
      await handle?.close().catch(() => {});
      if (tempPath) await fs.unlink(tempPath).catch(() => {});
      if (savedPath) await fs.unlink(savedPath).catch(() => {});
      if (insertedId) run('DELETE FROM materials WHERE id = ? AND source = ?', insertedId, SOURCE);
      req.resume();
      respondError(res, error);
    }
  });

  router.get('/:id', (req, res) => {
    try { res.json({ ok: true, attachment: publicAttachment(lookup(req.params.id)) }); }
    catch (error) { respondError(res, error); }
  });

  router.get('/:id/file', async (req, res) => {
    try {
      const row = lookup(req.params.id);
      const info = await fs.lstat(row.local_path).catch(() => { throw fail(404, '附件文件不存在'); });
      if (!info.isFile() || info.isSymbolicLink()) throw fail(404, '附件文件不可用');
      const safeType = PREVIEW_TYPES.has(row.content_type) ? row.content_type : 'application/octet-stream';
      const inline = req.query.preview === '1' && safeType !== 'application/octet-stream';
      const encodedName = encodeURIComponent(row.name).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
      res.set({
        'Content-Type': safeType,
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="download"; filename*=UTF-8''${encodedName}`,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "sandbox; default-src 'none'; script-src 'none'",
        'Cache-Control': 'private, no-store',
      });
      res.sendFile(row.local_path, { dotfiles: 'deny', lastModified: false }, (error) => {
        if (error && !res.headersSent) respondError(res, fail(error.status || 500, '附件读取失败'));
      });
    } catch (error) { respondError(res, error); }
  });

  router.delete('/:id', async (req, res) => {
    try {
      const row = lookup(req.params.id);
      await fs.unlink(row.local_path).catch((error) => { if (error.code !== 'ENOENT') throw error; });
      run('DELETE FROM materials WHERE id = ? AND source = ?', row.id, SOURCE);
      res.json({ ok: true });
    } catch (error) { respondError(res, error); }
  });
  return router;
}
