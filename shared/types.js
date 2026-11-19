/** @typedef {'ANNOTATE' | 'TRANSLATE' | 'TRANSLATE_BATCH' | 'TEST' | 'SAVE_ANNOTATION' | 'LIST_ANNOTATIONS' | 'GET_SETTINGS' | 'SAVE_SETTINGS'} MessageType */

/**
 * @typedef {Object} Settings
 * @property {string} baseUrl
 * @property {string} apiKey
 * @property {string} model
 * @property {string} targetLang
 */

/**
 * @typedef {Object} PageContext
 * @property {string} title
 * @property {string} url
 * @property {string} before
 * @property {string} selected
 * @property {string} after
 */

/**
 * @typedef {Object} AnnotationRecord
 * @property {string} id
 * @property {string} url
 * @property {string} title
 * @property {string} selected
 * @property {string} result
 * @property {number} createdAt
 */

export const DEFAULT_SETTINGS = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
  targetLang: 'zh',
};

export const LANG_LABELS = {
  zh: '中文',
  en: 'English',
  ja: '日本語',
  ko: '한국어',
  fr: 'Français',
  de: 'Deutsch',
  es: 'Español',
};
