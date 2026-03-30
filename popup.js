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

function triggerDownload(content, fileName, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const WIDGET_IMAGE_PRESET_KEY = 'claude-export-widget-image-preset';
const DEFAULT_WIDGET_IMAGE_PRESET = '300dpi';

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

const widgetImagePresetSelect = document.getElementById('widgetImagePreset');
if (widgetImagePresetSelect) {
  widgetImagePresetSelect.value = loadWidgetImagePresetId();
  widgetImagePresetSelect.addEventListener('change', () => {
    saveWidgetImagePresetId(widgetImagePresetSelect.value);
  });
}

document.getElementById('exportBtn').addEventListener('click', async () => {
  const btn = document.getElementById('exportBtn');
  const includeThinking = Boolean(document.getElementById('includeThinking')?.checked);
  const widgetImageExport = normalizeWidgetImagePreset(widgetImagePresetSelect?.value || DEFAULT_WIDGET_IMAGE_PRESET);
  saveWidgetImagePresetId(widgetImageExport.id);
  const status = document.getElementById('status');
  btn.disabled = true;
  status.className = '';
  status.textContent = '正在提取聊天记录…';

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab.url.includes('claude.ai')) {
    status.textContent = '请在 Claude 聊天页面使用';
    status.className = 'error';
    btn.disabled = false;
    return;
  }

  try {
    const runId = `claude-export-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let pollTimer = null;
    let pollBusy = false;
    let pollingActive = true;

    const stopPolling = () => {
      pollingActive = false;
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    const pollProgress = async () => {
      if (pollBusy || !pollingActive) return;
      pollBusy = true;
      try {
        const [progressResult] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: readExportProgress,
          args: [runId],
          world: 'MAIN'
        });
        const progress = progressResult && progressResult.result;
        if (pollingActive && progress && progress.message) {
          status.textContent = progress.message;
        }
      } catch (e) {
        // Popup polling is best-effort; final result still comes from the main export call.
      } finally {
        pollBusy = false;
      }
    };

    const exportPromise = chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractAndBuild,
      args: [runId, { includeThinking, widgetImageExport }],
      world: 'MAIN'
    });
    pollTimer = setInterval(() => {
      pollProgress();
    }, 350);
    await pollProgress();

    let results;
    try {
      results = await exportPromise;
    } finally {
      stopPolling();
    }

    const { html, title, error } = results[0].result;

    if (error) {
      status.textContent = '提取失败：' + error;
      status.className = 'error';
      btn.disabled = false;
      return;
    }

    const baseName = sanitizeBaseName(`${title || 'claude-chat'}_${formatLocalTimestamp()}`);
    const htmlFileName = `${baseName}.html`;
    const mdFileName = `${baseName}.md`;
    const md = buildObsidianMarkdown({
      title: title || 'Claude Chat',
      htmlFileName,
      sourceUrl: tab.url,
      promptSummaries: Array.isArray(results[0].result.promptSummaries) ? results[0].result.promptSummaries : [],
    });

    triggerDownload(html, htmlFileName, 'text/html;charset=utf-8');
    await new Promise(resolve => setTimeout(resolve, 150));
    triggerDownload(md, mdFileName, 'text/markdown;charset=utf-8');

    status.textContent = '✅ 已导出 HTML + Obsidian 模板';
    status.className = 'success';
  } catch (e) {
    status.textContent = '导出失败：' + e.message;
    status.className = 'error';
  }
  btn.disabled = false;
});

// =====================================================================
// 以下函数在页面上下文（claude.ai）中执行
// =====================================================================
function extractAndBuild(runId, options) {
  const exportRunId = String(runId || `claude-export-${Date.now()}`);
  const includeThinking = Boolean(options && options.includeThinking);
  const normalizeWidgetImageExport = (value) => {
    const preset = value && typeof value === 'object' ? value : {};
    const scale = Number(preset.scale);
    const dpi = Number(preset.dpi);
    const id = String((preset && preset.id) || '').toLowerCase();
    if (id === '2x' || Math.abs(scale - 2) < 0.001) {
      return { id: '2x', label: '2x', scale: 2, dpi: 192 };
    }
    if (id === '600dpi' || Math.abs(dpi - 600) < 0.001) {
      return { id: '600dpi', label: '600 DPI', scale: 6.25, dpi: 600 };
    }
    return { id: '300dpi', label: '300 DPI', scale: 3.125, dpi: 300 };
  };
  const widgetImageExport = normalizeWidgetImageExport(options && options.widgetImageExport);
  const progressStore = window.__CLAUDE_EXPORT_RUNS || (window.__CLAUDE_EXPORT_RUNS = {});
  const setProgress = (patch) => {
    progressStore[exportRunId] = {
      runId: exportRunId,
      updatedAt: Date.now(),
      ...(progressStore[exportRunId] || {}),
      ...patch,
    };
  };
  const scheduleProgressCleanup = () => {
    setTimeout(() => {
      if (progressStore[exportRunId]) delete progressStore[exportRunId];
    }, 30000);
  };
  const fail = (error) => {
    const message = `提取失败：${error}`;
    setProgress({ state: 'error', stage: 'error', message });
    scheduleProgressCleanup();
    return { html: null, title: '', error };
  };

  setProgress({ state: 'running', stage: 'extract', message: '正在提取聊天记录…', completed: 0, total: 0 });

  // ── 工具：HTML 转义 ──────────────────────────────────────────────
  function escHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getFileIcon(typeOrName) {
    const s = String(typeOrName || '').toLowerCase();
    if (s.includes('pdf')) return '📄';
    if (s.includes('image') || /\.(png|jpg|jpeg|gif|webp|svg)$/.test(s)) return '🖼️';
    if (s.includes('md') || s.includes('markdown')) return '📝';
    if (s.includes('csv') || s.includes('excel') || s.includes('xlsx') || s.includes('xls')) return '📊';
    if (s.includes('zip') || s.includes('tar') || s.includes('rar') || s.includes('gz')) return '🗜️';
    if (s.includes('code') || /\.(js|ts|py|java|c|cpp|go|rs|rb|php|html|css|json|xml|yaml|yml)$/.test(s)) return '💻';
    return '📎';
  }

  function isMarkdownLike(typeOrName) {
    const s = String(typeOrName || '').toLowerCase();
    return s.includes('md') || s.includes('markdown') || /\.md$/.test(s);
  }

  function isImageLike(typeOrName) {
    const s = String(typeOrName || '').toLowerCase();
    return s.includes('image') || /\.(png|jpg|jpeg|gif|webp|svg)$/.test(s);
  }

  function formatFileSize(bytes) {
    const size = Number(bytes || 0);
    if (!Number.isFinite(size) || size <= 0) return '';
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1).replace(/\.0$/, '')} KB`;
    return `${(size / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB`;
  }

  function parseTimestampValue(rawValue) {
    if (rawValue == null || rawValue === '') return null;
    if (typeof rawValue === 'number') {
      return rawValue < 1e12 ? new Date(rawValue * 1000) : new Date(rawValue);
    }
    if (typeof rawValue === 'string' && /^\d+(\.\d+)?$/.test(rawValue.trim())) {
      const numeric = Number(rawValue);
      return numeric < 1e12 ? new Date(numeric * 1000) : new Date(numeric);
    }
    const parsed = new Date(rawValue);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function formatMessageTimestamp(msg) {
    const candidates = [msg.stop_timestamp, msg.created_at, msg.updated_at];
    let date = null;
    for (const value of candidates) {
      date = parseTimestampValue(value);
      if (date) break;
    }
    if (!date) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
  }

  function guessMime(fileName, fileType) {
    const type = String(fileType || '').toLowerCase();
    if (type.includes('/')) return type;

    const ext = String(fileName || '').split('.').pop().toLowerCase();
    const map = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      svg: 'image/svg+xml',
      pdf: 'application/pdf',
      md: 'text/markdown',
      txt: 'text/plain',
      csv: 'text/csv',
      json: 'application/json',
      xml: 'text/xml',
      js: 'text/javascript',
      ts: 'text/typescript',
      py: 'text/x-python',
      html: 'text/html',
      css: 'text/css',
      sh: 'text/x-sh',
      yaml: 'text/yaml',
      yml: 'text/yaml',
    };
    return map[ext] || 'application/octet-stream';
  }

  function isTextMime(mime) {
    return /^text\//.test(mime) || [
      'application/json',
      'text/xml',
      'application/javascript',
      'text/javascript',
      'text/typescript',
      'text/markdown',
    ].includes(mime);
  }

  function isImageMime(mime) {
    return /^image\//.test(mime);
  }

  function bufToBase64(buf) {
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    return btoa(binary);
  }

  function textToDataUrl(text, mime) {
    return `data:${mime};charset=utf-8,${encodeURIComponent(text)}`;
  }

  async function fetchWithTimeout(resource, options = {}, timeoutMs = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(resource, {
        ...options,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchWithRetry(resource, options = {}, config = {}) {
    const retries = Number.isFinite(config.retries) ? config.retries : 2;
    const timeoutMs = Number.isFinite(config.timeoutMs) ? config.timeoutMs : 8000;
    const retryDelayMs = Number.isFinite(config.retryDelayMs) ? config.retryDelayMs : 450;
    const shouldRetryResponse = typeof config.shouldRetryResponse === 'function'
      ? config.shouldRetryResponse
      : (response) => !response.ok && [408, 425, 429, 500, 502, 503, 504].includes(response.status);
    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const response = await fetchWithTimeout(resource, options, timeoutMs);
        if (shouldRetryResponse(response)) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response;
      } catch (error) {
        lastError = error;
        if (attempt >= retries) break;
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
      }
    }

    throw lastError || new Error('unknown fetch error');
  }

  function formatFetchError(error) {
    if (!error) return 'unknown error';
    if (error.name === 'AbortError') return '请求超时（已重试）';
    return error.message || String(error);
  }

  async function fetchFileContent(att, orgUuid, chatUuid) {
    try {
      if (att.source === 'attachments' && att.extractedContent) {
        return { text: att.extractedContent };
      }

      if (att.previewUrl) {
        const resp = await fetchWithRetry(att.previewUrl);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const buf = await resp.arrayBuffer();
        if (!buf.byteLength) throw new Error('empty response');
        const mime = resp.headers.get('content-type') || guessMime(att.name, att.type);
        return { dataUrl: `data:${mime};base64,${bufToBase64(buf)}` };
      }

      if (att.path) {
        if (!orgUuid || !chatUuid) throw new Error('missing org/chat uuid');
        const mime = guessMime(att.name, att.type);

        // Claude does not expose binary content for file-picker uploads (`blob`).
        // Skip the doomed request and surface a precise explanation in the UI.
        if (att.kind === 'blob' && !isTextMime(mime)) {
          return {
            unavailable: true,
            reason: 'blob-binary',
          };
        }

        const url = `/api/organizations/${orgUuid}/conversations/${chatUuid}/wiggle/download-file?path=${encodeURIComponent(att.path)}`;
        const resp = await fetchWithRetry(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        if (isTextMime(mime)) {
          return { text: await resp.text() };
        }
        const buf = await resp.arrayBuffer();
        if (!buf.byteLength) throw new Error('empty binary response');
        return { dataUrl: `data:${mime};base64,${bufToBase64(buf)}` };
      }

      return {};
    } catch (e) {
      return { fetchError: formatFetchError(e) };
    }
  }

  async function fetchUrlAsDataUrl(rawUrl) {
    try {
      if (!rawUrl || /^data:/i.test(rawUrl)) return null;
      const url = new URL(rawUrl, location.href);
      if (url.origin !== location.origin) return null;

      const resp = await fetchWithRetry(url.href);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const buf = await resp.arrayBuffer();
      if (!buf.byteLength) throw new Error('empty binary response');

      const mime = resp.headers.get('content-type') || guessMime(url.pathname, '');
      return `data:${mime};base64,${bufToBase64(buf)}`;
    } catch (e) {
      return null;
    }
  }

  async function inlineMarkdownAssetUrls(text) {
    if (!text || !text.includes('![')) return text;

    let result = text;
    const matches = Array.from(text.matchAll(/!\[([^\]]*)\]\((\S+?)(?:\s+"([^"]*)")?\)/g));
    for (const match of matches) {
      const fullMatch = match[0];
      const src = match[2];
      if (!src || /^data:/i.test(src)) continue;

      const dataUrl = await fetchUrlAsDataUrl(src);
      if (!dataUrl) continue;

      result = result.replace(fullMatch, fullMatch.replace(src, dataUrl));
    }
    return result;
  }

  async function inlineHtmlImageUrls(text) {
    if (!text || !/<img\b/i.test(text)) return text;

    let result = text;
    const matches = Array.from(text.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi));
    for (const match of matches) {
      const fullMatch = match[0];
      const src = match[1];
      if (!src || /^data:/i.test(src)) continue;

      const dataUrl = await fetchUrlAsDataUrl(src);
      if (!dataUrl) continue;

      result = result.replace(fullMatch, fullMatch.replace(src, dataUrl));
    }
    return result;
  }

  async function inlineTextAssetUrls(text) {
    let result = text || '';
    result = await inlineMarkdownAssetUrls(result);
    result = await inlineHtmlImageUrls(result);
    return result;
  }

  // ── 工具：轻量 Markdown → HTML（无外部依赖）────────────────────
  function md2html(text) {
    if (!text || !text.trim()) return '';
    let html = text;

    // 先保存代码块，防止内部内容被其他规则误处理
    const codeBlocks = [];
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      const ph = `%%CB${codeBlocks.length}%%`;
      codeBlocks.push(
        `<pre><code class="language-${lang || 'text'}">${escHtml(code.trim())}</code></pre>`
      );
      return ph;
    });

    const inlineTokens = [];
    function stashInline(fragment) {
      const ph = `%%IN${inlineTokens.length}%%`;
      inlineTokens.push(fragment);
      return ph;
    }

    // 内联代码
    html = html.replace(/`([^`\n]+)`/g, (_, c) => stashInline(`<code>${escHtml(c)}</code>`));

    // 图片 / 链接
    html = html.replace(/!\[([^\]]*)\]\((\S+?)(?:\s+"([^"]*)")?\)/g, (_, alt, src, title) => {
      const attrs = [
        `src="${escHtml(src)}"`,
        `alt="${escHtml(alt)}"`,
        title ? `title="${escHtml(title)}"` : ''
      ].filter(Boolean).join(' ');
      return stashInline(`<img ${attrs}>`);
    });
    html = html.replace(/\[([^\]]+)\]\((\S+?)(?:\s+"([^"]*)")?\)/g, (_, label, href, title) => {
      const attrs = [
        `href="${escHtml(href)}"`,
        title ? `title="${escHtml(title)}"` : '',
        'target="_blank"',
        'rel="noopener noreferrer"'
      ].filter(Boolean).join(' ');
      return stashInline(`<a ${attrs}>${escHtml(label)}</a>`);
    });

    // 粗斜体 / 粗体 / 斜体
    html = html.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');

    // 标题
    html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^### (.+)$/gm,  '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm,   '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm,    '<h1>$1</h1>');

    // 水平线
    html = html.replace(/^---+$/gm, '<hr>');

    // 列表（无序 / 有序）
    const lines = html.split('\n');
    const buf = [];
    let inUl = false, inOl = false;
    for (const line of lines) {
      const um = line.match(/^(\s*)[-*+] (.+)$/);
      const om = line.match(/^\s*\d+\. (.+)$/);
      if (um) {
        if (!inUl) { buf.push('<ul>'); inUl = true; }
        buf.push(`<li>${um[2]}</li>`);
      } else if (om) {
        if (!inOl) { buf.push('<ol>'); inOl = true; }
        buf.push(`<li>${om[1]}</li>`);
      } else {
        if (inUl) { buf.push('</ul>'); inUl = false; }
        if (inOl) { buf.push('</ol>'); inOl = false; }
        buf.push(line);
      }
    }
    if (inUl) buf.push('</ul>');
    if (inOl) buf.push('</ol>');
    html = buf.join('\n');

    function splitTableRow(line) {
      return line
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map(cell => cell.trim());
    }

    function isTableBlock(block) {
      const lines = block.split('\n').map(line => line.trim()).filter(Boolean);
      if (lines.length < 2) return false;
      const headerOk = /^\|?.+\|.+\|?$/.test(lines[0]);
      const dividerOk = /^\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?$/.test(lines[1]);
      return headerOk && dividerOk;
    }

    function parseTableAlignments(line) {
      return splitTableRow(line).map(cell => {
        const trimmed = cell.trim();
        const left = trimmed.startsWith(':');
        const right = trimmed.endsWith(':');
        if (left && right) return 'center';
        if (right) return 'right';
        if (left) return 'left';
        return '';
      });
    }

    function renderTable(block) {
      const lines = block.split('\n').map(line => line.trim()).filter(Boolean);
      const headers = splitTableRow(lines[0]);
      const aligns = parseTableAlignments(lines[1]);
      const rows = lines.slice(2).map(splitTableRow);
      const cellStyle = idx => aligns[idx] ? ` style="text-align: ${aligns[idx]}"` : '';
      const thead = `<thead><tr>${headers.map((cell, idx) => `<th${cellStyle(idx)}>${cell}</th>`).join('')}</tr></thead>`;
      const tbody = `<tbody>${rows.map(row =>
        `<tr>${row.map((cell, idx) => `<td${cellStyle(idx)}>${cell}</td>`).join('')}</tr>`
      ).join('')}</tbody>`;
      return `<table>${thead}${tbody}</table>`;
    }

    function isBlockquoteBlock(block) {
      const lines = block.split('\n').map(line => line.trim()).filter(Boolean);
      return lines.length > 0 && lines.every(line => /^>\s?/.test(line));
    }

    function renderBlockquote(block) {
      const inner = block
        .split('\n')
        .map(line => line.replace(/^>\s?/, ''))
        .join('\n')
        .trim();
      return `<blockquote>${md2html(inner)}</blockquote>`;
    }

    // 段落 / 表格 / 引用
    html = html.split(/\n{2,}/).map(block => {
      block = block.trim();
      if (!block) return '';
      if (isTableBlock(block)) return renderTable(block);
      if (isBlockquoteBlock(block)) return renderBlockquote(block);
      if (/^<(h[1-6]|ul|ol|pre|hr|blockquote|table)/.test(block)) return block;
      return `<p>${block.replace(/\n/g, '<br>')}</p>`;
    }).filter(Boolean).join('\n');

    inlineTokens.forEach((fragment, i) => { html = html.replaceAll(`%%IN${i}%%`, fragment); });
    // 恢复代码块
    codeBlocks.forEach((cb, i) => { html = html.replace(`%%CB${i}%%`, cb); });
    html = html.replace(/<p>(%%CB\d+%%)<\/p>/g, '$1');
    return html;
  }

  function renderAttachmentDialog(att, dialogId) {
    const mime = guessMime(att.name, att.type);
    const hasTextContent = typeof att.text === 'string';
    const canCopyAsText = hasTextContent && (isTextMime(mime) || isMarkdownLike(att.type || att.name));
    const textDownloadMime = isMarkdownLike(att.type || att.name)
      ? 'text/markdown;charset=utf-8'
      : 'text/plain;charset=utf-8';
    const textDataUrl = canCopyAsText ? textToDataUrl(att.text, textDownloadMime) : '';
    const downloadHref = att.dataUrl || textDataUrl;
    const copySourceId = `${dialogId}-copy-source`;
    const chips = [
      att.type ? `类型：${escHtml(att.type)}` : '',
      att.size ? `大小：${escHtml(formatFileSize(att.size))}` : '',
      att.source === 'attachments' ? '来源：attachments' : '来源：files',
      att.uuid ? `UUID：${escHtml(att.uuid)}` : '',
    ].filter(Boolean);

    let previewHtml = '';
    if (att.unavailable) {
      const isBlobBinary = att.reason === 'blob-binary';
      previewHtml = `
<div class="attachment-preview attachment-empty">
  <div style="font-size: 2em; margin-bottom: 8px">${getFileIcon(att.type || att.name)}</div>
  <strong>${escHtml(att.name)}</strong>
  <p style="margin: 8px 0 0; color: #9ca3af; font-size: 12px">
    ${isBlobBinary
      ? '此文件通过文件选择器上传，Claude 将其作为文档而非图片处理，服务端不提供文件内容下载接口（即使在 claude.ai 里也无法预览）。'
      : '服务端不提供此文件的内容接口。'}
  </p>
</div>`;
    } else if (att.fetchError) {
      previewHtml = `<div class="attachment-preview attachment-empty">⚠️ 抓取失败：${escHtml(att.fetchError)}</div>`;
    } else if (att.dataUrl) {
      if (isImageMime(mime) || att.dataUrl.startsWith('data:image/')) {
        previewHtml = `
<div class="attachment-preview">
  <img src="${escHtml(att.dataUrl)}" alt="${escHtml(att.name)}">
</div>
<div class="att-actions">
  <a class="att-dl-btn" href="${escHtml(att.dataUrl)}" download="${escHtml(att.name)}">⬇️ 下载原图</a>
</div>`;
      } else if (mime === 'application/pdf') {
        previewHtml = `
<div class="attachment-preview">
  <embed src="${escHtml(att.dataUrl)}" type="application/pdf" width="100%" height="600">
</div>
<div class="att-actions">
  <a class="att-dl-btn" href="${escHtml(att.dataUrl)}" download="${escHtml(att.name)}">⬇️ 下载 PDF</a>
</div>`;
      } else {
        previewHtml = `
<div class="attachment-preview attachment-empty">二进制文件已内联，点击下载查看。</div>
<div class="att-actions">
  <a class="att-dl-btn" href="${escHtml(att.dataUrl)}" download="${escHtml(att.name)}">⬇️ 下载文件</a>
</div>`;
      }
    } else if (hasTextContent) {
      if (isMarkdownLike(att.type || att.name)) {
        previewHtml = `<div class="attachment-preview md">${md2html(att.text)}</div>`;
      } else {
        previewHtml = `<pre class="attachment-preview attachment-pre">${escHtml(att.text)}</pre>`;
      }
      if (canCopyAsText) {
        previewHtml += `
<textarea id="${copySourceId}" class="att-copy-source" aria-hidden="true" tabindex="-1">${escHtml(att.text)}</textarea>
<div class="att-actions">
  ${downloadHref
    ? `<a class="att-dl-btn" href="${escHtml(downloadHref)}" download="${escHtml(att.name)}">⬇️ 下载文本</a>`
    : ''}
  <button type="button" class="att-dl-btn att-copy-btn" data-copy-source-id="${copySourceId}">📋 复制文本</button>
</div>`;
      }
    } else {
      previewHtml = `<div class="attachment-preview attachment-empty">离线导出未包含该附件的原始文件内容，目前只能显示文件名和元数据。要做到“点开就是原文件”，还需要在导出时额外抓取二进制内容。</div>`;
    }

    return `
<dialog id="${dialogId}" class="att-dialog">
  <div class="att-dialog-body">
    <div class="att-dialog-header">
      <div class="att-dialog-title">${getFileIcon(att.type || att.name)} ${escHtml(att.name)}</div>
      <button type="button" class="att-dialog-close" data-close-dialog>关闭</button>
    </div>
    ${chips.length > 0 ? `<div class="att-dialog-meta">${chips.map(chip => `<span class="att-dialog-chip">${chip}</span>`).join('')}</div>` : ''}
    ${previewHtml}
  </div>
</dialog>`;
  }

  function makeAnchorId(prefix, raw, index) {
    const slug = String(raw || prefix || 'section')
      .toLowerCase()
      .replace(/&quot;/g, '')
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64);
    return `${prefix}-${slug || 'section'}-${index}`;
  }

  function copyIconSvg() {
    return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"></rect><rect x="4" y="4" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"></rect></svg>`;
  }

  function moreIconSvg() {
    return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="6.5" cy="12" r="1.7" fill="currentColor"></circle><circle cx="12" cy="12" r="1.7" fill="currentColor"></circle><circle cx="17.5" cy="12" r="1.7" fill="currentColor"></circle></svg>`;
  }

  function downloadIconSvg() {
    return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 4v9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path><path d="m8.5 10.5 3.5 3.5 3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path><path d="M5 18.5h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path></svg>`;
  }

  function checkIconSvg() {
    return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m5 12.5 4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>`;
  }

  function summarizePromptLabel(text, index) {
    const compact = String(text || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!compact) return `问题 ${index}`;
    return compact.length > 28 ? `${compact.slice(0, 28)}…` : compact;
  }

  function joinMarkdownParts(parts) {
    const blocks = Array.isArray(parts)
      ? parts.filter((part) => typeof part === 'string' && part.length > 0)
      : [];
    let combined = '';
    for (const block of blocks) {
      if (!combined) {
        combined = block;
        continue;
      }
      const prevEndsWithWhitespace = /[\s\n]$/.test(combined);
      const nextStartsWithWhitespace = /^[\s\n]/.test(block);
      combined += (prevEndsWithWhitespace || nextStartsWithWhitespace) ? '' : '\n\n';
      combined += block;
    }
    return combined;
  }

  function isThinkingPart(part) {
    const type = String(part && part.type || '').toLowerCase();
    return type.includes('thinking');
  }

  function extractThinkingText(value, seen = new WeakSet()) {
    if (value == null) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value !== 'object') return '';
    if (seen.has(value)) return '';
    seen.add(value);

    if (Array.isArray(value)) {
      const merged = value
        .map((item) => extractThinkingText(item, seen))
        .filter(Boolean);
      return Array.from(new Set(merged)).join('\n\n').trim();
    }

    const fragments = [];
    const keys = ['thinking', 'text', 'summary', 'content', 'parts', 'segments', 'items', 'messages', 'children', 'value'];
    keys.forEach((key) => {
      if (!(key in value)) return;
      const fragment = extractThinkingText(value[key], seen);
      if (fragment) fragments.push(fragment);
    });

    return Array.from(new Set(fragments)).join('\n\n').trim();
  }

  function renderThinkingBlock(text) {
    const hasText = Boolean(text && text.trim());
    const title = hasText ? '💭 思维链' : '💭 思维链（未公开具体内容）';
    const body = hasText
      ? `<div class="thinking-content md">${md2html(text)}</div>`
      : `<div class="thinking-content"><p>当前对话数据只标记存在 thinking block，但没有暴露可读文本，所以这里先保留一个占位，避免被静默丢弃。</p></div>`;
    return `
<details class="thinking-block">
  <summary>${title}</summary>
  ${body}
</details>`;
  }

  // ── 工具：widget_code → 完整独立 srcdoc HTML ───────────────────
  function makeWidgetSrcdoc(widgetCode, iframeId, imageExport) {
    const frameIdLiteral = JSON.stringify(String(iframeId || ''));
    const exportScaleLiteral = JSON.stringify(Number(imageExport && imageExport.scale) || 3.125);
    const exportDpiLiteral = JSON.stringify(Number(imageExport && imageExport.dpi) || 300);
    const resizeScript = `<script>
(() => {
  const frameId = ${frameIdLiteral};
  const defaultCaptureScale = ${exportScaleLiteral};
  const defaultCaptureDpi = ${exportDpiLiteral};
  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let j = 0; j < 8; j += 1) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c >>> 0;
    }
    return table;
  })();
  const collectStyleText = () => Array.from(document.querySelectorAll('style'))
    .map((node) => node.textContent || '')
    .join('\\n');
  const readUint32 = (bytes, offset) => (
    (((bytes[offset] << 24) >>> 0) |
    ((bytes[offset + 1] << 16) >>> 0) |
    ((bytes[offset + 2] << 8) >>> 0) |
    (bytes[offset + 3] >>> 0)) >>> 0
  );
  const writeUint32 = (bytes, offset, value) => {
    bytes[offset] = (value >>> 24) & 255;
    bytes[offset + 1] = (value >>> 16) & 255;
    bytes[offset + 2] = (value >>> 8) & 255;
    bytes[offset + 3] = value & 255;
  };
  const asciiBytes = (text) => Uint8Array.from(Array.from(text).map((char) => char.charCodeAt(0)));
  const concatUint8Arrays = (arrays) => {
    const total = arrays.reduce((sum, array) => sum + array.length, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    arrays.forEach((array) => {
      merged.set(array, offset);
      offset += array.length;
    });
    return merged;
  };
  const crc32 = (bytes) => {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) {
      crc = crcTable[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const makePngChunk = (type, data) => {
    const typeBytes = asciiBytes(type);
    const chunk = new Uint8Array(12 + data.length);
    writeUint32(chunk, 0, data.length);
    chunk.set(typeBytes, 4);
    chunk.set(data, 8);
    const crcInput = new Uint8Array(typeBytes.length + data.length);
    crcInput.set(typeBytes, 0);
    crcInput.set(data, typeBytes.length);
    writeUint32(chunk, 8 + data.length, crc32(crcInput));
    return chunk;
  };
  const makePhysChunk = (dpi) => {
    const pixelsPerMeter = Math.max(1, Math.round(Number(dpi || defaultCaptureDpi) / 0.0254));
    const data = new Uint8Array(9);
    writeUint32(data, 0, pixelsPerMeter);
    writeUint32(data, 4, pixelsPerMeter);
    data[8] = 1;
    return makePngChunk('pHYs', data);
  };
  const dataUrlToBytes = (dataUrl) => {
    const base64 = String(dataUrl || '').split(',')[1] || '';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  };
  const bytesToDataUrl = (bytes) => {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
    }
    return 'data:image/png;base64,' + btoa(binary);
  };
  const applyPngDpi = (dataUrl, dpi) => {
    if (!String(dataUrl || '').startsWith('data:image/png')) return dataUrl;
    const pngBytes = dataUrlToBytes(dataUrl);
    if (pngBytes.length < 8) return dataUrl;
    const signature = pngBytes.slice(0, 8);
    const chunks = [];
    let offset = 8;
    let inserted = false;
    while (offset + 12 <= pngBytes.length) {
      const length = readUint32(pngBytes, offset);
      const end = offset + 12 + length;
      if (end > pngBytes.length) break;
      const type = String.fromCharCode(
        pngBytes[offset + 4],
        pngBytes[offset + 5],
        pngBytes[offset + 6],
        pngBytes[offset + 7]
      );
      if (type !== 'pHYs') {
        chunks.push(pngBytes.slice(offset, end));
        if (!inserted && type === 'IHDR') {
          chunks.push(makePhysChunk(dpi));
          inserted = true;
        }
      }
      offset = end;
    }
    if (!inserted) chunks.push(makePhysChunk(dpi));
    return bytesToDataUrl(concatUint8Arrays([signature].concat(chunks)));
  };
  const measureContentHeight = () => {
    const body = document.body;
    if (!body) return 120;
    const bodyRect = body.getBoundingClientRect();
    const bodyStyle = getComputedStyle(body);
    const paddingBottom = parseFloat(bodyStyle.paddingBottom || '0') || 0;
    const candidates = Array.from(body.children).filter((el) => el.tagName !== 'SCRIPT');

    let maxBottom = 0;
    for (const el of candidates) {
      if (el.tagName === 'svg' || el.tagName === 'SVG') {
        const svgRect = el.getBoundingClientRect();
        const viewBox = el.viewBox && el.viewBox.baseVal;
        if (svgRect.width && svgRect.height && viewBox && viewBox.height > 0) {
          try {
            const bbox = el.getBBox();
            if (bbox && Number.isFinite(bbox.y) && Number.isFinite(bbox.height) && bbox.height > 0) {
              const contentBottom = Math.min(viewBox.height, bbox.y + bbox.height);
              const scaledHeight = (contentBottom / viewBox.height) * svgRect.height;
              maxBottom = Math.max(maxBottom, (svgRect.top - bodyRect.top) + scaledHeight + 2);
              continue;
            }
          } catch (e) {}
        }
      }
      const rect = el.getBoundingClientRect();
      if (!rect.width && !rect.height) continue;
      maxBottom = Math.max(maxBottom, rect.bottom - bodyRect.top);
    }

    if (maxBottom <= 0) {
      maxBottom = body.scrollHeight || body.offsetHeight || 0;
    }

    return Math.max(120, Math.ceil(maxBottom + paddingBottom + 2));
  };
  const postHeight = () => {
    parent.postMessage({ type: 'claude-export-widget-height', frameId, height: measureContentHeight() }, '*');
  };
  const drawDataUrlToCanvas = (dataUrl, width, height, scale, dpi) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const captureScale = Math.max(1, Number(scale || defaultCaptureScale) || defaultCaptureScale);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.ceil(width * captureScale));
        canvas.height = Math.max(1, Math.ceil(height * captureScale));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = getComputedStyle(document.body).backgroundColor || '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(applyPngDpi(canvas.toDataURL('image/png'), dpi || defaultCaptureDpi));
      } catch (error) {
        reject(error);
      }
    };
    img.onerror = () => reject(new Error('image-render-failed'));
    img.src = dataUrl;
  });
  const svgNodeToPngDataUrl = async (svgNode, scale, dpi) => {
    const rect = svgNode.getBoundingClientRect();
    const exportWidth = Math.max(1, Math.ceil(rect.width || document.documentElement.scrollWidth || 1));
    const exportHeight = Math.max(1, Math.ceil(rect.height || measureContentHeight() || 1));
    const captureScale = Math.max(1, Number(scale || defaultCaptureScale) || defaultCaptureScale);
    const clone = svgNode.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    if (!clone.getAttribute('width')) clone.setAttribute('width', String(exportWidth));
    if (!clone.getAttribute('height')) clone.setAttribute('height', String(exportHeight));
    if (!clone.getAttribute('viewBox')) clone.setAttribute('viewBox', '0 0 ' + exportWidth + ' ' + exportHeight);
    const styleText = collectStyleText();
    if (styleText) {
      const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
      style.textContent = styleText;
      defs.appendChild(style);
      clone.insertBefore(defs, clone.firstChild);
    }
    const serialized = new XMLSerializer().serializeToString(clone);
    const svgDataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(serialized);
    return {
      dataUrl: await drawDataUrlToCanvas(svgDataUrl, exportWidth, exportHeight, captureScale, dpi),
      width: Math.max(1, Math.ceil(exportWidth * captureScale)),
      height: Math.max(1, Math.ceil(exportHeight * captureScale)),
    };
  };
  const htmlToPngDataUrl = async (scale, dpi) => {
    const body = document.body;
    const exportWidth = Math.max(
      1,
      Math.ceil(document.documentElement.scrollWidth || body.scrollWidth || body.getBoundingClientRect().width || 1)
    );
    const exportHeight = Math.max(1, measureContentHeight());
    const captureScale = Math.max(1, Number(scale || defaultCaptureScale) || defaultCaptureScale);
    const bodyClone = body.cloneNode(true);
    bodyClone.querySelectorAll('script').forEach((node) => node.remove());
    const styleText = collectStyleText();
    const bodyBackground = getComputedStyle(body).backgroundColor || '#ffffff';
    const foreignObjectMarkup =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + exportWidth + '" height="' + exportHeight +
      '" viewBox="0 0 ' + exportWidth + ' ' + exportHeight + '">' +
      '<foreignObject width="100%" height="100%">' +
      '<div xmlns="http://www.w3.org/1999/xhtml" style="width:' + exportWidth + 'px;height:' + exportHeight +
      'px;background:' + bodyBackground + ';">' +
      '<style>' + styleText + '</style>' +
      bodyClone.innerHTML +
      '</div>' +
      '</foreignObject>' +
      '</svg>';
    const svgDataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(foreignObjectMarkup);
    return {
      dataUrl: await drawDataUrlToCanvas(svgDataUrl, exportWidth, exportHeight, captureScale, dpi),
      width: Math.max(1, Math.ceil(exportWidth * captureScale)),
      height: Math.max(1, Math.ceil(exportHeight * captureScale)),
    };
  };
  const captureWidgetImage = async (scale, dpi) => {
    const primarySvg = document.body.querySelector('svg');
    if (primarySvg) {
      try {
        return await svgNodeToPngDataUrl(primarySvg, scale, dpi);
      } catch (error) {
        // Fall back to HTML capture below.
      }
    }
    return htmlToPngDataUrl(scale, dpi);
  };
  const respondWidgetCapture = async (requestId, scale, dpi) => {
    try {
      const capture = await captureWidgetImage(scale, dpi);
      parent.postMessage({
        type: 'claude-export-widget-capture-result',
        frameId,
        requestId,
        ok: true,
        dataUrl: capture.dataUrl,
        width: capture.width,
        height: capture.height,
      }, '*');
    } catch (error) {
      parent.postMessage({
        type: 'claude-export-widget-capture-result',
        frameId,
        requestId,
        ok: false,
        error: error && error.message ? error.message : String(error),
      }, '*');
    }
  };
  if (document.body && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => requestAnimationFrame(postHeight)).observe(document.body);
  }
  window.addEventListener('load', () => {
    postHeight();
    setTimeout(postHeight, 100);
    setTimeout(postHeight, 500);
  });
  window.addEventListener('resize', postHeight);
  document.addEventListener('readystatechange', postHeight);
  window.addEventListener('message', (event) => {
    const data = event.data || {};
    if (data.type !== 'claude-export-widget-capture-request') return;
    if (data.frameId && data.frameId !== frameId) return;
    respondWidgetCapture(
      data.requestId || (frameId + '-' + Date.now()),
      data.captureScale || defaultCaptureScale,
      data.captureDpi || defaultCaptureDpi
    );
  });
})();
<\/script>`;
    const inner = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
/* ── CSS 变量（claude.ai 主题） ──────────────────── */
:root {
  --color-background-primary:   #ffffff;
  --color-background-secondary: #f7f7f8;
  --color-background-info:      #eff6ff;
  --color-background-success:   #f0fdf4;
  --color-background-warning:   #fffbeb;
  --color-background-danger:    #fef2f2;
  --color-text-primary:         #0f172a;
  --color-text-secondary:       #475569;
  --color-text-tertiary:        #94a3b8;
  --color-text-info:            #1d4ed8;
  --color-text-success:         #166534;
  --color-text-warning:         #92400e;
  --color-text-danger:          #b91c1c;
  --color-border-primary:       #e2e8f0;
  --color-border-secondary:     #cbd5e1;
  --color-border-tertiary:      #f1f5f9;
  --color-border-info:          #bfdbfe;
  --color-border-success:       #86efac;
  --color-border-danger:        #fecaca;
  --border-radius-md:           8px;
  --border-radius-lg:           12px;
  --font-mono: 'JetBrains Mono', 'Fira Code', Consolas, ui-monospace, monospace;
  --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif;
}
*, *::before, *::after { box-sizing: border-box; }
html, body { overflow: hidden; }
body {
  margin: 0; padding: 12px;
  font-family: var(--font-sans);
  font-size: 14px; line-height: 1.6;
  background: var(--color-background-primary);
  color: var(--color-text-primary);
}
svg { display: block; max-width: 100%; height: auto; overflow: visible; color: var(--color-text-primary); }

/* ── SVG 全局兜底：仅在未显式声明 fill 时避免默认 fill=black，并允许颜色组覆盖 ── */
svg :where(rect:not([fill])) { fill: #ffffff; }

/* ── Imagine SVG 主题类（修复无样式环境下的黑块问题）── */
/* 文字 */
.th { font-size: 14px; font-weight: 600; fill: var(--color-text-primary); font-family: var(--font-sans); }
.ts { font-size: 11.5px; fill: var(--color-text-secondary); font-family: var(--font-sans); }

/* 紫色组 */
.c-purple rect  { fill: #EDE9FE; stroke: #7F77DD; stroke-width: 0.8; }
.c-purple text  { fill: #534AB7; }
.c-purple .th   { fill: #3D35A0; font-weight: 700; }
.c-purple { color: #534AB7; }

/* 灰色组 */
.c-gray rect  { fill: #F4F4F5; stroke: #A8A5A0; stroke-width: 0.8; }
.c-gray text  { fill: #52525B; }
.c-gray .th   { fill: #3F3F46; }
.c-gray { color: #52525B; }

/* 青绿色组 */
.c-teal rect  { fill: #E6F7F5; stroke: #2CB09A; stroke-width: 0.8; }
.c-teal text  { fill: #1A7A6B; }
.c-teal .th   { fill: #0F5549; }
.c-teal { color: #1A7A6B; }

/* 珊瑚色组 */
.c-coral rect  { fill: #FEF0EE; stroke: #E07D6C; stroke-width: 0.8; }
.c-coral text  { fill: #C05A4A; }
.c-coral .th   { fill: #9A3828; }
.c-coral { color: #C05A4A; }

/* 蓝色组 */
.c-blue rect  { fill: #EFF6FF; stroke: #3B82F6; stroke-width: 0.8; }
.c-blue text  { fill: #1D4ED8; }
.c-blue .th   { fill: #1E40AF; font-weight: 700; }
.c-blue { color: #1D4ED8; }

/* 琥珀色组 */
.c-amber rect  { fill: #FFFBEB; stroke: #F59E0B; stroke-width: 0.8; }
.c-amber text  { fill: #92400E; }
.c-amber .th   { fill: #78350F; font-weight: 700; }
.c-amber { color: #92400E; }

/* 绿色组：防御性兜底 */
.c-green rect  { fill: #F0FDF4; stroke: #22C55E; stroke-width: 0.8; }
.c-green text  { fill: #166534; }
.c-green .th   { fill: #14532D; font-weight: 700; }
.c-green { color: #166534; }

/* 箭头线 */
.arr { stroke: #7F77DD; fill: none; }
marker path { stroke: #7F77DD; fill: none; }
</style>
</head>
<body>${widgetCode}${resizeScript}</body>
</html>`;
    // srcdoc 属性值里的双引号必须转义为 &quot;
    return inner.replace(/"/g, '&quot;');
  }

  // ── 找 React Query Client（遍历 Fiber 树）──────────────────────
  function findQueryClient() {
    const root = document.getElementById('root');
    if (!root) return null;
    const fiberKey = Object.keys(root).find(k => k.startsWith('__reactContainer'));
    if (!fiberKey) return null;

    const visited = new WeakSet();
    function walk(fiber, depth) {
      if (!fiber || depth > 50) return null;
      if (visited.has(fiber)) return null;
      visited.add(fiber);
      try {
        const v = fiber.memoizedProps && fiber.memoizedProps.value;
        if (v) {
          if (typeof v.getQueryCache === 'function') return v;
          if (v.client && typeof v.client.getQueryCache === 'function') return v.client;
        }
      } catch (e) {}
      return walk(fiber.child, depth + 1) || walk(fiber.sibling, depth);
    }
    return walk(root[fiberKey], 0);
  }

  // ── 提取数据 ────────────────────────────────────────────────────
  return (async () => {
    try {
      const currentChatUuid = window.location.pathname.split('/').pop();

      const qc = findQueryClient();
      if (!qc) {
        return fail('React Query Client 未找到，请确保页面已完整加载');
      }

      const allQueries = qc.getQueryCache().getAll();
      const treeQuery = allQueries.find(q =>
        JSON.stringify(q.queryKey || '').includes(currentChatUuid)
        && q.state.data && q.state.data.chat_messages
      );

      if (!treeQuery || !treeQuery.state.data) {
        return fail('对话数据未找到，请确保页面已完整加载');
      }

      let orgUuid = '';
      for (const q of allQueries) {
        const key = JSON.stringify(q.queryKey || '');
        const match = key.match(/"orgUuid":"([^"]+)"/);
        if (match) {
          orgUuid = match[1];
          break;
        }
      }

      const convData  = treeQuery.state.data;
      const chatTitle = convData.name || 'Claude Chat';
      const chatMsgs  = (convData.chat_messages || []).sort((a, b) => (a.index || 0) - (b.index || 0));

      const totalAttachments = chatMsgs.reduce((count, msg) => {
        if (msg.sender !== 'human') return count;
        return count + (msg.attachments || []).length + (msg.files || []).length;
      }, 0);
      let completedAttachments = 0;
      if (totalAttachments > 0) {
        setProgress({
          state: 'running',
          stage: 'attachments',
          completed: 0,
          total: totalAttachments,
          message: `正在抓取附件内容… (0 / ${totalAttachments})`,
        });
      }

      const attachmentEntries = [];
      for (const msg of chatMsgs) {
        if (msg.sender !== 'human') continue;

        const messageKey = String(msg.uuid || msg.index || attachmentEntries.length)
          .replace(/[^a-zA-Z0-9_-]/g, '-');

        const rawAtts = [
          ...(msg.attachments || []).map(a => ({
            source: 'attachments',
            name: a.file_name || '附件',
            type: a.file_type || '',
            kind: '',
            size: a.file_size || 0,
            uuid: a.file_uuid || '',
            extractedContent: a.extracted_content || '',
            path: null,
            previewUrl: null,
          })),
          ...(msg.files || []).map(f => ({
            source: 'files',
            name: f.file_name || f.path || '附件',
            type: f.file_kind || f.file_type || '',
            kind: f.file_kind || '',
            size: f.file_size || 0,
            uuid: f.file_uuid || f.uuid || '',
            extractedContent: '',
            path: f.path || null,
            previewUrl: f.preview_url || (f.preview_asset && f.preview_asset.url) || f.thumbnail_url || null,
          })),
        ];

        const fetchedAtts = await Promise.all(rawAtts.map(async (att) => {
          const fetched = await fetchFileContent(att, orgUuid, currentChatUuid);
          completedAttachments += 1;
          if (totalAttachments > 0) {
            setProgress({
              state: 'running',
              stage: 'attachments',
              completed: completedAttachments,
              total: totalAttachments,
              message: `正在抓取附件内容… (${completedAttachments} / ${totalAttachments})`,
            });
          }
          if (typeof fetched.text === 'string' && isMarkdownLike(att.type || att.name)) {
            return {
              ...fetched,
              text: await inlineTextAssetUrls(fetched.text),
            };
          }
          return fetched;
        }));
        rawAtts.forEach((att, idx) => {
          attachmentEntries.push({
            ...att,
            ...fetchedAtts[idx],
            messageKey,
            dialogId: `att-${messageKey}-${idx}`,
          });
        });
      }

      setProgress({
        state: 'running',
        stage: 'render',
        completed: completedAttachments,
        total: totalAttachments,
        message: '正在构建离线 HTML…',
      });

      const attMap = {};
      attachmentEntries.forEach(att => {
        if (!attMap[att.messageKey]) attMap[att.messageKey] = [];
        attMap[att.messageKey].push(att);
      });

    // ── 构建对话 HTML ────────────────────────────────────────────────
    const turnsHtml = [];
    const promptTocItems = [];
    const promptSummaries = [];
    const widgetTocItems = [];

    for (const msg of chatMsgs) {
      // 用户消息
      if (msg.sender === 'human') {
        const contentParts = Array.isArray(msg.content) ? msg.content : [];
        const rawTextContent = contentParts
          .filter(c => c.type === 'text')
          .map(c => c.text || '')
          .join('');
        const textContent = await inlineTextAssetUrls(rawTextContent);

        const messageKey = String(msg.uuid || msg.index || turnsHtml.length)
          .replace(/[^a-zA-Z0-9_-]/g, '-');
        const attList = attMap[messageKey] || [];
        const timeLabel = formatMessageTimestamp(msg);

        if (!textContent.trim() && attList.length === 0) continue;

        const promptLabel = summarizePromptLabel(rawTextContent, promptTocItems.length + 1);
        const promptSectionId = makeAnchorId('prompt', promptLabel, promptTocItems.length + 1);
        promptTocItems.push({
          id: promptSectionId,
          title: promptLabel,
        });
        promptSummaries.push({
          label: promptLabel,
          text: rawTextContent.trim() || '（该条用户消息主要是附件或空文本，没有可提取的 prompt 文本。）',
        });

        const attachHtml = attList.length > 0
          ? `<div class="attachments">${attList.map(a =>
              `<button type="button" class="att-tag att-button" data-target="${a.dialogId}">${getFileIcon(a.type || a.name)} ${escHtml(a.name)}</button>`
            ).join('')}</div>`
          : '';
        const dialogHtml = attList.map(a => renderAttachmentDialog(a, a.dialogId)).join('');
        turnsHtml.push(`
<section id="${promptSectionId}" class="prompt-section">
  <div class="turn user-turn">
    <div class="avatar ua">你</div>
    <div class="bubble ub">
      ${attachHtml}
      <div class="md user-text">${md2html(textContent)}</div>
      ${timeLabel ? `<div class="turn-time">${escHtml(timeLabel)}</div>` : ''}
      ${dialogHtml}
    </div>
  </div>
</section>`);
        continue;
      }

      // Claude 回复
      if (msg.sender === 'assistant') {
        if (!Array.isArray(msg.content)) continue;
        const parts = [];
        const assistantCopyParts = [];
        const messageKey = String(msg.uuid || msg.index || turnsHtml.length)
          .replace(/[^a-zA-Z0-9_-]/g, '-');
        const timeLabel = formatMessageTimestamp(msg);
        let widgetIndex = 0;
        for (const c of msg.content) {
          // 正文文字（跳过空白和思维链）
          if (c.type === 'text' && c.text && c.text.trim()) {
            assistantCopyParts.push(c.text);
            const textHtml = md2html(await inlineTextAssetUrls(c.text));
            parts.push(`<div class="md">${textHtml}</div>`);
          }
          if (includeThinking && isThinkingPart(c)) {
            const thinkingText = await inlineTextAssetUrls(extractThinkingText(c));
            parts.push(renderThinkingBlock(thinkingText));
          }
          // 控件（show_widget）→ 内联为 srcdoc iframe
          if (
            c.type === 'tool_use' &&
            c.name && c.name.includes('show_widget') &&
            c.input && c.input.widget_code
          ) {
            const currentWidgetIndex = widgetIndex++;
            const iframeId = `widget-${messageKey}-${currentWidgetIndex}`;
            const srcdoc = makeWidgetSrcdoc(c.input.widget_code, iframeId, widgetImageExport);
            const widgetTitle = c.input.title || 'widget';
            const wTitle = escHtml(widgetTitle);
            const widgetSectionId = makeAnchorId('widget', widgetTitle, widgetTocItems.length + 1);
            widgetTocItems.push({
              id: widgetSectionId,
              title: widgetTitle,
            });
            parts.push(`
<section id="${widgetSectionId}" class="widget-section">
  <div class="widget-wrapper">
    <div class="widget-toolbar">
      <button
        type="button"
        class="widget-menu-toggle"
        data-widget-menu-toggle="${iframeId}"
        aria-label="控件图片操作"
        title="控件图片操作"
      >${moreIconSvg()}</button>
      <div class="widget-menu" data-widget-menu="${iframeId}" hidden>
        <button
          type="button"
          class="widget-menu-item"
          data-widget-action="copy-image"
          data-iframe-id="${iframeId}"
          data-widget-title="${wTitle}"
          data-default-html="${escHtml(copyIconSvg() + '<span>复制控件图片</span>')}"
          data-success-html="${escHtml(checkIconSvg() + '<span>已复制</span>')}"
          data-failure-html="${escHtml('<span>复制失败</span>')}"
        >${copyIconSvg()}<span>复制控件图片</span></button>
        <button
          type="button"
          class="widget-menu-item"
          data-widget-action="download-image"
          data-iframe-id="${iframeId}"
          data-widget-title="${wTitle}"
          data-default-html="${escHtml(downloadIconSvg() + '<span>下载控件图片</span>')}"
          data-success-html="${escHtml(checkIconSvg() + '<span>已开始下载</span>')}"
          data-failure-html="${escHtml('<span>下载失败</span>')}"
        >${downloadIconSvg()}<span>下载控件图片</span></button>
      </div>
    </div>
    <div class="widget-header">⚡ ${wTitle}</div>
    <iframe srcdoc="${srcdoc}" sandbox="allow-scripts" class="widget-iframe" data-iframe-id="${iframeId}" loading="lazy" scrolling="no"></iframe>
  </div>
</section>`);
          }
        }
        if (parts.length > 0) {
          const assistantCopyText = joinMarkdownParts(assistantCopyParts);
          const replyCopyId = `reply-copy-${messageKey}`;
          const replyActionHtml = assistantCopyText
            ? `
<div class="turn-actions turn-actions--assistant">
  <textarea id="${replyCopyId}" class="copy-source" aria-hidden="true" tabindex="-1">${escHtml(assistantCopyText)}</textarea>
  <button
    type="button"
    class="turn-icon-btn turn-copy-btn"
    data-copy-source-id="${replyCopyId}"
    data-default-html="${escHtml(copyIconSvg())}"
    data-success-html="${escHtml(checkIconSvg())}"
    data-failure-html="${escHtml('<span class=\"turn-copy-failure\">!</span>')}"
    aria-label="复制回复文本"
    title="复制回复文本"
  >${copyIconSvg()}</button>
</div>`
            : '';
          const assistantMetaHtml = (timeLabel || replyActionHtml)
            ? `
<div class="turn-meta turn-meta--assistant">
  ${timeLabel ? `<div class="turn-time">${escHtml(timeLabel)}</div>` : ''}
  ${replyActionHtml}
</div>`
            : '';
          turnsHtml.push(`
<div class="turn claude-turn">
  <div class="avatar ca">C</div>
  <div class="bubble cb">${parts.join('\n')}${assistantMetaHtml}</div>
</div>`);
        }
        continue;
      }
    }

  // ── 页面样式 ─────────────────────────────────────────────────────
  const PAGE_CSS = `
*, *::before, *::after { box-sizing: border-box; }

/* ── 全局 ── */
body {
  margin: 0; padding: 24px 16px 60px;
  background: #faf9f5;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
               'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
  font-size: 16px; line-height: 1.75;
  color: #141413;
}

/* ── 整体容器 ── */
.chat-container { max-width: 780px; margin: 0 auto; }

/* ── 标题 ── */
.chat-title {
  font-size: 22px; font-weight: 700; color: #1a1a1a;
  padding: 0 0 20px;
  border-bottom: 2px solid #e8e4dc; margin-bottom: 32px;
  letter-spacing: -0.3px;
}

/* ── 对话轮次 ── */
.turn {
  display: flex; gap: 14px; margin-bottom: 0;
  align-items: flex-start;
  padding: 20px 0;
}
.user-turn { flex-direction: row-reverse; }

/* 轮次分隔线（Claude 回复后） */
.claude-turn + .user-turn {
  border-top: 1px solid #ece9e3;
  margin-top: 4px;
}

/* ── 头像 ── */
.avatar {
  flex-shrink: 0; width: 34px; height: 34px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-weight: 700; font-size: 13px; margin-top: 2px;
}
.ua { background: #7c3aed; color: #fff; }
.ca { background: #cc8a22; color: #fff; }

/* ── 气泡 ── */
.bubble {
  max-width: 84%; padding: 11px 15px; border-radius: 18px;
  word-break: break-word; overflow-wrap: anywhere;
}

/* 用户气泡：轻灰色，不抢眼 */
.ub {
  background: #efefef;
  color: #1a1a1a;
  border-bottom-right-radius: 6px;
  font-size: 15px;
}

/* Claude 回复：完全去掉外框，更干净 */
.cb {
  background: transparent;
  border: none; box-shadow: none;
  padding: 0 4px;
  max-width: 100%;
}
.claude-turn .bubble.cb {
  position: relative;
}

/* ── 附件 ── */
.attachments { margin-bottom: 8px; display: flex; flex-wrap: wrap; gap: 6px; }
.att-tag {
  background: #e4ddf7; color: #5b21b6;
  padding: 3px 10px; border-radius: 12px; font-size: 12px; font-weight: 500;
}
.att-button { border: none; cursor: pointer; font: inherit; transition: background .15s; }
.att-button:hover { background: #d1c4f5; }

/* ── 附件弹窗（保持原样） ── */
.att-dialog {
  border: none; border-radius: 14px; padding: 0;
  width: min(860px, calc(100vw - 32px)); max-height: calc(100vh - 48px);
  box-shadow: 0 24px 80px rgba(15,23,42,.28);
}
.att-dialog::backdrop { background: rgba(15,23,42,.38); }
.att-dialog-body { background: #fff; color: #111827; }
.att-dialog-header {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; padding: 14px 16px; border-bottom: 1px solid #e5e7eb;
}
.att-dialog-title { font-size: 15px; font-weight: 700; }
.att-dialog-close {
  border: none; border-radius: 999px; background: #f3f4f6;
  color: #374151; padding: 6px 12px; cursor: pointer; font-size: 12px;
}
.att-dialog-meta { display: flex; flex-wrap: wrap; gap: 8px; padding: 12px 16px 0; }
.att-dialog-chip {
  background: #f5f3ff; color: #5b21b6; border-radius: 999px;
  padding: 4px 10px; font-size: 12px;
}
.attachment-preview { padding: 16px; }
.attachment-preview img { display: block; max-width: 100%; height: auto; border-radius: 10px; }
.att-actions { margin: 0 16px 16px; display: flex; gap: 10px; flex-wrap: wrap; }
.att-dl-btn {
  display: inline-flex; align-items: center; min-height: 36px;
  padding: 8px 14px; border-radius: 999px; border: 1px solid #d6d3d1;
  background: #fff7ed; color: #9a3412; text-decoration: none;
  font-size: 13px; font-weight: 600;
}
.att-dl-btn:hover { background: #ffedd5; }
.att-copy-btn {
  cursor: pointer;
  background: #eef2ff;
  color: #4338ca;
}
.att-copy-btn:hover { background: #e0e7ff; }
.copy-source,
.att-copy-source {
  position: absolute;
  left: -99999px;
  top: 0;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}
.attachment-pre {
  margin: 0 16px 16px; padding: 14px 16px;
  border: 1px solid #e5e7eb; border-radius: 10px;
  background: #f8fafc; color: #111827;
  white-space: pre-wrap; word-break: break-word; overflow: auto;
  max-height: min(70vh, 720px);
  font-family: 'JetBrains Mono', 'Fira Code', Consolas, monospace; font-size: 13px;
}
.attachment-empty {
  margin: 16px; padding: 14px 16px;
  border: 1px dashed #d6d3d1; border-radius: 10px;
  background: #fafaf9; color: #57534e; font-size: 13px;
}

/* ── 用户文本 ── */
.user-text { white-space: pre-wrap; word-break: break-word; }
.turn-time {
  margin-top: 10px;
  font-size: 12px;
  color: #8b8680;
  line-height: 1.3;
}
.turn-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}
.turn-meta--assistant {
  justify-content: flex-end;
  margin-top: 8px;
}
.turn-meta--assistant .turn-time {
  margin-top: 0;
}
.turn-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.turn-actions--assistant {
  margin-top: 0;
}
.turn-icon-btn {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: #7c7468;
  cursor: pointer;
  transition: background .15s ease, color .15s ease, transform .15s ease;
}
.turn-icon-btn:hover {
  background: #f2ede6;
  color: #433f39;
  transform: translateY(-1px);
}
.turn-icon-btn svg,
.widget-menu-toggle svg,
.widget-menu-item svg {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}
.turn-copy-failure {
  font-size: 15px;
  font-weight: 700;
  line-height: 1;
}
.user-turn .turn-time {
  text-align: right;
}
.prompt-section { scroll-margin-top: 28px; }

/* ── Markdown 正文 ── */
.md { font-size: 16px; }
.md p { margin: 0 0 12px; }
.md p:last-child { margin: 0; }
.md h1, .md h2, .md h3, .md h4, .md h5, .md h6 {
  margin: 22px 0 8px; line-height: 1.35; font-weight: 700; color: #0f0f0e;
  letter-spacing: -0.2px;
}
.md h1 { font-size: 1.5em; border-bottom: 1px solid #e8e4dc; padding-bottom: 6px; margin-bottom: 12px; }
.md h2 { font-size: 1.25em; }
.md h3 { font-size: 1.1em; }
.md ul, .md ol { margin: 8px 0 12px; padding-left: 24px; }
.md li { margin-bottom: 6px; line-height: 1.65; }
.md li + .md li { margin-top: 2px; }
.md hr { border: none; border-top: 1px solid #e8e4dc; margin: 20px 0; }
.md strong { font-weight: 700; color: #0f0f0e; }
.md em { font-style: italic; color: #374151; }

/* blockquote：细左边线，轻底色，原版风格 */
.md blockquote {
  border-left: 3px solid rgba(20,20,19,.15);
  margin: 14px 0; padding: 2px 16px;
  background: transparent;
  color: #44403c;
  font-style: normal;
}

/* 代码块 */
.md pre {
  background: #1c1c1e; color: #e5e5ea;
  padding: 16px 18px; border-radius: 10px;
  overflow-x: auto; font-size: 13px; line-height: 1.6; margin: 14px 0;
}
.md code { font-family: 'JetBrains Mono','Fira Code',Consolas,monospace; }
.md p code, .md li code {
  background: rgba(20,20,19,.07); color: #2d2d2d;
  padding: 2px 6px; border-radius: 5px; font-size: 0.88em;
  border: 1px solid rgba(20,20,19,.1);
}

/* 表格 */
.md table {
  border-collapse: collapse; width: 100%; margin: 14px 0;
  font-size: 14px; border-radius: 8px; overflow: hidden;
  border: 1px solid #e0dbd4;
}
.md th, .md td { border: 1px solid #e0dbd4; padding: 9px 13px; text-align: left; }
.md th { background: #f2ede6; font-weight: 600; color: #1a1a1a; font-size: 13px; }
.md tr:nth-child(even) { background: #faf8f4; }
.md tr:hover { background: #f5f0ea; transition: background .1s; }

/* ── Thinking 折叠块 ── */
.thinking-block {
  margin: 14px 0;
  border: 1px dashed #d6d3d1;
  border-radius: 12px;
  background: #fcfaf6;
}
.thinking-block summary {
  list-style: none;
  cursor: pointer;
  padding: 10px 14px;
  font-size: 13px;
  font-weight: 600;
  color: #7c4f10;
  user-select: none;
}
.thinking-block summary::-webkit-details-marker { display: none; }
.thinking-block[open] summary {
  border-bottom: 1px solid #eee6d7;
}
.thinking-content {
  padding: 12px 14px 14px;
  color: #57534e;
  font-size: 14px;
}
.thinking-content p:last-child {
  margin-bottom: 0;
}

/* ── Widget ── */
.widget-wrapper {
  position: relative;
  margin: 16px 0; border: 1px solid #e8d5a3;
  border-radius: 12px; overflow: hidden; background: #fff;
  box-shadow: 0 1px 6px rgba(0,0,0,.05);
}
.widget-section { scroll-margin-top: 28px; }
.widget-toolbar {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 3;
  opacity: 0;
  pointer-events: none;
  transition: opacity .16s ease;
}
.widget-wrapper:hover .widget-toolbar,
.widget-wrapper:focus-within .widget-toolbar,
.widget-toolbar.is-open {
  opacity: 1;
  pointer-events: auto;
}
.widget-menu-toggle {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 10px;
  background: rgba(255,255,255,.96);
  color: #7c4f10;
  box-shadow: 0 4px 14px rgba(20,20,19,.10);
  cursor: pointer;
}
.widget-menu-toggle:hover {
  background: #ffffff;
}
.widget-menu {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 164px;
  padding: 8px;
  border: 1px solid #e8e4dc;
  border-radius: 14px;
  background: rgba(255,255,255,.98);
  box-shadow: 0 14px 34px rgba(20,20,19,.16);
}
.widget-menu[hidden] { display: none; }
.widget-menu-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 10px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: #3f3b35;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  text-align: left;
}
.widget-menu-item:hover {
  background: #f8f3ea;
}
.widget-header {
  background: #fdf6e3; color: #7c4f10;
  padding: 7px 48px 7px 14px; font-size: 12px; font-weight: 600;
  border-bottom: 1px solid #f0e4b8; letter-spacing: 0.2px;
}
.widget-iframe {
  display: block; width: 100%; height: 120px;
  border: none; background: #fff; overflow: hidden;
}

/* ── 对话序号（用 CSS counter 自动生成，不改 JS）── */
.chat-container { counter-reset: turn-counter; }
.claude-turn .avatar::after {
  display: none;
}
.turn-index {
  display: none;
}

/* ── 右侧目录 ── */
.toc-panel { display: none; }

@media (min-width: 1380px) {
  .toc-panel--right {
    display: block;
    position: fixed;
    top: 88px;
    right: 24px;
    width: 210px;
    max-height: calc(100vh - 120px);
    overflow: auto;
    padding: 14px 12px;
    border: 1px solid #e8e4dc;
    border-radius: 16px;
    background: rgba(255,255,255,.92);
    box-shadow: 0 10px 30px rgba(20,20,19,.08);
    backdrop-filter: blur(10px);
    z-index: 20;
  }
}

@media (min-width: 1380px) {
  .toc-panel--left {
    display: block;
    position: fixed;
    top: 88px;
    left: 24px;
    width: 210px;
    max-height: calc(100vh - 120px);
    overflow: auto;
    padding: 14px 12px;
    border: 1px solid #e8e4dc;
    border-radius: 16px;
    background: rgba(255,255,255,.92);
    box-shadow: 0 10px 30px rgba(20,20,19,.08);
    backdrop-filter: blur(10px);
    z-index: 20;
  }
}

@media (min-width: 1380px) {
  .toc-panel {
    scrollbar-width: thin;
  }

  .toc-title {
    margin-bottom: 10px;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: .08em;
    color: #78716c;
  }

  .toc-nav {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .toc-link {
    display: grid;
    grid-template-columns: 22px minmax(0, 1fr);
    gap: 8px;
    align-items: start;
    padding: 8px 10px;
    border-radius: 12px;
    color: #44403c;
    text-decoration: none;
    transition: background .15s ease, color .15s ease, transform .15s ease;
  }

  .toc-link:hover {
    background: #f5f0ea;
    color: #1c1917;
    transform: translateX(-1px);
  }

  .toc-link.is-active {
    background: #fdf6e3;
    color: #7c4f10;
  }

  .toc-index {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 999px;
    background: #f3ede4;
    color: #7c6f60;
    font-size: 11px;
    font-weight: 700;
  }

  .toc-link.is-active .toc-index {
    background: #f0d792;
    color: #7c4f10;
  }

  .toc-text {
    min-width: 0;
    font-size: 12px;
    line-height: 1.45;
    word-break: break-word;
  }
}

/* ── 打印优化 ── */
@media print {
  body { background: #fff; font-size: 14px; padding: 0; }
  .widget-iframe { height: auto !important; }
  .att-dialog { display: none; }
  .bubble { max-width: 100%; }
  .turn { page-break-inside: avoid; }
  .toc-panel { display: none !important; }
}

/* ── 深色模式（系统自动） ── */
@media (prefers-color-scheme: dark) {
  body { background: #1a1917; color: #e8e4dc; }
  .chat-title { color: #f0ece4; border-bottom-color: #3a3830; }
  .claude-turn + .user-turn { border-top-color: #3a3830; }
  .ub { background: #2c2a26; color: #e8e4dc; }
  .turn-time { color: #9b9489; }
  .md p code, .md li code { background: rgba(255,255,255,.1); color: #d4d0c8; border-color: rgba(255,255,255,.15); }
  .md blockquote { border-left-color: rgba(255,255,255,.2); color: #b5b0a8; }
  .md th { background: #2c2a26; color: #e8e4dc; }
  .md td { border-color: #3a3830; }
  .md tr:nth-child(even) { background: #222018; }
  .md tr:hover { background: #2c2a26; }
  .thinking-block { background: #221f19; border-color: #3d3420; }
  .thinking-block summary { color: #f4d38a; }
  .thinking-block[open] summary { border-bottom-color: #3d3420; }
  .thinking-content { color: #d6d3d1; }
  .widget-wrapper { border-color: #5a4a20; background: #1e1c18; }
  .widget-menu-toggle {
    background: rgba(30,28,24,.95);
    color: #f4d38a;
    box-shadow: 0 8px 18px rgba(0,0,0,.35);
  }
  .widget-menu {
    background: rgba(30,28,24,.98);
    border-color: #3d3420;
  }
  .widget-menu-item { color: #f0ece4; }
  .widget-menu-item:hover { background: #2c2a26; }
  .widget-header { background: #2a2416; color: #d4a84b; border-bottom-color: #3d3420; }
  .widget-iframe { background: #fff; }
  .toc-panel { background: rgba(30,28,24,.92); border-color: #3d3420; }
  .toc-title { color: #b5b0a8; }
  .toc-link { color: #d6d3d1; }
  .toc-link:hover { background: #2c2a26; color: #f0ece4; }
  .toc-link.is-active { background: #2a2416; color: #f4d38a; }
  .toc-index { background: #38342f; color: #d6d3d1; }
  .toc-link.is-active .toc-index { background: #5a4a20; color: #f4d38a; }
  .turn-icon-btn { color: #b5b0a8; }
  .turn-icon-btn:hover { background: #2c2a26; color: #f0ece4; }
}
`;

  const widgetImageExportLiteral = JSON.stringify(widgetImageExport);
  const PAGE_SCRIPT = `
let pageHeightRaf = 0;
const widgetCaptureRequests = new Map();
const widgetImageExport = ${widgetImageExportLiteral};

function sanitizeExportName(raw) {
  const cleaned = String(raw || 'widget')
    .trim()
    .replace(/[<>:"/\\\\|?*\\u0000-\\u001f]/g, '-')
    .replace(/\\s+/g, ' ')
    .replace(/\\.+$/g, '')
    .slice(0, 80);
  return cleaned || 'widget';
}

function measurePageHeight() {
  const body = document.body;
  const root = document.documentElement;
  const container = document.querySelector('.chat-container');
  const bodyRect = body ? body.getBoundingClientRect() : { top: 0 };
  const containerHeight = container
    ? Math.ceil(container.getBoundingClientRect().bottom - bodyRect.top)
    : 0;

  return Math.max(
    0,
    root ? root.scrollHeight : 0,
    root ? root.offsetHeight : 0,
    body ? body.scrollHeight : 0,
    body ? body.offsetHeight : 0,
    containerHeight
  );
}

function postPageHeight() {
  if (window.parent === window) return;
  window.parent.postMessage({
    type: 'claude-export-page-height',
    height: Math.max(200, measurePageHeight()),
  }, '*');
}

function queuePageHeightPost() {
  if (pageHeightRaf) return;
  pageHeightRaf = requestAnimationFrame(() => {
    pageHeightRaf = 0;
    postPageHeight();
  });
}

function setTransientButtonContent(trigger, nextHtml, stateClass) {
  if (!trigger) return;
  const originalHtml = trigger.dataset.restoreHtml || trigger.innerHTML;
  trigger.dataset.restoreHtml = originalHtml;
  if (trigger.__restoreTimer) clearTimeout(trigger.__restoreTimer);
  trigger.classList.remove('is-success', 'is-error');
  if (stateClass) trigger.classList.add(stateClass);
  trigger.innerHTML = nextHtml;
  trigger.__restoreTimer = setTimeout(() => {
    trigger.innerHTML = originalHtml;
    trigger.classList.remove('is-success', 'is-error');
  }, 1600);
}

async function copyTextContent(text, trigger) {
  if (!text) return false;

  let copied = false;
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function' && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch (error) {
      copied = false;
    }
  }

  if (!copied) {
    const helper = document.createElement('textarea');
    helper.value = text;
    helper.setAttribute('readonly', '');
    helper.style.position = 'fixed';
    helper.style.opacity = '0';
    helper.style.pointerEvents = 'none';
    document.body.appendChild(helper);
    helper.focus();
    helper.select();
    helper.setSelectionRange(0, helper.value.length);
    try {
      copied = document.execCommand('copy');
    } catch (error) {
      copied = false;
    }
    helper.remove();
  }

  if (trigger) {
    setTransientButtonContent(
      trigger,
      copied
        ? (trigger.dataset.successHtml || '✅ 已复制')
        : (trigger.dataset.failureHtml || '复制失败'),
      copied ? 'is-success' : 'is-error'
    );
  }

  return copied;
}

async function copyAttachmentText(sourceId, trigger) {
  const source = document.getElementById(sourceId);
  const text = source && typeof source.value === 'string' ? source.value : '';
  return copyTextContent(text, trigger);
}

function findWidgetFrame(frameId) {
  return Array.from(document.querySelectorAll('.widget-iframe')).find((el) => el.dataset.iframeId === frameId) || null;
}

function closeWidgetMenus(exceptFrameId = '') {
  document.querySelectorAll('.widget-menu').forEach((menu) => {
    const frameId = menu.dataset.widgetMenu || '';
    const keepOpen = exceptFrameId && frameId === exceptFrameId;
    menu.hidden = !keepOpen;
    menu.closest('.widget-toolbar')?.classList.toggle('is-open', keepOpen);
  });
}

function requestWidgetCapture(frameId) {
  const frame = findWidgetFrame(frameId);
  if (!frame || !frame.contentWindow) {
    return Promise.reject(new Error('widget-frame-missing'));
  }

  return new Promise((resolve, reject) => {
    const requestId = frameId + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const timeoutId = setTimeout(() => {
      widgetCaptureRequests.delete(requestId);
      reject(new Error('widget-capture-timeout'));
    }, 12000);

    widgetCaptureRequests.set(requestId, { resolve, reject, timeoutId });
    frame.contentWindow.postMessage({
      type: 'claude-export-widget-capture-request',
      frameId,
      requestId,
      captureScale: widgetImageExport && widgetImageExport.scale,
      captureDpi: widgetImageExport && widgetImageExport.dpi,
    }, '*');
  });
}

async function dataUrlToBlob(dataUrl) {
  const response = await fetch(dataUrl);
  return response.blob();
}

function downloadDataUrl(dataUrl, fileName) {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function copyWidgetImage(frameId, widgetTitle, trigger) {
  try {
    const capture = await requestWidgetCapture(frameId);
    const blob = await dataUrlToBlob(capture.dataUrl);
    if (!navigator.clipboard || typeof navigator.clipboard.write !== 'function' || typeof ClipboardItem === 'undefined') {
      throw new Error('clipboard-image-unsupported');
    }
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    setTransientButtonContent(trigger, trigger.dataset.successHtml || '已复制', 'is-success');
    return true;
  } catch (error) {
    setTransientButtonContent(trigger, trigger.dataset.failureHtml || '复制失败', 'is-error');
    return false;
  }
}

async function downloadWidgetImage(frameId, widgetTitle, trigger) {
  try {
    const capture = await requestWidgetCapture(frameId);
    const fileName = sanitizeExportName(widgetTitle || frameId) + '.png';
    downloadDataUrl(capture.dataUrl, fileName);
    setTransientButtonContent(trigger, trigger.dataset.successHtml || '已开始下载', 'is-success');
    return true;
  } catch (error) {
    setTransientButtonContent(trigger, trigger.dataset.failureHtml || '下载失败', 'is-error');
    return false;
  }
}

document.addEventListener('click', (event) => {
  const tocLink = event.target.closest('.toc-link');
  if (tocLink) {
    const tocPanel = tocLink.closest('.toc-panel');
    if (tocPanel) {
      tocPanel.querySelectorAll('.toc-link').forEach((link) => link.classList.remove('is-active'));
    }
    tocLink.classList.add('is-active');
  }

  const widgetMenuToggle = event.target.closest('[data-widget-menu-toggle]');
  if (widgetMenuToggle) {
    const frameId = widgetMenuToggle.dataset.widgetMenuToggle || '';
    const menu = document.querySelector('.widget-menu[data-widget-menu="' + frameId + '"]');
    const shouldOpen = !menu || menu.hidden;
    closeWidgetMenus(shouldOpen ? frameId : '');
    return;
  }

  const widgetActionBtn = event.target.closest('[data-widget-action]');
  if (widgetActionBtn) {
    const frameId = widgetActionBtn.dataset.iframeId || '';
    const widgetTitle = widgetActionBtn.dataset.widgetTitle || frameId || 'widget';
    if (widgetActionBtn.dataset.widgetAction === 'copy-image') {
      copyWidgetImage(frameId, widgetTitle, widgetActionBtn);
    } else if (widgetActionBtn.dataset.widgetAction === 'download-image') {
      downloadWidgetImage(frameId, widgetTitle, widgetActionBtn);
    }
    return;
  }

  const copyBtn = event.target.closest('[data-copy-source-id]');
  if (copyBtn) {
    copyAttachmentText(copyBtn.dataset.copySourceId, copyBtn);
    return;
  }

  const openBtn = event.target.closest('.att-button');
  if (openBtn) {
    const dialog = document.getElementById(openBtn.dataset.target);
    if (dialog && typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else if (dialog) {
      dialog.setAttribute('open', '');
    }
    return;
  }

  const closeBtn = event.target.closest('[data-close-dialog]');
  if (closeBtn) {
    closeBtn.closest('dialog')?.close();
    return;
  }

  const dialog = event.target.closest('dialog.att-dialog');
  if (dialog && event.target === dialog) {
    dialog.close();
    return;
  }

  closeWidgetMenus();
});

window.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'claude-export-widget-height') {
    const frame = findWidgetFrame(data.frameId);
    if (!frame) return;
    const height = Number(data.height || 0);
    if (!Number.isFinite(height) || height <= 0) return;
    frame.style.height = Math.max(120, Math.ceil(height)) + 'px';
    postPageHeight();
    setTimeout(postPageHeight, 0);
    return;
  }

  if (data.type === 'claude-export-widget-capture-result') {
    const pending = widgetCaptureRequests.get(data.requestId || '');
    if (!pending) return;
    clearTimeout(pending.timeoutId);
    widgetCaptureRequests.delete(data.requestId || '');
    if (data.ok && data.dataUrl) {
      pending.resolve(data);
    } else {
      pending.reject(new Error(data.error || 'widget-capture-failed'));
    }
  }
});

if (typeof ResizeObserver !== 'undefined') {
  const pageResizeObserver = new ResizeObserver(() => queuePageHeightPost());
  if (document.body) pageResizeObserver.observe(document.body);
  const container = document.querySelector('.chat-container');
  if (container && container !== document.body) {
    pageResizeObserver.observe(container);
  }
}

if (typeof IntersectionObserver !== 'undefined') {
  document.querySelectorAll('.toc-panel').forEach((panel) => {
    const tocLinks = Array.from(panel.querySelectorAll('.toc-link'));
    const sectionById = new Map(
      tocLinks
        .map((link) => {
          const targetId = link.dataset.targetId || '';
          return [targetId, document.getElementById(targetId)];
        })
        .filter(([, section]) => section)
    );

    if (sectionById.size === 0) return;

    const activateTocLink = (targetId) => {
      tocLinks.forEach((link) => link.classList.toggle('is-active', link.dataset.targetId === targetId));
    };

    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible.length > 0) {
        activateTocLink(visible[0].target.id);
      }
    }, {
      rootMargin: '-18% 0px -70% 0px',
      threshold: [0.1, 0.25, 0.5],
    });

    sectionById.forEach((section) => observer.observe(section));
  });
}

window.addEventListener('load', () => {
  postPageHeight();
  setTimeout(postPageHeight, 100);
  setTimeout(postPageHeight, 500);
});
window.addEventListener('resize', postPageHeight);
document.addEventListener('readystatechange', postPageHeight);
postPageHeight();
`;

  // ── 组装完整 HTML ─────────────────────────────────────────────────
      const promptTocHtml = promptTocItems.length > 0
        ? `
  <aside class="toc-panel toc-panel--left" aria-label="问题目录">
    <div class="toc-title">问题目录</div>
    <nav class="toc-nav">
      ${promptTocItems.map((item, index) => `
      <a class="toc-link prompt-toc-link${index === 0 ? ' is-active' : ''}" href="#${escHtml(item.id)}" data-target-id="${escHtml(item.id)}">
        <span class="toc-index">${index + 1}</span>
        <span class="toc-text">${escHtml(item.title)}</span>
      </a>`).join('')}
    </nav>
  </aside>`
        : '';

      const widgetTocHtml = widgetTocItems.length > 0
        ? `
  <aside class="toc-panel toc-panel--right" aria-label="控件目录">
    <div class="toc-title">控件目录</div>
    <nav class="toc-nav">
      ${widgetTocItems.map((item, index) => `
      <a class="toc-link widget-toc-link${index === 0 ? ' is-active' : ''}" href="#${escHtml(item.id)}" data-target-id="${escHtml(item.id)}">
        <span class="toc-index">${index + 1}</span>
        <span class="toc-text">${escHtml(item.title)}</span>
      </a>`).join('')}
    </nav>
  </aside>`
        : '';

      const fullHtml = `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${escHtml(chatTitle)}</title>
  <style>${PAGE_CSS}</style>
</head>
<body>
  ${promptTocHtml}
  ${widgetTocHtml}
  <div class="chat-container">
    <h1 class="chat-title">💬 ${escHtml(chatTitle)}</h1>
    ${turnsHtml.join('\n')}
  </div>
  <script>${PAGE_SCRIPT}</script>
</body>
</html>`;

      setProgress({
        state: 'done',
        stage: 'done',
        completed: completedAttachments,
        total: totalAttachments,
        message: '✅ 导出成功！',
      });
      scheduleProgressCleanup();
      return { html: fullHtml, title: chatTitle, promptSummaries };
    } catch (e) {
      return fail(e && e.message ? e.message : String(e));
    }
  })();
}
