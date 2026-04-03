// Export builder. Passed into chrome.scripting.executeScript and must stay self-contained.

function extractAndBuild(runId, options) {
  const exportRunId = String(runId || `claude-export-${Date.now()}`);
  const includeThinking = Boolean(options && options.includeThinking);
  const pretextBundle = String((options && options.pretextBundle) || '');
  const debugMode = Boolean(options && options.debugMode);
  const pageCssResource = String((options && options.pageCss) || '');
  const pageScriptResource = String((options && options.pageScript) || '');
  const widgetThemeCssResource = String((options && options.widgetThemeCss) || '');
  const widgetShellResource = String((options && options.widgetShell) || '');
  const selectedUuids = Array.isArray(options && options.selectedUuids) && options.selectedUuids.length > 0
    ? new Set(options.selectedUuids.map((value) => String(value)))
    : null;
  const debugStore = window.__CLAUDE_EXPORT_PAGE_DEBUG = Array.isArray(window.__CLAUDE_EXPORT_PAGE_DEBUG)
    ? window.__CLAUDE_EXPORT_PAGE_DEBUG
    : [];
  const pushDebug = (event, detail = null) => {
    let safeDetail = '';
    try {
      safeDetail = typeof detail === 'string' ? detail : JSON.stringify(detail || '');
    } catch (error) {
      safeDetail = String(detail || '');
    }
    debugStore.push({
      at: new Date().toISOString(),
      source: 'extractAndBuild',
      event,
      detail: safeDetail.slice(0, 1200),
    });
    if (debugStore.length > 300) debugStore.splice(0, debugStore.length - 300);
  };
  function joinTextContentPartsLocal(parts, separator = '\n') {
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
    pushDebug('fail', { error: String(error || '') });
    setProgress({ state: 'error', stage: 'error', message });
    scheduleProgressCleanup();
    return { html: null, title: '', error };
  };

  pushDebug('start', {
    includeThinking,
    selectedCount: selectedUuids ? selectedUuids.size : 0,
    hasPretextBundle: Boolean(pretextBundle),
    hasPageCss: Boolean(pageCssResource),
    hasPageScript: Boolean(pageScriptResource),
    hasWidgetThemeCss: Boolean(widgetThemeCssResource),
    hasWidgetShell: Boolean(widgetShellResource),
  });
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

  let markdownCodeBlockCounter = 0;

  function formatCodeLanguageLabel(lang) {
    const normalized = String(lang || '').trim().toLowerCase();
    const labelMap = {
      js: 'JavaScript',
      jsx: 'JSX',
      ts: 'TypeScript',
      tsx: 'TSX',
      py: 'Python',
      rb: 'Ruby',
      rs: 'Rust',
      cpp: 'C++',
      csharp: 'C#',
      cs: 'C#',
      sh: 'Shell',
      bash: 'Bash',
      zsh: 'Zsh',
      yml: 'YAML',
      md: 'Markdown',
      html: 'HTML',
      css: 'CSS',
      json: 'JSON',
      sql: 'SQL',
    };
    if (!normalized) return 'TEXT';
    return labelMap[normalized] || normalized.toUpperCase();
  }

  // ── 工具：轻量 Markdown → HTML（无外部依赖）────────────────────
  function md2html(text) {
    if (!text || !text.trim()) return '';
    let html = text;

    // 先保存代码块，防止内部内容被其他规则误处理
    const codeBlocks = [];
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      const ph = `%%CB${codeBlocks.length}%%`;
      const normalizedCode = String(code || '').replace(/^\n+|\n+$/g, '');
      const languageLabel = formatCodeLanguageLabel(lang);
      const copySourceId = `md-code-copy-${markdownCodeBlockCounter++}`;
      codeBlocks.push(
        `<div class="code-block">
          <div class="code-block-header">
            <span class="code-block-lang">${escHtml(languageLabel)}</span>
            <button
              type="button"
              class="code-block-copy turn-icon-btn"
              data-copy-source-id="${copySourceId}"
              data-default-html="${escHtml(copyIconSvg() + '<span class=\"sr-only\">复制代码</span>')}"
              data-success-html="${escHtml(checkIconSvg() + '<span class=\"sr-only\">已复制</span>')}"
              data-failure-html="${escHtml('<span class=\"turn-copy-failure\">!</span>')}"
              aria-label="复制代码"
              title="复制代码"
            >${copyIconSvg()}<span class="sr-only">复制代码</span></button>
          </div>
          <textarea id="${copySourceId}" class="copy-source" aria-hidden="true" tabindex="-1">${escHtml(normalizedCode)}</textarea>
          <pre><code class="language-${lang || 'text'}">${escHtml(normalizedCode)}</code></pre>
        </div>`
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

    html = html.replace(/<p>(%%CB\d+%%)<\/p>/g, '$1');
    inlineTokens.forEach((fragment, i) => { html = html.replaceAll(`%%IN${i}%%`, fragment); });
    // 修正“标题句 + 列表”被包进同一个 p 的非法结构
    html = html.replace(/<p>([\s\S]*?)<br>\s*(<(?:ul|ol)>[\s\S]*?<\/(?:ul|ol)>)<\/p>/g, (_, intro, list) => {
      const paragraph = intro.trim() ? `<p>${intro.trim()}</p>` : '';
      return `${paragraph}\n${list}`;
    });
    html = html.replace(/<p>\s*(<(?:ul|ol)>[\s\S]*?<\/(?:ul|ol)>)\s*<\/p>/g, '$1');
    // 恢复代码块
    codeBlocks.forEach((cb, i) => { html = html.replace(`%%CB${i}%%`, cb); });
    html = html.replace(/<p>\s*(<div class="code-block">[\s\S]*?<\/div>)\s*<\/p>/g, '$1');
    // 清理列表内部被错误注入的 <br>
    html = html.replace(/<(ul|ol)>\s*<br\s*\/?>/g, '<$1>');
    html = html.replace(/<br\s*\/?>\s*<\/(ul|ol)>/g, '</$1>');
    html = html.replace(/<\/li>\s*<br\s*\/?>\s*<li>/g, '</li><li>');
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

  function chevronIconSvg() {
    return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"></path></svg>`;
  }

  function escapeInlineScriptText(value) {
    return String(value || '').replace(/<\/script/gi, '<\\/script');
  }

  function summarizePromptPreview(text) {
    const compact = String(text || '')
      .replace(/\\n/g, ' ')
      .replace(/\\r/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!compact) return '（该条用户消息主要是附件或空文本）';
    return compact.length > 160 ? `${compact.slice(0, 160)}…` : compact;
  }

  function detectMarkdownCodeFence(text) {
    return /(^|\n)```/.test(String(text || ''));
  }

  function detectMarkdownTable(text) {
    const value = String(text || '');
    return /\|.+\|/.test(value) && /\n\s*\|?[-: ]{3,}\|[-|: ]+/.test(value);
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
    const widgetThemeCss = widgetThemeCssResource || '';
    const widgetShell = widgetShellResource || '<!DOCTYPE html>\n<html>\n<head>\n<meta charset="UTF-8">\n<style>\n__WIDGET_THEME_CSS__\n</style>\n</head>\n<body>__WIDGET_CODE__</body>\n__WIDGET_RUNTIME_SCRIPT__\n</html>\n';
    const inner = widgetShell
      .replace('__WIDGET_THEME_CSS__', widgetThemeCss)
      .replace('__WIDGET_CODE__', widgetCode)
      .replace('__WIDGET_RUNTIME_SCRIPT__', resizeScript);
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
      if (!fiber || depth > 200) return null;
      if (visited.has(fiber)) return null;
      visited.add(fiber);
      try {
        const v = fiber.memoizedProps && fiber.memoizedProps.value;
        if (v && typeof v === 'object') {
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
      const rawChatMsgs = (convData.chat_messages || []).slice().sort((a, b) => (a.index || 0) - (b.index || 0));
      const chatMsgs = selectedUuids
        ? (() => {
            const filtered = [];
            let includeAssistantChain = false;
            for (const msg of rawChatMsgs) {
              const msgKey = String(msg.uuid || msg.index || '');
              if (msg.sender === 'human') {
                includeAssistantChain = selectedUuids.has(msgKey);
                if (includeAssistantChain) filtered.push(msg);
                continue;
              }
              if (msg.sender === 'assistant') {
                if (includeAssistantChain) filtered.push(msg);
                continue;
              }
              if (includeAssistantChain) filtered.push(msg);
            }
            return filtered;
          })()
        : rawChatMsgs;

      if (selectedUuids && chatMsgs.length === 0) {
        return fail('未选中任何可导出的消息');
      }
      pushDebug('messages-ready', {
        rawCount: rawChatMsgs.length,
        exportCount: chatMsgs.length,
        selectedCount: selectedUuids ? selectedUuids.size : 0,
      });

      const totalAttachments = chatMsgs.reduce((count, msg) => {
        if (msg.sender !== 'human') return count;
        return count + (msg.attachments || []).length + (msg.files || []).length;
      }, 0);
      let completedAttachments = 0;
      if (totalAttachments > 0) {
        pushDebug('attachments-start', { totalAttachments });
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
      pushDebug('render-start', { attachmentEntries: attachmentEntries.length });

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
    let pendingUserExchange = null;
    let exchangeCounter = 0;

    function flushPendingUserExchange() {
      if (!pendingUserExchange) return;
      turnsHtml.push(`
<div class="exchange exchange--solo" data-exchange-id="${pendingUserExchange.exchangeId}">
  ${pendingUserExchange.userHtml}
</div>`);
      pendingUserExchange = null;
    }

    for (const msg of chatMsgs) {
      // 用户消息
      if (msg.sender === 'human') {
        flushPendingUserExchange();
        const contentParts = Array.isArray(msg.content) ? msg.content : [];
        const rawTextContent = joinTextContentPartsLocal(contentParts, '\n');
        const textContent = await inlineTextAssetUrls(rawTextContent);

        const messageKey = String(msg.uuid || msg.index || turnsHtml.length)
          .replace(/[^a-zA-Z0-9_-]/g, '-');
        const attList = attMap[messageKey] || [];
        const timeLabel = formatMessageTimestamp(msg);

        if (!textContent.trim() && attList.length === 0) continue;

        const promptIndex = promptTocItems.length + 1;
        const promptLabel = `问题 ${promptIndex}`;
        const promptPreview = summarizePromptPreview(rawTextContent);
        const promptSectionId = makeAnchorId('prompt', promptPreview, promptIndex);
        promptTocItems.push({
          id: promptSectionId,
          title: promptLabel,
          preview: promptPreview,
          raw: rawTextContent,
        });
        promptSummaries.push({
          label: promptPreview,
          text: rawTextContent.trim() || '（该条用户消息主要是附件或空文本，没有可提取的 prompt 文本。）',
        });

        const attachHtml = attList.length > 0
          ? `<div class="attachments">${attList.map(a =>
              `<button type="button" class="att-tag att-button" data-target="${a.dialogId}">${getFileIcon(a.type || a.name)} ${escHtml(a.name)}</button>`
            ).join('')}</div>`
          : '';
        const dialogHtml = attList.map(a => renderAttachmentDialog(a, a.dialogId)).join('');
        const promptCopyId = `prompt-copy-${messageKey}`;
        const promptActionHtml = rawTextContent.trim()
          ? `
<div class="turn-actions turn-actions--user">
  <textarea id="${promptCopyId}" class="copy-source" aria-hidden="true" tabindex="-1">${escHtml(rawTextContent)}</textarea>
  <button
    type="button"
    class="turn-icon-btn turn-copy-btn"
    data-copy-source-id="${promptCopyId}"
    data-default-html="${escHtml(copyIconSvg())}"
    data-success-html="${escHtml(checkIconSvg())}"
    data-failure-html="${escHtml('<span class=\"turn-copy-failure\">!</span>')}"
    aria-label="复制问题文本"
    title="复制问题文本"
  >${copyIconSvg()}</button>
</div>`
          : '';
        const userMetaHtml = (timeLabel || promptActionHtml)
          ? `
<div class="turn-meta turn-meta--user">
  ${timeLabel ? `<div class="turn-time">${escHtml(timeLabel)}</div>` : ''}
  ${promptActionHtml}
</div>`
          : '';
        const exchangeId = `exchange-${exchangeCounter++}`;
        const userSectionHtml = `
<section id="${promptSectionId}" class="prompt-section">
  <div class="turn user-turn">
    <div class="avatar ua" aria-hidden="true"></div>
    <div class="turn-stack turn-stack--user">
      <div class="bubble ub">
        ${attachHtml}
        <div class="md user-text">${md2html(textContent)}</div>
      </div>
      ${userMetaHtml}
      ${dialogHtml}
    </div>
  </div>
</section>`;
        pendingUserExchange = {
          exchangeId,
          userHtml: userSectionHtml,
        };
        continue;
      }

      // Claude 回复
      if (msg.sender === 'assistant') {
        if (!Array.isArray(msg.content)) continue;
        const parts = [];
        const assistantCopyParts = [];
        let hasThinkingContent = false;
        let hasMarkdownCode = false;
        let hasMarkdownTable = false;
        const messageKey = String(msg.uuid || msg.index || turnsHtml.length)
          .replace(/[^a-zA-Z0-9_-]/g, '-');
        const timeLabel = formatMessageTimestamp(msg);
        let widgetIndex = 0;
        for (const c of msg.content) {
          // 正文文字（跳过空白和思维链）
          if (c.type === 'text' && c.text && c.text.trim()) {
            assistantCopyParts.push(c.text);
            hasMarkdownCode = hasMarkdownCode || detectMarkdownCodeFence(c.text);
            hasMarkdownTable = hasMarkdownTable || detectMarkdownTable(c.text);
            const textHtml = md2html(await inlineTextAssetUrls(c.text));
            parts.push(`<div class="md">${textHtml}</div>`);
          }
          if (includeThinking && isThinkingPart(c)) {
            hasThinkingContent = true;
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
          const replyLayoutKind = (!widgetIndex && !hasThinkingContent && !hasMarkdownCode && !hasMarkdownTable)
            ? 'text-only'
            : 'mixed';
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
          if (pendingUserExchange) {
            const replyWrapId = `reply-${pendingUserExchange.exchangeId}`;
            const replyHtml = `
<div class="turn claude-turn reply-shell">
  <div class="reply-side">
    <div class="avatar ca">C</div>
    <button
      type="button"
      class="reply-toggle"
      data-reply-toggle="${replyWrapId}"
      aria-expanded="true"
      aria-label="折叠回复"
      title="折叠回复"
    >${chevronIconSvg()}</button>
  </div>
  <div
    id="${replyWrapId}"
    class="reply-wrap"
    data-state="expanded"
    data-raw="${escHtml(assistantCopyText)}"
    data-layout-kind="${replyLayoutKind}"
    data-widget-count="${widgetIndex}"
  >
    <div class="bubble cb">${parts.join('\n')}${assistantMetaHtml}</div>
  </div>
</div>`;
            turnsHtml.push(`
<div class="exchange exchange--paired" data-exchange-id="${pendingUserExchange.exchangeId}">
  ${pendingUserExchange.userHtml}
  ${replyHtml}
</div>`);
            pendingUserExchange = null;
          } else {
            const standaloneReplyId = `reply-exchange-${exchangeCounter}`;
            const replyHtml = `
<div class="turn claude-turn reply-shell">
  <div class="reply-side">
    <div class="avatar ca">C</div>
    <button
      type="button"
      class="reply-toggle"
      data-reply-toggle="${standaloneReplyId}"
      aria-expanded="true"
      aria-label="折叠回复"
      title="折叠回复"
    >${chevronIconSvg()}</button>
  </div>
  <div
    id="${standaloneReplyId}"
    class="reply-wrap"
    data-state="expanded"
    data-raw="${escHtml(assistantCopyText)}"
    data-layout-kind="${replyLayoutKind}"
    data-widget-count="${widgetIndex}"
  >
    <div class="bubble cb">${parts.join('\n')}${assistantMetaHtml}</div>
  </div>
</div>`;
            turnsHtml.push(`
<div class="exchange exchange--assistant-only" data-exchange-id="exchange-${exchangeCounter++}">
  ${replyHtml}
</div>`);
          }
        }
        continue;
      }
    }

    flushPendingUserExchange();

  // ── 页面样式 ─────────────────────────────────────────────────────
  const PAGE_CSS = pageCssResource || '';
  const runtimeConfigScript = '<script>window.__CLAUDE_EXPORT_RUNTIME_CONFIG = ' + JSON.stringify({
    debugMode,
    widgetImageExport,
  }).replace(/<\/script/gi, '<\\/script') + ';<\/script>';
  const PAGE_SCRIPT = escapeInlineScriptText(pageScriptResource || '');

  // ── 组装完整 HTML ─────────────────────────────────────────────────
      const promptTocHtml = promptTocItems.length > 0
        ? `
  <aside class="toc-panel toc-panel--left" aria-label="问题目录" data-panel-kind="left">
    <div class="toc-head">
      <div class="toc-title">问题目录</div>
      <button type="button" class="toc-panel-toggle" data-toc-panel-toggle aria-expanded="true" aria-label="折叠问题目录" title="折叠问题目录">${chevronIconSvg()}</button>
    </div>
    <nav class="toc-nav">
      ${promptTocItems.map((item, index) => `
      <a class="toc-link prompt-toc-link${index === 0 ? ' is-active' : ''}" href="#${escHtml(item.id)}" data-target-id="${escHtml(item.id)}">
        <span class="toc-index">${index + 1}</span>
        <span class="toc-text">
          <span class="toc-label">${escHtml(item.title)}</span>
          <span class="toc-preview" data-raw-preview="${escHtml(String(item.raw || item.preview || item.title || '').replace(/\\n/g, '\n').replace(/\\r/g, '\n').trim())}">${escHtml(item.preview || item.title)}</span>
        </span>
      </a>`).join('')}
    </nav>
  </aside>`
        : '';

      const widgetTocHtml = widgetTocItems.length > 0
        ? `
  <aside class="toc-panel toc-panel--right" aria-label="控件目录" data-panel-kind="right">
    <div class="toc-head">
      <div class="toc-title">控件目录</div>
      <button type="button" class="toc-panel-toggle" data-toc-panel-toggle aria-expanded="true" aria-label="折叠控件目录" title="折叠控件目录">${chevronIconSvg()}</button>
    </div>
    <nav class="toc-nav">
      ${widgetTocItems.map((item, index) => `
      <a class="toc-link widget-toc-link${index === 0 ? ' is-active' : ''}" href="#${escHtml(item.id)}" data-target-id="${escHtml(item.id)}">
        <span class="toc-index">${index + 1}</span>
        <span class="toc-text">${escHtml(item.title)}</span>
      </a>`).join('')}
    </nav>
  </aside>`
        : '';

      const pretextScriptHtml = pretextBundle
        ? `
  <script>
${escapeInlineScriptText(pretextBundle)}
window.__pretext = (typeof pretextExports !== 'undefined' && pretextExports)
  ? pretextExports
  : (window.__pretext || null);
<\/script>`
        : '';

      const fullHtml = `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${escHtml(chatTitle)}</title>
  <style>${PAGE_CSS}</style>
  ${runtimeConfigScript}
</head>
<body>
  ${promptTocHtml}
  ${widgetTocHtml}
  <div class="chat-container">
    <h1 class="chat-title">💬 ${escHtml(chatTitle)}</h1>
    <div class="page-actions">
      <button type="button" class="page-action-btn" id="toggleAllRepliesBtn" data-bulk-reply-toggle aria-expanded="true">全部折叠回复</button>
    </div>
    ${turnsHtml.join('\n')}
  </div>
  ${pretextScriptHtml}
  <script>${PAGE_SCRIPT}<\/script>
</body>
</html>`;

      setProgress({
        state: 'done',
        stage: 'done',
        completed: completedAttachments,
        total: totalAttachments,
        message: '✅ 导出成功！',
      });
      pushDebug('success', {
        title: chatTitle,
        turnCount: turnsHtml.length,
        promptCount: promptTocItems.length,
        widgetCount: widgetTocItems.length,
      });
      scheduleProgressCleanup();
      return { html: fullHtml, title: chatTitle, promptSummaries };
    } catch (e) {
      return fail(e && e.message ? e.message : String(e));
    }
  })();
}
