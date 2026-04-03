// Shared popup utilities and storage helpers.

function sanitizeBaseName(raw) {
  const cleaned = String(raw || 'claude-chat')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/\.+$/g, '')
    .slice(0, 120);
  return cleaned || 'claude-chat';
}

function formatLocalDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatLocalTimestamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day}_${hours}${minutes}${seconds}`;
}

function yamlQuoted(value) {
  return `"${String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')}"`;
}

async function triggerDownload(content, fileName, mime) {
  if (loadUseExportDirectoryEnabled()) {
    const directoryResult = await tryWriteToExportDirectory(content, fileName, mime);
    if (directoryResult && directoryResult.ok) {
      return {
        method: 'directory',
        fileName: directoryResult.fileName,
        directoryName: directoryResult.directoryName,
      };
    }
    if (directoryResult && directoryResult.error) {
      await appendDebugLog('popup', 'export-directory-write-failed', {
        fileName,
        error: directoryResult.error,
      });
    }
  }

  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  try {
    if (chrome.downloads && typeof chrome.downloads.download === 'function') {
      const downloadId = await new Promise((resolve, reject) => {
        chrome.downloads.download({
          url,
          filename: fileName,
          saveAs: false,
          conflictAction: 'uniquify',
        }, (downloadId) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (!downloadId) {
            reject(new Error('浏览器未返回下载任务'));
            return;
          }
          resolve(downloadId);
        });
      });
      return { method: 'downloads', fileName, downloadId };
    }

    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    return { method: 'downloads', fileName, downloadId: null };
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

const WIDGET_IMAGE_PRESET_KEY = 'claude-export-widget-image-preset';
const SELECTION_RUNNER_TAB_KEY = 'claude-export-selection-runner-tab-id';
const DEBUG_LOG_KEY = 'claude-export-debug-log';
const DEBUG_MODE_KEY = 'claude-export-debug-mode-enabled';
const EXPORT_DIR_ENABLED_KEY = 'claude-export-export-dir-enabled';
const EXPORT_DIR_LABEL_KEY = 'claude-export-export-dir-label';
const EXPORT_DIR_DB_NAME = 'claude-export-fs';
const EXPORT_DIR_DB_VERSION = 1;
const EXPORT_DIR_STORE = 'handles';
const EXPORT_DIR_HANDLE_KEY = 'export-directory';
const DEFAULT_WIDGET_IMAGE_PRESET = '300dpi';
let pretextBundlePromise = null;
let exportResourceCache = null;
let exportDirectoryDbPromise = null;

function normalizeWidgetImagePreset(preset) {
  const value = String(preset || '').toLowerCase();
  if (value === '2x') {
    return { id: '2x', label: '2x', scale: 2, dpi: 192 };
  }
  if (value === '600dpi') {
    return { id: '600dpi', label: '600 DPI', scale: 6.25, dpi: 600 };
  }
  return { id: '300dpi', label: '300 DPI', scale: 3.125, dpi: 300 };
}

function loadWidgetImagePresetId() {
  try {
    return normalizeWidgetImagePreset(localStorage.getItem(WIDGET_IMAGE_PRESET_KEY)).id;
  } catch (error) {
    return DEFAULT_WIDGET_IMAGE_PRESET;
  }
}

function saveWidgetImagePresetId(preset) {
  try {
    localStorage.setItem(WIDGET_IMAGE_PRESET_KEY, normalizeWidgetImagePreset(preset).id);
  } catch (error) {
    // Ignore popup-local persistence failures.
  }
}

function loadSelectionRunnerTabId() {
  try {
    const raw = localStorage.getItem(SELECTION_RUNNER_TAB_KEY);
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch (error) {
    return null;
  }
}

function clearSelectionRunnerTabId() {
  try {
    localStorage.removeItem(SELECTION_RUNNER_TAB_KEY);
  } catch (error) {
    // Ignore popup-local persistence failures.
  }
}

function saveSelectionRunnerTabId(tabId) {
  try {
    localStorage.setItem(SELECTION_RUNNER_TAB_KEY, String(tabId));
  } catch (error) {
    // Ignore popup-local persistence failures.
  }
}

function loadDebugModeEnabled() {
  try {
    return localStorage.getItem(DEBUG_MODE_KEY) === '1';
  } catch (error) {
    return false;
  }
}

function saveDebugModeEnabled(enabled) {
  try {
    localStorage.setItem(DEBUG_MODE_KEY, enabled ? '1' : '0');
  } catch (error) {
    // Ignore popup-local persistence failures.
  }
}

function loadUseExportDirectoryEnabled() {
  try {
    return localStorage.getItem(EXPORT_DIR_ENABLED_KEY) === '1';
  } catch (error) {
    return false;
  }
}

function saveUseExportDirectoryEnabled(enabled) {
  try {
    localStorage.setItem(EXPORT_DIR_ENABLED_KEY, enabled ? '1' : '0');
  } catch (error) {
    // Ignore popup-local persistence failures.
  }
}

function loadExportDirectoryLabel() {
  try {
    return localStorage.getItem(EXPORT_DIR_LABEL_KEY) || '';
  } catch (error) {
    return '';
  }
}

function saveExportDirectoryLabel(label) {
  try {
    localStorage.setItem(EXPORT_DIR_LABEL_KEY, String(label || ''));
  } catch (error) {
    // Ignore popup-local persistence failures.
  }
}

function openExportDirectoryDb() {
  if (!exportDirectoryDbPromise) {
    exportDirectoryDbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(EXPORT_DIR_DB_NAME, EXPORT_DIR_DB_VERSION);
      request.onerror = () => reject(request.error || new Error('indexeddb-open-failed'));
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(EXPORT_DIR_STORE)) {
          db.createObjectStore(EXPORT_DIR_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
    });
  }
  return exportDirectoryDbPromise;
}

async function exportDirectoryDbGet(key) {
  const db = await openExportDirectoryDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(EXPORT_DIR_STORE, 'readonly');
    const store = tx.objectStore(EXPORT_DIR_STORE);
    const request = store.get(key);
    request.onerror = () => reject(request.error || new Error('indexeddb-get-failed'));
    request.onsuccess = () => resolve(request.result || null);
  });
}

async function exportDirectoryDbPut(key, value) {
  const db = await openExportDirectoryDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(EXPORT_DIR_STORE, 'readwrite');
    tx.onabort = () => reject(tx.error || new Error('indexeddb-put-failed'));
    tx.onerror = () => reject(tx.error || new Error('indexeddb-put-failed'));
    tx.oncomplete = () => resolve();
    tx.objectStore(EXPORT_DIR_STORE).put(value, key);
  });
}

async function exportDirectoryDbDelete(key) {
  const db = await openExportDirectoryDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(EXPORT_DIR_STORE, 'readwrite');
    tx.onabort = () => reject(tx.error || new Error('indexeddb-delete-failed'));
    tx.onerror = () => reject(tx.error || new Error('indexeddb-delete-failed'));
    tx.oncomplete = () => resolve();
    tx.objectStore(EXPORT_DIR_STORE).delete(key);
  });
}

async function getStoredExportDirectoryHandle() {
  try {
    return await exportDirectoryDbGet(EXPORT_DIR_HANDLE_KEY);
  } catch (error) {
    return null;
  }
}

async function clearStoredExportDirectoryHandle() {
  try {
    await exportDirectoryDbDelete(EXPORT_DIR_HANDLE_KEY);
  } catch (error) {
    // Ignore cleanup failures.
  }
  saveExportDirectoryLabel('');
  saveUseExportDirectoryEnabled(false);
}

async function pickAndStoreExportDirectory() {
  if (typeof window.showDirectoryPicker !== 'function') {
    throw new Error('当前浏览器环境不支持目录选择');
  }
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  if (!handle) {
    throw new Error('目录选择已取消');
  }
  if (typeof handle.requestPermission === 'function') {
    const permission = await handle.requestPermission({ mode: 'readwrite' });
    if (permission !== 'granted') {
      throw new Error('目录写入授权未通过');
    }
  }
  await exportDirectoryDbPut(EXPORT_DIR_HANDLE_KEY, handle);
  saveExportDirectoryLabel(handle.name || '');
  saveUseExportDirectoryEnabled(true);
  return {
    name: handle.name || '已选目录',
  };
}

async function ensureExportDirectoryPermission(handle) {
  if (!handle) return false;
  if (typeof handle.queryPermission !== 'function') return true;
  const status = await handle.queryPermission({ mode: 'readwrite' });
  if (status === 'granted') return true;
  if (typeof handle.requestPermission === 'function') {
    const next = await handle.requestPermission({ mode: 'readwrite' });
    return next === 'granted';
  }
  return false;
}

async function tryWriteToExportDirectory(content, fileName, mime) {
  try {
    const handle = await getStoredExportDirectoryHandle();
    if (!handle) {
      return { ok: false, error: 'missing-directory-handle' };
    }
    const permitted = await ensureExportDirectoryPermission(handle);
    if (!permitted) {
      return { ok: false, error: 'directory-permission-denied' };
    }
    const fileHandle = await handle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(new Blob([content], { type: mime }));
    await writable.close();
    return {
      ok: true,
      fileName,
      directoryName: handle.name || '已选目录',
    };
  } catch (error) {
    return {
      ok: false,
      error: error && error.message ? error.message : String(error),
    };
  }
}

async function ensureConfiguredExportDirectoryReady() {
  if (!loadUseExportDirectoryEnabled()) {
    return { enabled: false, ready: false };
  }
  const handle = await getStoredExportDirectoryHandle();
  if (!handle) {
    return { enabled: true, ready: false, error: 'missing-directory-handle' };
  }
  const permitted = await ensureExportDirectoryPermission(handle);
  if (!permitted) {
    return { enabled: true, ready: false, error: 'directory-permission-denied' };
  }
  return {
    enabled: true,
    ready: true,
    directoryName: handle.name || '已选目录',
  };
}

async function loadTextResource(resourceName) {
  const url = chrome.runtime.getURL(resourceName);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`资源读取失败：${resourceName}`);
  }
  return String(await response.text() || '');
}

async function loadExportResources() {
  if (!exportResourceCache) {
    exportResourceCache = (async () => {
      const pageCss = await loadTextResource('export-page.css');
      const pageScript = (await loadTextResource('export-page.js')).replace(/<\/script/gi, '<\\/script');
      const widgetThemeCss = await loadTextResource('widget-theme.css');
      const widgetShell = await loadTextResource('widget-srcdoc-shell.html');
      return {
        pageCss,
        pageScript,
        widgetThemeCss,
        widgetShell,
      };
    })();
  }
  return exportResourceCache;
}

async function loadPretextBundleText() {
  if (!pretextBundlePromise) {
    pretextBundlePromise = (async () => {
      try {
        const url = chrome.runtime.getURL('pretext.min.js');
        const resp = await fetch(url);
        if (!resp.ok) return '';
        return String(await resp.text() || '').replace(/<\/script/gi, '<\\/script');
      } catch (error) {
        return '';
      }
    })();
  }
  return pretextBundlePromise;
}

function stringifyDebugDetail(detail) {
  if (detail == null) return '';
  if (typeof detail === 'string') return detail.slice(0, 1200);
  try {
    return JSON.stringify(detail).slice(0, 1200);
  } catch (error) {
    return String(detail).slice(0, 1200);
  }
}

async function appendDebugLog(source, event, detail = null) {
  try {
    if (!loadDebugModeEnabled()) return;
    if (!chrome.storage || !chrome.storage.local) return;
    const payload = {
      at: new Date().toISOString(),
      source: String(source || 'popup'),
      event: String(event || 'event'),
      detail: stringifyDebugDetail(detail),
    };
    const current = await new Promise((resolve) => {
      chrome.storage.local.get([DEBUG_LOG_KEY], (result) => {
        if (chrome.runtime.lastError) {
          resolve([]);
          return;
        }
        resolve(Array.isArray(result && result[DEBUG_LOG_KEY]) ? result[DEBUG_LOG_KEY] : []);
      });
    });
    const next = current.concat(payload).slice(-400);
    await new Promise((resolve) => {
      chrome.storage.local.set({ [DEBUG_LOG_KEY]: next }, () => resolve());
    });
  } catch (error) {
    // 临时日志失败不能反向影响主流程。
  }
}

function readPageDebugLog() {
  const store = Array.isArray(window.__CLAUDE_EXPORT_PAGE_DEBUG) ? window.__CLAUDE_EXPORT_PAGE_DEBUG.slice() : [];
  window.__CLAUDE_EXPORT_PAGE_DEBUG = [];
  return store;
}

async function flushPageDebugLog(tabId, fallbackSource = 'page') {
  if (!tabId) return;
  if (!loadDebugModeEnabled()) return;
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: readPageDebugLog,
      world: 'MAIN',
    });
    const logs = Array.isArray(result && result.result) ? result.result : [];
    for (const entry of logs) {
      await appendDebugLog(entry.source || fallbackSource, entry.event || 'page-log', entry.detail || '');
    }
  } catch (error) {
    await appendDebugLog('popup', 'flush-page-debug-failed', { tabId, error: error.message || String(error) });
  }
}

function readExportProgress(runId) {
  const key = String(runId || '');
  if (!key) return null;
  const store = window.__CLAUDE_EXPORT_RUNS || {};
  return store[key] || null;
}

function formatMarkdownBlockquote(text) {
  const lines = String(text || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd());
  const safeLines = lines.length > 0 ? lines : [''];
  return safeLines.map((line) => `> ${line || ' '}`).join('\n');
}

function joinTextContentParts(parts, separator = '\n') {
  const blocks = Array.isArray(parts)
    ? parts
        .filter((part) => part && part.type === 'text')
        .map((part) => String(part.text || ''))
        .filter((part) => part.length > 0)
    : [];
  let combined = '';
  for (const block of blocks) {
    if (!combined) {
      combined = block;
      continue;
    }
    const prevEndsWithWhitespace = /[\s\n]$/.test(combined);
    const nextStartsWithWhitespace = /^[\s\n]/.test(block);
    combined += (prevEndsWithWhitespace || nextStartsWithWhitespace) ? '' : separator;
    combined += block;
  }
  return combined;
}

function escapeMarkdownHeadingText(text) {
  return String(text || '')
    .replace(/\r?\n+/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\\/g, '\\\\')
    .replace(/([`*_{}\[\]()#+.!|~-])/g, '\\$1')
    .trim();
}

