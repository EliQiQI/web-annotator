import { LANG_LABELS } from './types.js';

export const ANNOTATE_SYSTEM =
  '你是网页阅读助手。根据用户选中的文字、页面上下文，以及后续对话中附带的图片/文件内容，给出简洁、准确的中文解释或批注。' +
  '优先说明含义、背景与为何在此出现；必要时补充专有名词。支持多轮追问。使用 Markdown，单次回复控制在合理篇幅。';

/**
 * @param {import('./types.js').PageContext} ctx
 */
export function buildAnnotateMessages(ctx) {
  return [
    { role: 'system', content: ANNOTATE_SYSTEM },
    {
      role: 'user',
      content: [
        `页面标题：${ctx.title}`,
        `页面 URL：${ctx.url}`,
        `上文：${ctx.before || '（无）'}`,
        `选中文本：${ctx.selected}`,
        `下文：${ctx.after || '（无）'}`,
        '',
        '请对「选中文本」做上下文批注。',
      ].join('\n'),
    },
  ];
}

/**
 * @param {string} text
 * @param {string} targetLang
 */
export function buildTranslateMessages(text, targetLang) {
  const lang = LANG_LABELS[targetLang] || targetLang;
  return [
    {
      role: 'system',
      content:
        `你是专业翻译。将用户给出的文本翻译成${lang}。` +
        '只输出译文，不要解释、不要加引号或前后缀。保持原有段落与换行。专有名词可保留原文。',
    },
    {
      role: 'user',
      content: text,
    },
  ];
}

/**
 * @param {string[]} texts
 * @param {string} targetLang
 */
export function buildBatchTranslateMessages(texts, targetLang) {
  const lang = LANG_LABELS[targetLang] || targetLang;
  return [
    {
      role: 'system',
      content:
        `你是专业翻译。将 JSON 字符串数组逐项翻译成${lang}。` +
        '严格返回同样长度的 JSON 字符串数组，不要其它文字。保持原意与语气。',
    },
    {
      role: 'user',
      content: JSON.stringify(texts),
    },
  ];
}
