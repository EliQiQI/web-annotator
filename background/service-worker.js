import { getSettings, saveSettings, saveAnnotation, listAnnotationsByUrl } from '../shared/storage.js';
import {
  buildAnnotateMessages,
  buildTranslateMessages,
  buildBatchTranslateMessages,
} from '../shared/prompts.js';

/**
 * Normalize user Base URL to a chat completions endpoint.
 * Accepts either `.../v1` or a full `.../chat/completions` URL.
 * @param {string} baseUrl
 */
function resolveChatCompletionsUrl(baseUrl) {
  const trimmed = (baseUrl || '').trim().replace(/\/+$/, '');
  if (!trimmed) {
    throw new Error('请填写 API Base URL');
  }
  if (/\/chat\/completions$/i.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}/chat/completions`;
}

/**
 * Extract assistant text from common OpenAI-compatible / Qwen response shapes.
 * @param {any} data
 */
function extractAssistantText(data) {
  const choice = data?.choices?.[0];
  const message = choice?.message || choice?.delta;

  const fromContent = normalizeContent(message?.content);
  if (fromContent) return fromContent;

  // Some gateways put text on the choice itself
  const fromText = normalizeContent(choice?.text ?? data?.output_text ?? data?.output?.text);
  if (fromText) return fromText;

  // Reasoning-only replies (rare on TEST) — surface reasoning if present
  const reasoning = normalizeContent(
    message?.reasoning_content || message?.reasoning || data?.output?.reasoning
  );
  if (reasoning) return reasoning;

  return '';
}

/**
 * @param {unknown} content
 */
function normalizeContent(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') {
          return part.text || part.content || part.value || '';
        }
        return '';
      })
      .join('')
      .trim();
  }
  if (typeof content === 'object') {
    return normalizeContent(content.text || content.content || '');
  }
  return String(content).trim();
}

/**
 * @param {string} url
 * @param {RequestInit} init
 * @param {number} timeoutMs
 */
async function fetchWithTimeout(url, init, timeoutMs = 90000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {unknown} err
 * @param {string} url
 */
function networkErrorMessage(err, url) {
  const name = err && typeof err === 'object' && 'name' in err ? String(err.name) : '';
  const msg = err && typeof err === 'object' && 'message' in err ? String(err.message) : String(err);

  if (name === 'AbortError') {
    return `请求超时（90s）\nURL: ${url}\n可稍后重试，或检查网络 / API 服务是否可用。`;
  }

  return (
    `网络请求失败：${msg || 'Failed to fetch'}\n` +
    `URL: ${url}\n` +
    '请检查：\n' +
    '1) Base URL 是否完整（通常以 /v1 结尾）\n' +
    '2) 本机网络能否访问该域名\n' +
    '3) 扩展已重新加载，并在弹窗中「测试连接」\n' +
    '4) 若刚改过设置，先点「保存设置」再批注'
  );
}

/**
 * @param {import('../shared/types.js').Settings} settings
 * @param {Array<{role: string, content: any}>} messages
 * @param {{ temperature?: number, max_tokens?: number }} [opts]
 */
async function chatCompletion(settings, messages, opts = {}) {
  if (!settings.apiKey?.trim()) {
    throw new Error('未配置 API Key，请先在扩展弹窗中填写设置。');
  }

  const url = resolveChatCompletionsUrl(settings.baseUrl);
  const maxTokens = opts.max_tokens ?? 1024;
  const body = JSON.stringify({
    model: settings.model || 'gpt-4o-mini',
    messages,
    temperature: opts.temperature ?? 0.3,
    max_tokens: maxTokens,
  });

  const init = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey.trim()}`,
    },
    body,
  };

  let res;
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      res = await fetchWithTimeout(url, init, 90000);
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 600));
        continue;
      }
    }
  }
  if (!res) {
    throw new Error(networkErrorMessage(lastErr, url));
  }

  const raw = await res.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`API 返回非 JSON（HTTP ${res.status}）\nURL: ${url}\n${raw.slice(0, 240)}`);
  }

  if (!res.ok) {
    const msg =
      data?.error?.message ||
      data?.message ||
      data?.error?.code ||
      raw.slice(0, 240);
    throw new Error(`API 错误（HTTP ${res.status}）\nURL: ${url}\n${msg}`);
  }

  const content = extractAssistantText(data);
  if (!content) {
    const preview = raw.slice(0, 280).replace(/\s+/g, ' ');
    throw new Error(
      `API 未返回有效内容\nURL: ${url}\n请确认 Base URL 指向 OpenAI 兼容的 /v1（不要漏写路径），并检查模型名。\n响应摘要: ${preview}`
    );
  }
  return content;
}

/**
 * @param {string} content
 * @param {number} expected
 */
function parseJsonStringArray(content, expected) {
  const start = content.indexOf('[');
  const end = content.lastIndexOf(']');
  if (start === -1 || end === -1) {
    throw new Error('批量翻译结果不是 JSON 数组');
  }
  const arr = JSON.parse(content.slice(start, end + 1));
  if (!Array.isArray(arr) || arr.length !== expected) {
    throw new Error(`批量翻译数量不匹配：期望 ${expected}，实际 ${arr?.length}`);
  }
  return arr.map((x) => String(x));
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then((result) => sendResponse({ ok: true, data: result }))
    .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
  return true;
});

/**
 * @param {{ type: string, payload?: any }} message
 */
async function handleMessage(message) {
  const { type, payload } = message || {};

  switch (type) {
    case 'GET_SETTINGS':
      return getSettings();

    case 'SAVE_SETTINGS':
      return saveSettings(payload || {});

    case 'TEST': {
      const settings = await getSettings();
      const content = await chatCompletion(
        settings,
        [{ role: 'user', content: '请只回复两个字母：OK' }],
        { max_tokens: 64, temperature: 0 }
      );
      return { reply: content };
    }

    case 'ANNOTATE': {
      const settings = await getSettings();
      const messages = buildAnnotateMessages(payload);
      return chatCompletion(settings, messages, { max_tokens: 800 });
    }

    case 'CHAT': {
      const settings = await getSettings();
      const messages = payload?.messages;
      if (!Array.isArray(messages) || !messages.length) {
        throw new Error('对话消息为空');
      }
      return chatCompletion(settings, messages, {
        max_tokens: payload?.max_tokens ?? 1200,
        temperature: payload?.temperature ?? 0.4,
      });
    }

    case 'TRANSLATE': {
      const settings = await getSettings();
      const targetLang = payload?.targetLang || settings.targetLang;
      const messages = buildTranslateMessages(payload.text, targetLang);
      return chatCompletion(settings, messages, { max_tokens: 2048, temperature: 0.2 });
    }

    case 'TRANSLATE_BATCH': {
      const settings = await getSettings();
      const texts = payload?.texts || [];
      if (!texts.length) return [];
      const targetLang = payload?.targetLang || settings.targetLang;
      const messages = buildBatchTranslateMessages(texts, targetLang);
      const content = await chatCompletion(settings, messages, {
        max_tokens: Math.min(4096, 80 * texts.length + 200),
        temperature: 0.2,
      });
      return parseJsonStringArray(content, texts.length);
    }

    case 'SAVE_ANNOTATION':
      return saveAnnotation(payload);

    case 'LIST_ANNOTATIONS':
      return listAnnotationsByUrl(payload?.url || '');

    default:
      throw new Error(`未知消息类型：${type}`);
  }
}
