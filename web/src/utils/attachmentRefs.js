// Numeric ids remain compatible with uploaded files; library sources have stable typed ids.
export function attachmentIdsFrom(value) {
  return [...new Set((Array.isArray(value) ? value : String(value || '').split(','))
    .map((id) => typeof id === 'string' || typeof id === 'number' ? String(id).trim() : '')
    .filter((id) => /^(?:(?:material|lecture-note):)?[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id.split(':').at(-1)))))];
}
export const savedAttachment = (id) => ({ id, localId: `saved-${id}`, name: '正在读取资料…', size: 0, content_type: '', status: 'uploading', restoring: true });
export const attachmentEndpoint = (id) => `${String(id).includes(':') ? '/api/learning-sources/' : '/api/attachments/'}${encodeURIComponent(id)}`;
