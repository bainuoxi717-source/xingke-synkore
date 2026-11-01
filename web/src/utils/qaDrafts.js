import { attachmentIdsFrom } from './attachmentRefs.js';

// Migrate once. Keep the original draft as a backup when QA already has text.
export function migrateAssistantDraft(storage) {
  try {
    const raw = storage.getItem('personal-agent:home-draft');
    if (!raw) return;
    const legacy = JSON.parse(raw);
    if (!legacy || typeof legacy !== 'object' || legacy.migratedToQA) return;
    const current = storage.getItem('personal-agent:qa-text-draft') || '';
    const useLegacy = !current.trim() && typeof legacy.prompt === 'string' && legacy.prompt.trim();
    if (useLegacy) storage.setItem('personal-agent:qa-text-draft', legacy.prompt.slice(0, 6000));
    if ((useLegacy || storage.getItem('personal-agent:qa-persona-draft') === null) && typeof legacy.personaId === 'string') {
      storage.setItem('personal-agent:qa-persona-draft', legacy.personaId);
    }
    let currentIds = [];
    try { currentIds = attachmentIdsFrom(JSON.parse(storage.getItem('personal-agent:qa-attachment-draft') || '[]')); } catch {}
    const ids = attachmentIdsFrom([...currentIds, ...attachmentIdsFrom(legacy.attachmentIds)]);
    if (ids.length) storage.setItem('personal-agent:qa-attachment-draft', JSON.stringify(ids));
    storage.setItem('personal-agent:home-draft', JSON.stringify({ ...legacy, migratedToQA: true }));
  } catch { /* Storage may be unavailable. Leave the original draft untouched. */ }
}
