(() => {
  if (window.__webAnnotatorLoaded) return;
  window.__webAnnotatorLoaded = true;

  const ROOT_ID = 'wa-root';
  const MAX_IMAGE_EDGE = 1280;
  const MAX_TEXT_FILE_CHARS = 20000;
  const MAX_ATTACHMENTS = 6;
  const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp']);
  const TEXT_EXTS = new Set([
    'txt', 'md', 'markdown', 'json', 'csv', 'tsv', 'html', 'htm', 'xml', 'css', 'js', 'ts',
    'jsx', 'tsx', 'py', 'java', 'go', 'rs', 'c', 'cpp', 'h', 'yml', 'yaml', 'toml', 'ini',
    'log', 'svg', 'sql', 'sh', 'env',
  ]);
  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE', 'TEXTAREA', 'INPUT', 'SELECT',
    'OPTION', 'SVG', 'MATH', 'IFRAME',
  ]);

  /** @type {HTMLElement | null} */
  let toolbarEl = null;
  /** @type {HTMLElement | null} */
  let panelEl = null;
  /** @type {string} */
  let lastSelectedText = '';
  /** @type {Range | null} */
  let lastRange = null;
  /** @type {WeakMap<Text, string>} */
  const originalTexts = new WeakMap();
  /** @type {Text[]} */
  let translatedNodes = [];
  let pageTranslated = false;

  /** @type {{ mode: string, selected: string, result: string, busy: boolean } | null} */
  let panelState = null;
  /** @type {Array<{role: string, content: any}>} */
  let chatApiMessages = [];
  /** @type {Array<{role: string, text: string, previews?: Array<{kind: string, name: string, url?: string}>}>} */
  let chatUiMessages = [];
  /** @type {Array<{id: string, kind: 'image'|'text', name: string, mime: string, dataUrl?: string, text?: string}>} */
  let pendingAttachments = [];
  /** @type {ReturnType<typeof getSelectionContext> | null} */
  let lastAnnotateCtx = null;

  function send(type, payload) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage({ type, payload }, (response) => {
          if (chrome.runtime.lastError) {
            const msg = chrome.runtime.lastError.message || '';
            if (/invalidated|receiving end does not exist/i.test(msg)) {
              reject(new Error('扩展已更新或失效，请刷新当前网页后重试。'));
              return;
            }
            reject(new Error(msg));
            return;
          }
          if (!response?.ok) {
            reject(new Error(response?.error || '请求失败'));
            return;
          }
          resolve(response.data);
        });
      } catch (err) {
        reject(new Error(err?.message || String(err)));
      }
    });
  }

  function ensureRoot() {
    let root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement('div');
      root.id = ROOT_ID;
      document.documentElement.appendChild(root);
    }
    return root;
  }

  function hideToolbar() {
    if (toolbarEl) toolbarEl.style.display = 'none';
  }

  function showToolbar(x, y) {
    const root = ensureRoot();
    if (!toolbarEl) {
      toolbarEl = document.createElement('div');
      toolbarEl.className = 'wa-toolbar';
      toolbarEl.innerHTML = `
        <button type="button" data-action="annotate">AI 批注</button>
        <button type="button" data-action="translate">翻译选区</button>
        <button type="button" data-action="page">翻译本页</button>
        <button type="button" data-action="restore" class="wa-secondary">还原本页</button>
        <button type="button" data-action="close" class="wa-ghost">关闭</button>
      `;
      toolbarEl.addEventListener('mousedown', (e) => e.preventDefault());
      toolbarEl.addEventListener('click', onToolbarClick);
      root.appendChild(toolbarEl);
    }

    const restoreBtn = toolbarEl.querySelector('[data-action="restore"]');
    if (restoreBtn instanceof HTMLElement) {
      restoreBtn.style.display = pageTranslated ? '' : 'none';
    }

    toolbarEl.style.display = 'flex';
    const pad = 8;
    const tw = toolbarEl.offsetWidth || 360;
    const th = toolbarEl.offsetHeight || 40;
    const left = Math.min(Math.max(pad, x), window.innerWidth - tw - pad);
    const top = Math.min(Math.max(pad, y), window.innerHeight - th - pad);
    toolbarEl.style.left = `${left + window.scrollX}px`;
    toolbarEl.style.top = `${top + window.scrollY}px`;
  }

  function ensurePanel() {
    const root = ensureRoot();
    if (!panelEl) {
      panelEl = document.createElement('aside');
      panelEl.className = 'wa-panel';
      panelEl.innerHTML = `
        <div class="wa-panel-header">
          <strong class="wa-panel-title">Web Annotator</strong>
          <button type="button" class="wa-ghost" data-panel="close" title="关闭">×</button>
        </div>
        <div class="wa-panel-meta"></div>
        <div class="wa-panel-body"></div>
        <div class="wa-composer" hidden>
          <div class="wa-attach-list"></div>
          <div class="wa-composer-row">
            <button type="button" class="wa-secondary wa-icon-btn" data-panel="attach" title="添加图片或文本文件">📎</button>
            <input type="file" class="wa-file-input" multiple accept="image/*,.txt,.md,.json,.csv,.html,.htm,.xml,.css,.js,.ts,.py,.yml,.yaml,.log,.svg" hidden />
            <textarea class="wa-composer-input" rows="2" placeholder="继续追问，可附带图片/文本文件…"></textarea>
            <button type="button" data-panel="send">发送</button>
          </div>
          <div class="wa-composer-hint">支持图片与常见文本文件；Enter 发送，Shift+Enter 换行</div>
        </div>
        <div class="wa-panel-actions">
          <button type="button" class="wa-secondary" data-panel="clear" hidden>清空对话</button>
          <button type="button" class="wa-secondary" data-panel="save" hidden>保存批注</button>
          <button type="button" class="wa-secondary" data-panel="replace" hidden>替换选区</button>
          <button type="button" class="wa-ghost" data-panel="close2">关闭</button>
        </div>
      `;
      panelEl.addEventListener('click', onPanelClick);
      const fileInput = panelEl.querySelector('.wa-file-input');
      const textarea = panelEl.querySelector('.wa-composer-input');
      if (fileInput) {
        fileInput.addEventListener('change', onFilesSelected);
      }
      if (textarea instanceof HTMLTextAreaElement) {
        textarea.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submitChatFollowUp();
          }
        });
      }
      // Prevent page selection toolbar when interacting with panel
      panelEl.addEventListener('mouseup', (e) => e.stopPropagation());
      root.appendChild(panelEl);
    }
    return panelEl;
  }

  function openPanel({ title, meta, body, mode, selected, result, loading, chat }) {
    const panel = ensurePanel();
    panelState = {
      mode,
      selected: selected || panelState?.selected || '',
      result: result || '',
      busy: !!loading,
    };
    panel.querySelector('.wa-panel-title').textContent = title;
    panel.querySelector('.wa-panel-meta').textContent = meta || '';

    const bodyEl = panel.querySelector('.wa-panel-body');
    const composer = panel.querySelector('.wa-composer');
    const saveBtn = panel.querySelector('[data-panel="save"]');
    const replaceBtn = panel.querySelector('[data-panel="replace"]');
    const clearBtn = panel.querySelector('[data-panel="clear"]');

    if (mode === 'annotate' || chat) {
      bodyEl.classList.add('wa-chat-log');
      renderChatLog(bodyEl, loading);
      if (composer instanceof HTMLElement) composer.hidden = false;
      setComposerEnabled(!loading);
    } else {
      bodyEl.classList.remove('wa-chat-log');
      if (composer instanceof HTMLElement) composer.hidden = true;
      if (loading) {
        bodyEl.innerHTML = '<div class="wa-loading">正在请求模型…</div>';
      } else {
        bodyEl.innerHTML = renderMarkdown(body || '');
      }
    }

    if (saveBtn instanceof HTMLElement) {
      saveBtn.hidden = mode !== 'annotate' || loading;
      saveBtn.textContent = '保存批注';
      saveBtn.disabled = false;
    }
    if (replaceBtn instanceof HTMLElement) {
      replaceBtn.hidden = mode !== 'translate' || loading;
    }
    if (clearBtn instanceof HTMLElement) {
      clearBtn.hidden = mode !== 'annotate' || loading;
    }
    panel.classList.add('wa-open');
  }

  function closePanel() {
    if (panelEl) panelEl.classList.remove('wa-open');
    panelState = null;
    pendingAttachments = [];
    renderAttachList();
  }

  function setComposerEnabled(enabled) {
    if (!panelEl) return;
    const input = panelEl.querySelector('.wa-composer-input');
    const sendBtn = panelEl.querySelector('[data-panel="send"]');
    const attachBtn = panelEl.querySelector('[data-panel="attach"]');
    if (input instanceof HTMLTextAreaElement) input.disabled = !enabled;
    if (sendBtn instanceof HTMLButtonElement) sendBtn.disabled = !enabled;
    if (attachBtn instanceof HTMLButtonElement) attachBtn.disabled = !enabled;
  }

  function renderChatLog(bodyEl, loading) {
    const parts = chatUiMessages.map((m) => {
      const roleLabel = m.role === 'user' ? '你' : m.role === 'assistant' ? 'AI' : '系统';
      const previews = (m.previews || [])
        .map((p) => {
          if (p.kind === 'image' && p.url) {
            return `<div class="wa-msg-attach"><img src="${p.url}" alt="${escapeAttr(p.name)}" /><span>${escapeHtml(p.name)}</span></div>`;
          }
          return `<div class="wa-msg-file">📄 ${escapeHtml(p.name)}</div>`;
        })
        .join('');
      const content =
        m.role === 'assistant' || m.role === 'system'
          ? renderMarkdown(m.text)
          : `<p>${escapeHtml(m.text).replace(/\n/g, '<br>')}</p>`;
      return `<div class="wa-msg wa-msg-${m.role}"><div class="wa-msg-role">${roleLabel}</div>${previews}<div class="wa-msg-content">${content}</div></div>`;
    });

    if (loading) {
      parts.push('<div class="wa-msg wa-msg-assistant"><div class="wa-msg-role">AI</div><div class="wa-loading">正在思考…</div></div>');
    }

    bodyEl.innerHTML = parts.join('') || '<div class="wa-empty">开始批注对话</div>';
    bodyEl.scrollTop = bodyEl.scrollHeight;
  }

  function refreshChatView(loading) {
    if (!panelEl || panelState?.mode !== 'annotate') return;
    const bodyEl = panelEl.querySelector('.wa-panel-body');
    if (bodyEl) renderChatLog(bodyEl, loading);
    setComposerEnabled(!loading);
    if (panelState) panelState.busy = !!loading;
    const saveBtn = panelEl.querySelector('[data-panel="save"]');
    const clearBtn = panelEl.querySelector('[data-panel="clear"]');
    if (saveBtn instanceof HTMLElement) saveBtn.hidden = !!loading;
    if (clearBtn instanceof HTMLElement) clearBtn.hidden = !!loading;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, '&#39;');
  }

  function renderMarkdown(text) {
    const raw = String(text || '');
    try {
      const lib = globalThis.marked;
      if (lib?.parse) {
        return lib.parse(raw, {
          gfm: true,
          breaks: true,
          async: false,
        });
      }
      if (typeof lib === 'function') {
        return lib.parse ? lib.parse(raw) : lib(raw);
      }
    } catch (_) {
      // fall through to lightweight renderer
    }
    return fallbackMarkdown(raw);
  }

  function fallbackMarkdown(text) {
    const escaped = escapeHtml(text || '');
    const withCode = escaped.replace(/`([^`]+)`/g, '<code>$1</code>');
    const withBold = withCode.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    const withItalic = withBold.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    return withItalic
      .split(/\n{2,}/)
      .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
      .join('');
  }

  const ARTICLE_MAX_CHARS = 14000;
  const LOCAL_WINDOW = 1800;

  function getSelectionContext() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    const text = sel.toString().trim();
    if (!text) return null;

    const range = sel.getRangeAt(0).cloneRange();
    lastRange = range;
    lastSelectedText = text;

    const articleRoot = findArticleRoot(range.commonAncestorContainer);
    const articleText = normalizeArticleText(articleRoot?.innerText || document.body.innerText || '');
    const outline = extractOutline(articleRoot || document.body);
    const { before, after, articleForModel, truncated } = buildArticleWindows(articleText, text);

    return {
      title: document.title || '',
      url: location.href,
      before,
      selected: text,
      after,
      outline,
      article: articleForModel,
      articleTruncated: truncated,
      articleLength: articleText.length,
    };
  }

  function findArticleRoot(fromNode) {
    let el = fromNode?.nodeType === Node.ELEMENT_NODE ? fromNode : fromNode?.parentElement;
    while (el && el !== document.body) {
      const tag = el.tagName;
      if (tag === 'ARTICLE' || tag === 'MAIN' || el.getAttribute('role') === 'main') {
        return el;
      }
      el = el.parentElement;
    }

    const candidates = [
      document.querySelector('article'),
      document.querySelector('main'),
      document.querySelector('[role="main"]'),
      document.querySelector('.post-content, .article-content, .entry-content, .markdown-body, #content, .content'),
    ].filter(Boolean);

    if (candidates.length) {
      return candidates.sort((a, b) => (b.innerText || '').length - (a.innerText || '').length)[0];
    }

    // Fallback: largest text-heavy block under body (skip chrome-like regions)
    let best = document.body;
    let bestLen = 0;
    const blocks = document.body.querySelectorAll('div, section, article, main');
    for (const node of blocks) {
      if (node.closest(`#${ROOT_ID}`)) continue;
      if (node.closest('nav, header, footer, aside, [role="navigation"], [role="banner"]')) continue;
      const len = (node.innerText || '').trim().length;
      if (len > bestLen) {
        bestLen = len;
        best = node;
      }
    }
    return best;
  }

  function normalizeArticleText(raw) {
    return String(raw || '')
      .replace(/\r/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  function extractOutline(root) {
    if (!root) return '';
    const headings = root.querySelectorAll('h1, h2, h3, h4');
    const lines = [];
    for (const h of headings) {
      if (h.closest(`#${ROOT_ID}`)) continue;
      const t = (h.innerText || '').replace(/\s+/g, ' ').trim();
      if (!t) continue;
      const level = Number(h.tagName.slice(1));
      lines.push(`${'  '.repeat(Math.max(0, level - 1))}- ${t}`);
      if (lines.length >= 40) break;
    }
    return lines.join('\n');
  }

  function buildArticleWindows(articleText, selected) {
    const idx = articleText.indexOf(selected);
    let before = '';
    let after = '';
    if (idx >= 0) {
      before = articleText.slice(Math.max(0, idx - LOCAL_WINDOW), idx);
      after = articleText.slice(idx + selected.length, idx + selected.length + LOCAL_WINDOW);
    } else {
      // Selection may differ by whitespace; fall back to local block snippet from page
      before = articleText.slice(0, LOCAL_WINDOW);
      after = '';
    }

    let articleForModel = articleText;
    let truncated = false;

    if (articleText.length <= ARTICLE_MAX_CHARS) {
      if (idx >= 0) {
        articleForModel =
          articleText.slice(0, idx) +
          '\n【选中开始】\n' +
          selected +
          '\n【选中结束】\n' +
          articleText.slice(idx + selected.length);
      }
      return { before, after, articleForModel, truncated };
    }

    truncated = true;
    // Long page: keep lead + large window around selection + tail
    const lead = articleText.slice(0, 2500);
    const tail = articleText.slice(-1200);
    let around = '';
    if (idx >= 0) {
      const start = Math.max(0, idx - 4500);
      const end = Math.min(articleText.length, idx + selected.length + 4500);
      around =
        articleText.slice(start, idx) +
        '\n【选中开始】\n' +
        selected +
        '\n【选中结束】\n' +
        articleText.slice(idx + selected.length, end);
    } else {
      around = `【选中文本】\n${selected}`;
    }

    articleForModel = [
      '（全文过长，已截取关键部分；请仍按整篇文章主题理解选区）',
      '',
      '【文章开头】',
      lead,
      '',
      '【选区附近】',
      around,
      '',
      '【文章结尾】',
      tail,
    ].join('\n');

    return { before, after, articleForModel, truncated };
  }

  function nearestBlock(node) {
    let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    while (el && el !== document.body) {
      const tag = el.tagName;
      if (['P', 'DIV', 'ARTICLE', 'SECTION', 'LI', 'TD', 'TH', 'BLOCKQUOTE', 'MAIN', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(tag)) {
        return el;
      }
      el = el.parentElement;
    }
    return document.body;
  }

  function buildInitialAnnotateMessages(ctx) {
    const system =
      '你是网页阅读助手。必须结合「整篇文章」的主题、结构和前后文来解读用户选中的片段，而不是孤立解释字面意思。' +
      '说明该选区在全文中的作用、与前后段落/章节的关系，必要时补充专有名词。' +
      '支持多轮追问；若用户附带图片/文件，也一并参考。使用 Markdown，条理清晰。';

    const parts = [
      `页面标题：${ctx.title}`,
      `页面 URL：${ctx.url}`,
      ctx.outline ? `文章大纲：\n${ctx.outline}` : '',
      ctx.articleTruncated
        ? `说明：全文约 ${ctx.articleLength || '?'} 字，已截取开头/选区附近/结尾供你把握全篇。`
        : `说明：以下提供接近完整的正文（约 ${ctx.articleLength || (ctx.article || '').length} 字）。`,
      '',
      '===== 全文/正文上下文 =====',
      ctx.article || `${ctx.before || ''}${ctx.selected}${ctx.after || ''}`,
      '===== 正文结束 =====',
      '',
      `用户选中的文本：\n${ctx.selected}`,
      '',
      '请基于整篇文章对「选中文本」做上下文批注：先点明全文主题，再解释该选区含义及其在文中的位置与作用。',
    ].filter(Boolean);

    return [
      { role: 'system', content: system },
      { role: 'user', content: parts.join('\n') },
    ];
  }

  async function startAnnotateChat(ctx) {
    lastAnnotateCtx = ctx;
    chatApiMessages = buildInitialAnnotateMessages(ctx);
    const ctxHint = ctx.articleTruncated
      ? `已结合全文（约 ${ctx.articleLength} 字，已截取）`
      : `已结合全文（约 ${ctx.articleLength || (ctx.article || '').length} 字）`;
    chatUiMessages = [
      {
        role: 'user',
        text: `选中文本：${ctx.selected}\n（${ctxHint}）`,
      },
    ];
    pendingAttachments = [];
    renderAttachList();

    openPanel({
      title: 'AI 上下文批注',
      meta: `${truncate(ctx.selected, 60)} · ${ctxHint}`,
      mode: 'annotate',
      selected: ctx.selected,
      loading: true,
      chat: true,
    });

    try {
      const result = await send('CHAT', { messages: chatApiMessages, max_tokens: 1200 });
      chatApiMessages.push({ role: 'assistant', content: result });
      chatUiMessages.push({ role: 'assistant', text: result });
      if (panelState) panelState.result = result;
      openPanel({
        title: 'AI 上下文批注',
        meta: truncate(ctx.selected, 80),
        mode: 'annotate',
        selected: ctx.selected,
        result,
        loading: false,
        chat: true,
      });
    } catch (err) {
      chatUiMessages.push({ role: 'assistant', text: `错误：${err.message || err}` });
      openPanel({
        title: 'AI 批注失败',
        meta: truncate(ctx.selected, 80),
        mode: 'annotate',
        selected: ctx.selected,
        loading: false,
        chat: true,
      });
    }
  }

  function buildUserContentFromAttachments(text, attachments) {
    const images = attachments.filter((a) => a.kind === 'image' && a.dataUrl);
    const texts = attachments.filter((a) => a.kind === 'text' && a.text);

    let fullText = text || '';
    if (texts.length) {
      const blocks = texts.map(
        (t) => `\n\n----- 文件: ${t.name} -----\n${t.text}\n----- 文件结束 -----`
      );
      fullText = `${fullText}${blocks.join('')}` || '请结合附件内容继续分析。';
    }
    if (!fullText.trim() && images.length) {
      fullText = '请结合图片内容，结合此前的页面上下文继续分析。';
    }

    if (!images.length) {
      return fullText;
    }

    /** @type {Array<{type: string, text?: string, image_url?: {url: string}}>} */
    const parts = [{ type: 'text', text: fullText }];
    for (const img of images) {
      parts.push({ type: 'image_url', image_url: { url: img.dataUrl } });
    }
    return parts;
  }

  async function submitChatFollowUp() {
    if (!panelEl || panelState?.mode !== 'annotate' || panelState.busy) return;
    const input = panelEl.querySelector('.wa-composer-input');
    if (!(input instanceof HTMLTextAreaElement)) return;
    const text = input.value.trim();
    if (!text && !pendingAttachments.length) return;

    const attachments = pendingAttachments.slice();
    const content = buildUserContentFromAttachments(text, attachments);
    const previews = attachments.map((a) => ({
      kind: a.kind,
      name: a.name,
      url: a.kind === 'image' ? a.dataUrl : undefined,
    }));

    chatApiMessages.push({ role: 'user', content });
    chatUiMessages.push({
      role: 'user',
      text: text || (attachments.length ? `（附带 ${attachments.length} 个文件）` : ''),
      previews,
    });

    input.value = '';
    pendingAttachments = [];
    renderAttachList();
    refreshChatView(true);

    try {
      const result = await send('CHAT', { messages: chatApiMessages, max_tokens: 1200 });
      chatApiMessages.push({ role: 'assistant', content: result });
      chatUiMessages.push({ role: 'assistant', text: result });
      if (panelState) panelState.result = result;
      refreshChatView(false);
    } catch (err) {
      const msg = `错误：${err.message || err}`;
      chatUiMessages.push({ role: 'assistant', text: msg });
      // Keep API history consistent: remove failed user turn? Better keep user turn and not add assistant to API.
      // Optionally pop the user message from API on failure so retry works cleanly.
      chatApiMessages.pop();
      refreshChatView(false);
    }
  }

  function renderAttachList() {
    if (!panelEl) return;
    const list = panelEl.querySelector('.wa-attach-list');
    if (!list) return;
    if (!pendingAttachments.length) {
      list.innerHTML = '';
      return;
    }
    list.innerHTML = pendingAttachments
      .map((a) => {
        if (a.kind === 'image' && a.dataUrl) {
          return `<div class="wa-attach-item" data-id="${a.id}"><img src="${a.dataUrl}" alt="" /><span title="${escapeAttr(a.name)}">${escapeHtml(a.name)}</span><button type="button" data-remove="${a.id}">×</button></div>`;
        }
        return `<div class="wa-attach-item" data-id="${a.id}"><span class="wa-attach-file">📄 ${escapeHtml(a.name)}</span><button type="button" data-remove="${a.id}">×</button></div>`;
      })
      .join('');
  }

  async function onFilesSelected(e) {
    const input = e.target;
    if (!(input instanceof HTMLInputElement) || !input.files?.length) return;
    const files = Array.from(input.files);
    input.value = '';

    for (const file of files) {
      if (pendingAttachments.length >= MAX_ATTACHMENTS) {
        alert(`最多附带 ${MAX_ATTACHMENTS} 个文件`);
        break;
      }
      try {
        const att = await readAttachment(file);
        pendingAttachments.push(att);
      } catch (err) {
        alert(`${file.name}: ${err.message || err}`);
      }
    }
    renderAttachList();
  }

  function readAttachment(file) {
    const mime = (file.type || '').toLowerCase();
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const isImage = IMAGE_TYPES.has(mime) || ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext);
    const isText =
      mime.startsWith('text/') ||
      mime === 'application/json' ||
      mime === 'application/xml' ||
      TEXT_EXTS.has(ext);

    if (isImage) {
      return compressImageFile(file).then((dataUrl) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        kind: 'image',
        name: file.name,
        mime: mime || 'image/jpeg',
        dataUrl,
      }));
    }

    if (isText) {
      return file.text().then((raw) => {
        let text = raw;
        if (text.length > MAX_TEXT_FILE_CHARS) {
          text = `${text.slice(0, MAX_TEXT_FILE_CHARS)}\n\n…(已截断，原文件约 ${raw.length} 字符)`;
        }
        return {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          kind: 'text',
          name: file.name,
          mime: mime || 'text/plain',
          text,
        };
      });
    }

    return Promise.reject(
      new Error('暂不支持该文件类型。请使用图片（PNG/JPG/GIF/WebP）或常见文本文件。')
    );
  }

  function compressImageFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('读取图片失败'));
      reader.onload = () => {
        const src = String(reader.result || '');
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(width, height));
          width = Math.max(1, Math.round(width * scale));
          height = Math.max(1, Math.round(height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(src);
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          const outType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
          resolve(canvas.toDataURL(outType, 0.85));
        };
        img.onerror = () => reject(new Error('图片解码失败'));
        img.src = src;
      };
      reader.readAsDataURL(file);
    });
  }

  async function onToolbarClick(e) {
    const btn = e.target.closest('button[data-action]');
    if (!(btn instanceof HTMLElement)) return;
    const action = btn.dataset.action;

    if (action === 'close') {
      hideToolbar();
      return;
    }
    if (action === 'restore') {
      restorePage();
      hideToolbar();
      return;
    }
    if (action === 'page') {
      hideToolbar();
      await translatePage();
      return;
    }

    const ctx = getSelectionContext() || {
      title: document.title || '',
      url: location.href,
      before: '',
      selected: lastSelectedText,
      after: '',
    };

    if (!ctx.selected) {
      openPanel({
        title: '提示',
        meta: '',
        body: '请先选中一段文字。',
        mode: 'info',
        loading: false,
      });
      return;
    }

    hideToolbar();

    if (action === 'annotate') {
      await startAnnotateChat(ctx);
      return;
    }

    if (action === 'translate') {
      openPanel({
        title: '选区翻译',
        meta: truncate(ctx.selected, 80),
        body: '',
        mode: 'translate',
        selected: ctx.selected,
        loading: true,
      });
      try {
        const result = await send('TRANSLATE', { text: ctx.selected });
        openPanel({
          title: '选区翻译',
          meta: `原文：${truncate(ctx.selected, 80)}`,
          body: result,
          mode: 'translate',
          selected: ctx.selected,
          result,
          loading: false,
        });
      } catch (err) {
        openPanel({
          title: '翻译失败',
          meta: '',
          body: String(err.message || err),
          mode: 'error',
          loading: false,
        });
      }
    }
  }

  async function onPanelClick(e) {
    const removeBtn = e.target.closest('[data-remove]');
    if (removeBtn instanceof HTMLElement) {
      const id = removeBtn.getAttribute('data-remove');
      pendingAttachments = pendingAttachments.filter((a) => a.id !== id);
      renderAttachList();
      return;
    }

    const btn = e.target.closest('button[data-panel]');
    if (!(btn instanceof HTMLElement)) return;
    const action = btn.dataset.panel;

    if (action === 'close' || action === 'close2') {
      closePanel();
      return;
    }
    if (action === 'attach') {
      const fileInput = panelEl?.querySelector('.wa-file-input');
      if (fileInput instanceof HTMLInputElement) fileInput.click();
      return;
    }
    if (action === 'send') {
      await submitChatFollowUp();
      return;
    }
    if (action === 'clear' && panelState?.mode === 'annotate') {
      chatApiMessages = [];
      chatUiMessages = [];
      pendingAttachments = [];
      renderAttachList();
      const ctx =
        lastAnnotateCtx ||
        (panelState.selected
          ? {
              title: document.title || '',
              url: location.href,
              before: '',
              selected: panelState.selected,
              after: '',
              article: '',
              outline: '',
            }
          : null);
      if (ctx?.selected) {
        await startAnnotateChat(ctx);
      } else {
        refreshChatView(false);
      }
      return;
    }
    if (action === 'save' && panelState?.mode === 'annotate') {
      try {
        const transcript = chatUiMessages
          .map((m) => `${m.role === 'user' ? '你' : 'AI'}: ${m.text}`)
          .join('\n\n');
        await send('SAVE_ANNOTATION', {
          url: location.href,
          title: document.title || '',
          selected: panelState.selected,
          result: transcript || panelState.result,
        });
        btn.textContent = '已保存';
        btn.disabled = true;
      } catch (err) {
        alert(err.message || String(err));
      }
      return;
    }
    if (action === 'replace' && panelState?.mode === 'translate' && panelState.result) {
      replaceSelection(panelState.result);
      closePanel();
    }
  }

  function replaceSelection(text) {
    const sel = window.getSelection();
    if (lastRange) {
      sel.removeAllRanges();
      sel.addRange(lastRange);
    }
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(document.createTextNode(text));
    sel.removeAllRanges();
  }

  function truncate(s, n) {
    const t = (s || '').replace(/\s+/g, ' ').trim();
    return t.length > n ? `${t.slice(0, n)}…` : t;
  }

  function collectTextNodes() {
    const nodes = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
        if (parent.closest(`#${ROOT_ID}`)) return NodeFilter.FILTER_REJECT;
        if (parent.closest('[contenteditable="true"]')) return NodeFilter.FILTER_REJECT;
        if (!parent.offsetParent && parent !== document.body && getComputedStyle(parent).position !== 'fixed') {
          const style = getComputedStyle(parent);
          if (style.display === 'none' || style.visibility === 'hidden') {
            return NodeFilter.FILTER_REJECT;
          }
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let current;
    while ((current = walker.nextNode())) {
      nodes.push(/** @type {Text} */ (current));
    }
    return nodes;
  }

  function chunkByLength(items, maxLen) {
    const batches = [];
    let batch = [];
    let len = 0;
    for (const item of items) {
      const l = item.text.length;
      if (batch.length && len + l > maxLen) {
        batches.push(batch);
        batch = [];
        len = 0;
      }
      batch.push(item);
      len += l;
      if (batch.length >= 20) {
        batches.push(batch);
        batch = [];
        len = 0;
      }
    }
    if (batch.length) batches.push(batch);
    return batches;
  }

  async function translatePage() {
    openPanel({
      title: '整页翻译',
      meta: location.hostname,
      body: '',
      mode: 'info',
      loading: true,
    });

    try {
      if (pageTranslated) restorePage();

      const nodes = collectTextNodes()
        .map((node) => ({ node, text: node.nodeValue }))
        .filter((x) => x.text && x.text.trim().length > 0);

      if (!nodes.length) {
        openPanel({
          title: '整页翻译',
          meta: '',
          body: '未找到可翻译的文本。',
          mode: 'info',
          loading: false,
        });
        return;
      }

      const batches = chunkByLength(nodes, 1800);
      let done = 0;

      for (const batch of batches) {
        const texts = batch.map((b) => b.text);
        const translated = await send('TRANSLATE_BATCH', { texts });
        translated.forEach((t, i) => {
          const { node, text } = batch[i];
          if (!originalTexts.has(node)) {
            originalTexts.set(node, text);
            translatedNodes.push(node);
          }
          node.nodeValue = t;
        });
        done += batch.length;
        openPanel({
          title: '整页翻译',
          meta: `进度 ${done}/${nodes.length}`,
          body: '',
          mode: 'info',
          loading: true,
        });
      }

      pageTranslated = true;
      openPanel({
        title: '整页翻译完成',
        meta: `已翻译 ${nodes.length} 处文本`,
        body: '可在划词工具条中点击「还原本页」恢复原文。',
        mode: 'info',
        loading: false,
      });
    } catch (err) {
      openPanel({
        title: '整页翻译失败',
        meta: '',
        body: String(err.message || err),
        mode: 'error',
        loading: false,
      });
    }
  }

  function restorePage() {
    for (const node of translatedNodes) {
      const original = originalTexts.get(node);
      if (original != null && node.parentNode) {
        node.nodeValue = original;
      }
    }
    translatedNodes = [];
    pageTranslated = false;
  }

  function onMouseUp(e) {
    if (e.target instanceof Element && e.target.closest(`#${ROOT_ID}`)) return;
    setTimeout(() => {
      const sel = window.getSelection();
      const text = sel?.toString().trim() || '';
      if (!text || !sel || sel.rangeCount === 0) {
        hideToolbar();
        return;
      }
      lastSelectedText = text;
      lastRange = sel.getRangeAt(0).cloneRange();
      const rect = lastRange.getBoundingClientRect();
      const x = rect.left + rect.width / 2 - 180;
      const y = rect.bottom + 8;
      showToolbar(x, y);
    }, 10);
  }

  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const ae = document.activeElement;
      if (ae && panelEl && panelEl.contains(ae) && (ae.tagName === 'TEXTAREA' || ae.tagName === 'INPUT')) {
        ae.blur();
        return;
      }
      hideToolbar();
      closePanel();
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'WA_TRANSLATE_PAGE') {
      translatePage()
        .then(() => sendResponse({ ok: true }))
        .catch((err) => {
          sendResponse({ ok: false, error: err.message });
        });
      return true;
    }
    if (message?.type === 'WA_RESTORE_PAGE') {
      restorePage();
      sendResponse({ ok: true });
    }
  });
})();
