import { LANG_LABELS } from './types.js';

export const ANNOTATE_SYSTEM =
  '你是网页阅读助手。必须结合整篇文章的主题、结构和前后文来解读用户选中的片段，而不是孤立解释字面意思。' +
  '说明该选区在全文中的作用、与前后段落/章节的关系；必要时补充专有名词。' +
  '支持多轮追问；若有图片/文件也一并参考。使用 Markdown，条理清晰，篇幅适中。';

/**
 * @param {import('./types.js').PageContext & { outline?: string, article?: string, articleTruncated?: boolean, articleLength?: number }} ctx
 */
export function buildAnnotateMessages(ctx) {
  const parts = [
    `页面标题：${ctx.title}`,
    `页面 URL：${ctx.url}`,
    ctx.outline ? `文章大纲：\n${ctx.outline}` : '',
    ctx.article
      ? [
          ctx.articleTruncated
            ? `说明：全文约 ${ctx.articleLength || '?'} 字，已截取关键部分。`
            : `说明：以下为接近完整的正文。`,
          '',
          '===== 全文/正文上下文 =====',
          ctx.article,
          '===== 正文结束 =====',
        ].join('\n')
      : [
          `上文：${ctx.before || '（无）'}`,
          `选中文本：${ctx.selected}`,
          `下文：${ctx.after || '（无）'}`,
        ].join('\n'),
    '',
    `用户选中的文本：\n${ctx.selected}`,
    '',
    '请基于整篇文章对「选中文本」做上下文批注：先点明全文主题，再解释该选区含义及其在文中的位置与作用。',
  ].filter(Boolean);

  return [
    { role: 'system', content: ANNOTATE_SYSTEM },
    { role: 'user', content: parts.join('\n') },
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
