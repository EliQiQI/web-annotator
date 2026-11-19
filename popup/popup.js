import { getSettings, saveSettings } from '../shared/storage.js';

const form = document.getElementById('settings-form');
const statusEl = document.getElementById('status');
const testBtn = document.getElementById('test-btn');
const translatePageBtn = document.getElementById('translate-page-btn');
const restorePageBtn = document.getElementById('restore-page-btn');

function setStatus(text, kind = '') {
  statusEl.textContent = text;
  statusEl.className = `status${kind ? ` ${kind}` : ''}`;
}

function fillForm(settings) {
  form.baseUrl.value = settings.baseUrl || '';
  form.apiKey.value = settings.apiKey || '';
  form.model.value = settings.model || '';
  form.targetLang.value = settings.targetLang || 'zh';
}

async function init() {
  try {
    const settings = await getSettings();
    fillForm(settings);
  } catch (err) {
    setStatus(err.message || String(err), 'err');
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await saveSettings({
      baseUrl: form.baseUrl.value.trim(),
      apiKey: form.apiKey.value.trim(),
      model: form.model.value.trim(),
      targetLang: form.targetLang.value,
    });
    setStatus('设置已保存', 'ok');
  } catch (err) {
    setStatus(err.message || String(err), 'err');
  }
});

testBtn.addEventListener('click', async () => {
  setStatus('正在测试连接…');
  try {
    await saveSettings({
      baseUrl: form.baseUrl.value.trim(),
      apiKey: form.apiKey.value.trim(),
      model: form.model.value.trim(),
      targetLang: form.targetLang.value,
    });
    const response = await chrome.runtime.sendMessage({ type: 'TEST' });
    if (!response?.ok) throw new Error(response?.error || '测试失败');
    setStatus(`连接成功：${response.data?.reply || 'OK'}`, 'ok');
  } catch (err) {
    setStatus(err.message || String(err), 'err');
  }
});

async function sendToActiveTab(type) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('未找到当前标签页');
  if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://')) {
    throw new Error('当前页面无法注入内容脚本');
  }
  return chrome.tabs.sendMessage(tab.id, { type });
}

translatePageBtn.addEventListener('click', async () => {
  setStatus('已请求翻译当前页…');
  try {
    const res = await sendToActiveTab('WA_TRANSLATE_PAGE');
    if (res && res.ok === false) throw new Error(res.error || '翻译失败');
    setStatus('已开始整页翻译，请查看页面右侧面板', 'ok');
  } catch (err) {
    setStatus(err.message || String(err), 'err');
  }
});

restorePageBtn.addEventListener('click', async () => {
  try {
    await sendToActiveTab('WA_RESTORE_PAGE');
    setStatus('已请求还原当前页', 'ok');
  } catch (err) {
    setStatus(err.message || String(err), 'err');
  }
});

init();