function buildPromptSummaryMarkdown(promptSummaries) {
  if (!Array.isArray(promptSummaries) || promptSummaries.length === 0) return '';
  const blocks = promptSummaries.map((item, index) => {
    const label = escapeMarkdownHeadingText(item && item.label || `问题 ${index + 1}`);
    const text = String(item && item.text || '（该条用户消息主要是附件或空文本，没有可提取的 prompt 文本。）').trim();
    return `### 问题 ${index + 1}：${label}\n${formatMarkdownBlockquote(text)}`;
  });
  return `## 用户问题汇总\n\n${blocks.join('\n\n')}\n`;
}

function buildObsidianMarkdown({ title, htmlFileName, sourceUrl, promptSummaries }) {
  const date = formatLocalDate();
  const relativeHref = encodeURI(`./${htmlFileName}`);
  const promptSummarySection = buildPromptSummaryMarkdown(promptSummaries);
  return `---
title: ${yamlQuoted(title || 'Claude Chat')}
tags: [export, claude, visualization]
date: ${date}
source: ${yamlQuoted(sourceUrl || 'https://claude.ai')}
html_export: ${yamlQuoted(htmlFileName)}
---

# ${title || 'Claude Chat'}

> [!info]
> 交互版 HTML 已和这篇索引笔记一同导出。
> Obsidian 原生对本地 HTML iframe / script 的支持并不可靠，这篇笔记默认改为“索引 + 打开入口”，不再尝试在 Markdown 里硬嵌交互页。

## 打开交互版

- [[${htmlFileName}|打开交互版 HTML]]
- [通过相对路径打开](${relativeHref})

${promptSummarySection ? `${promptSummarySection}\n` : ''}## 说明

- 如果点击后在 Obsidian 内还是不显示，请直接在文件管理器或默认浏览器中打开 \`${htmlFileName}\`。
- 这篇笔记的作用是检索、标签、双链和归档管理；真正的交互内容保存在同目录 HTML 附件里。
`;
}

// ── 提取消息摘要列表（在页面上下文执行）────────────────────────
