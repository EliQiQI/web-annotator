import { DEFAULT_SETTINGS } from './types.js';

const SETTINGS_KEY = 'wa_settings';
const ANNOTATIONS_KEY = 'wa_annotations';

/**
 * @returns {Promise<import('./types.js').Settings>}
 */
export async function getSettings() {
  const data = await chrome.storage.sync.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(data[SETTINGS_KEY] || {}) };
}

/**
 * @param {Partial<import('./types.js').Settings>} partial
 */
export async function saveSettings(partial) {
  const current = await getSettings();
  const next = { ...current, ...partial };
  await chrome.storage.sync.set({ [SETTINGS_KEY]: next });
  return next;
}

/**
 * @returns {Promise<import('./types.js').AnnotationRecord[]>}
 */
export async function listAnnotations() {
  const data = await chrome.storage.local.get(ANNOTATIONS_KEY);
  return data[ANNOTATIONS_KEY] || [];
}

/**
 * @param {Omit<import('./types.js').AnnotationRecord, 'id' | 'createdAt'>} record
 */
export async function saveAnnotation(record) {
  const list = await listAnnotations();
  const item = {
    ...record,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
  };
  list.unshift(item);
  // Keep last 200
  await chrome.storage.local.set({ [ANNOTATIONS_KEY]: list.slice(0, 200) });
  return item;
}

/**
 * @param {string} url
 */
export async function listAnnotationsByUrl(url) {
  const list = await listAnnotations();
  return list.filter((a) => a.url === url);
}
