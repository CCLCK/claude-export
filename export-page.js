let pageHeightRaf = 0;
const widgetCaptureRequests = new Map();
const runtimeConfig = (window.__CLAUDE_EXPORT_RUNTIME_CONFIG && typeof window.__CLAUDE_EXPORT_RUNTIME_CONFIG === 'object')
  ? window.__CLAUDE_EXPORT_RUNTIME_CONFIG
  : {};
const widgetImageExport = runtimeConfig.widgetImageExport || { id: '300dpi', label: '300 DPI', scale: 3.125, dpi: 300 };
const runtimeDebugEnabled = Boolean(runtimeConfig.debugMode);
const pt = window.__pretext || null;
const runtimeDebugLogLimit = 160;
const runtimeDebugStorageKey = 'claude-export-runtime-debug::' + document.title;
const textLayoutCanvas = document.createElement('canvas');
const textLayoutContext = textLayoutCanvas.getContext('2d');
const graphemeSegmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : null;
const runtimeDebugEntries = (() => {
  try {
    const stored = localStorage.getItem(runtimeDebugStorageKey);
    const parsed = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
})();
window.__CLAUDE_EXPORT_RUNTIME_LOGS = runtimeDebugEntries;

function stringifyRuntimeDebugDetail(detail) {
  if (detail == null) return '';
  if (typeof detail === 'string') return detail.slice(0, 4000);
  try {
    return JSON.stringify(detail, null, 2).slice(0, 4000);
  } catch (error) {
    return String(detail).slice(0, 4000);
  }
}

function persistRuntimeDebugEntries() {
  if (!runtimeDebugEnabled) return;
  try {
    localStorage.setItem(runtimeDebugStorageKey, JSON.stringify(runtimeDebugEntries.slice(-runtimeDebugLogLimit)));
  } catch (error) {
  }
}

function appendRuntimeDebugLog(source, event, detail = null) {
  if (!runtimeDebugEnabled) return;
  runtimeDebugEntries.push({
    at: new Date().toISOString(),
    source: String(source || 'runtime'),
    event: String(event || 'event'),
    detail: stringifyRuntimeDebugDetail(detail),
  });
  if (runtimeDebugEntries.length > runtimeDebugLogLimit) {
    runtimeDebugEntries.splice(0, runtimeDebugEntries.length - runtimeDebugLogLimit);
  }
  persistRuntimeDebugEntries();
  syncRuntimeDebugUI();
}

function formatRuntimeDebugTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || '');
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return y + '-' + m + '-' + d + ' ' + hh + ':' + mm + ':' + ss;
}

function ensureRuntimeDebugNodes() {
  if (!runtimeDebugEnabled) return { toggle: null, panel: null };
  let toggle = document.getElementById('__ce-runtime-debug-toggle');
  let panel = document.getElementById('__ce-runtime-debug-panel');
  if (toggle && panel) return { toggle, panel };

  toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.id = '__ce-runtime-debug-toggle';
  toggle.className = 'runtime-debug-toggle';
  toggle.hidden = true;
  toggle.setAttribute('aria-expanded', 'false');
  toggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17Zm0 0c1.4 0 2.7.34 3.85.94-.88.64-1.6 1.42-2.16 2.3a1.4 1.4 0 0 0-2.38 0 8.8 8.8 0 0 0-2.16-2.3A8.45 8.45 0 0 1 12 3.5Zm-4.84 1.52c1.06.54 1.92 1.34 2.54 2.33-.36.42-.58.97-.58 1.57 0 .27.05.53.13.77A8.9 8.9 0 0 0 5.3 11.2a8.46 8.46 0 0 1 1.86-6.18Zm-.03 13.95a8.47 8.47 0 0 1-1.83-5.2c0-.64.07-1.26.2-1.86a8.94 8.94 0 0 0 3.55 1.35 1.4 1.4 0 0 0 1.33 1 1.4 1.4 0 0 0 1.21-.7c.39.13.8.2 1.23.2.26 0 .52-.02.77-.07a8.88 8.88 0 0 0 1.75 3.18A8.47 8.47 0 0 1 7.13 18.97Zm8.15-1.43a8.46 8.46 0 0 1-1.62-2.89c.44-.25.8-.62 1-1.07a8.9 8.9 0 0 0 3.98-1.57 8.46 8.46 0 0 1-3.36 5.53Zm3.9-7.92a8.95 8.95 0 0 0-4.05 1.66 1.4 1.4 0 0 0-1.3-.87c-.25 0-.49.06-.7.18a8.93 8.93 0 0 0-2.25-2.16 1.4 1.4 0 0 0 .13-.58c0-.22-.05-.43-.14-.62a8.95 8.95 0 0 1 2.82-2.77 8.46 8.46 0 0 1 5.49 5.16Z" fill="currentColor"></path></svg><span>运行时日志</span><span class="runtime-debug-toggle-badge">0</span>';

  panel = document.createElement('section');
  panel.id = '__ce-runtime-debug-panel';
  panel.className = 'runtime-debug-panel';
  panel.hidden = true;
  panel.innerHTML = '<div class="runtime-debug-head"><p class="runtime-debug-title">导出页运行时日志</p><div class="runtime-debug-actions"><button type="button" class="runtime-debug-btn" data-runtime-debug-action="copy">复制</button><button type="button" class="runtime-debug-btn" data-runtime-debug-action="clear">清空</button><button type="button" class="runtime-debug-btn" data-runtime-debug-action="close">关闭</button></div></div><div class="runtime-debug-list"></div>';

  document.body.appendChild(toggle);
  document.body.appendChild(panel);

  toggle.addEventListener('click', () => {
    const nextHidden = !panel.hidden;
    panel.hidden = nextHidden;
    toggle.setAttribute('aria-expanded', nextHidden ? 'false' : 'true');
  });

  panel.addEventListener('click', async (event) => {
    const actionBtn = event.target.closest('[data-runtime-debug-action]');
    if (!actionBtn) return;
    const action = actionBtn.dataset.runtimeDebugAction || '';
    if (action === 'close') {
      panel.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
      return;
    }
    if (action === 'clear') {
      runtimeDebugEntries.splice(0, runtimeDebugEntries.length);
      persistRuntimeDebugEntries();
      syncRuntimeDebugUI();
      return;
    }
    if (action === 'copy') {
      await copyTextContent(runtimeDebugEntries.map((entry) => '[' + formatRuntimeDebugTime(entry.at) + '] ' + entry.source + ' / ' + entry.event + (entry.detail ? '\\n' + entry.detail : '')).join('\\n\\n'));
    }
  });

  return { toggle, panel };
}

function syncRuntimeDebugUI() {
  if (!runtimeDebugEnabled) return;
  const nodes = ensureRuntimeDebugNodes();
  const toggle = nodes.toggle;
  const panel = nodes.panel;
  if (!toggle || !panel) return;
  const badge = toggle.querySelector('.runtime-debug-toggle-badge');
  const list = panel.querySelector('.runtime-debug-list');
  if (!badge || !list) return;

  badge.textContent = String(runtimeDebugEntries.length);
  toggle.hidden = runtimeDebugEntries.length === 0;
  if (runtimeDebugEntries.length === 0) {
    list.innerHTML = '<div class="runtime-debug-empty">当前还没有运行时日志。等页面脚本、控件截图或复制下载链真出问题时，这里会留痕。</div>';
    return;
  }

  list.innerHTML = runtimeDebugEntries.slice().reverse().map((entry) => {
    const detailHtml = entry.detail ? '<pre class="runtime-debug-detail">' + escapeHtml(entry.detail) + '</pre>' : '';
    return '<article class="runtime-debug-entry"><div class="runtime-debug-entry-head"><span class="runtime-debug-source">' + escapeHtml(entry.source) + '</span><span class="runtime-debug-event">' + escapeHtml(entry.event) + '</span><span class="runtime-debug-time">' + escapeHtml(formatRuntimeDebugTime(entry.at)) + '</span></div>' + detailHtml + '</article>';
  }).join('');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

window.addEventListener('error', (event) => {
  appendRuntimeDebugLog('runtime', 'window-error', {
    message: event.message || '',
    filename: event.filename || '',
    lineno: event.lineno || 0,
    colno: event.colno || 0,
    stack: event.error && event.error.stack ? event.error.stack : '',
  });
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  appendRuntimeDebugLog('runtime', 'unhandledrejection', {
    message: reason && reason.message ? reason.message : String(reason || ''),
    stack: reason && reason.stack ? reason.stack : '',
  });
});

appendRuntimeDebugLog('runtime', 'page-script-ready', {
  hasPretext: Boolean(pt),
  debugMode: runtimeDebugEnabled,
});

function sanitizeExportName(raw) {
  const cleaned = String(raw || 'widget')
    .trim()
    .replace(/[<>:"/\\\\|?*\\u0000-\\u001f]/g, '-')
    .replace(/\\s+/g, ' ')
    .replace(/\\.+$/g, '')
    .slice(0, 80);
  return cleaned || 'widget';
}

function segmentText(text) {
  const value = String(text || '');
  if (!value) return [];
  if (graphemeSegmenter) {
    return Array.from(graphemeSegmenter.segment(value), (part) => part.segment);
  }
  return Array.from(value);
}

function trimTextToWidthWithEllipsis(text, width, font) {
  const raw = String(text || '').replace(/\\s+$/g, '');
  if (!raw) return '…';
  if (!textLayoutContext) return raw + '…';
  textLayoutContext.font = font;
  const ellipsis = '…';
  let value = raw;
  while (value && textLayoutContext.measureText(value + ellipsis).width > width) {
    value = value.slice(0, -1);
  }
  return (value || '').replace(/\\s+$/g, '') + ellipsis;
}

function measureWrappedTextWithPretext(text, maxWidth, options = {}) {
  if (!pt || typeof pt.prepare !== 'function' || typeof pt.layout !== 'function') return null;
  const value = String(text || '').replace(/\\r\\n/g, '\\n');
  const width = Math.max(8, Number(maxWidth || 0));
  const font = options.font || '16px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  const lineHeight = Math.max(1, Number(options.lineHeight || 24));
  const maxLines = Math.max(1, Number(options.maxLines || Number.POSITIVE_INFINITY));

  try {
    if (Number.isFinite(maxLines) && maxLines < Number.POSITIVE_INFINITY && typeof pt.prepareWithSegments === 'function' && typeof pt.layoutWithLines === 'function') {
      const prepared = pt.prepareWithSegments(value, font);
      const result = pt.layoutWithLines(prepared, width, lineHeight);
      const rawLines = Array.isArray(result.lines) ? result.lines.map((line) => String(line && typeof line.text === 'string' ? line.text : '')) : [];
      const truncated = rawLines.length > maxLines;
      const lines = rawLines.slice(0, maxLines);
      if (truncated && lines.length) {
        lines[lines.length - 1] = trimTextToWidthWithEllipsis(lines[lines.length - 1], width, font);
      }
      return {
        lines,
        lineCount: lines.length,
        height: Math.ceil(lines.length * lineHeight),
        truncated,
      };
    }

    const prepared = pt.prepare(value, font);
    const result = pt.layout(prepared, width, lineHeight);
    return {
      lines: [],
      lineCount: Math.max(1, Number(result.lineCount || 0)),
      height: Math.ceil(Number(result.height || lineHeight)),
      truncated: false,
    };
  } catch (error) {
    return null;
  }
}

function measureWrappedText(text, maxWidth, options = {}) {
  const pretextResult = measureWrappedTextWithPretext(text, maxWidth, options);
  if (pretextResult) return pretextResult;

  const value = String(text || '').replace(/\\r\\n/g, '\\n');
  const width = Math.max(8, Number(maxWidth || 0));
  const font = options.font || '16px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  const lineHeight = Math.max(1, Number(options.lineHeight || 24));
  const maxLines = Math.max(1, Number(options.maxLines || Number.POSITIVE_INFINITY));

  if (!textLayoutContext) {
    const fallback = value ? [value] : [];
    return {
      lines: fallback.slice(0, maxLines),
      lineCount: Math.min(fallback.length, maxLines),
      height: Math.min(fallback.length, maxLines) * lineHeight,
      truncated: fallback.length > maxLines,
    };
  }

  textLayoutContext.font = font;
  const paragraphs = value.split('\\n');
  const lines = [];
  let truncated = false;

  const pushLine = (line) => {
    if (lines.length >= maxLines) {
      truncated = true;
      return false;
    }
    lines.push(line);
    return true;
  };

  const finalizeWithEllipsis = () => {
    if (!lines.length) return;
    const ellipsis = '…';
    let last = lines[lines.length - 1].replace(/\\s+$/g, '');
    while (last && textLayoutContext.measureText(last + ellipsis).width > width) {
      last = last.slice(0, -1);
    }
    lines[lines.length - 1] = (last || '').replace(/\\s+$/g, '') + ellipsis;
  };

  for (let pIndex = 0; pIndex < paragraphs.length; pIndex += 1) {
    const paragraph = paragraphs[pIndex];
    if (!paragraph) {
      if (!pushLine('')) break;
      continue;
    }
    const segments = segmentText(paragraph);
    let current = '';
    for (let i = 0; i < segments.length; i += 1) {
      const next = current + segments[i];
      if (!current || textLayoutContext.measureText(next).width <= width) {
        current = next;
        continue;
      }
      if (!pushLine(current.replace(/\\s+$/g, ''))) break;
      current = segments[i].trimStart();
      if (lines.length >= maxLines) break;
    }
    if (lines.length >= maxLines) {
      truncated = true;
      break;
    }
    if (!pushLine(current.replace(/\\s+$/g, ''))) {
      truncated = true;
      break;
    }
  }

  if (truncated) {
    finalizeWithEllipsis();
  }

  return {
    lines,
    lineCount: lines.length,
    height: lines.length * lineHeight,
    truncated,
  };
}

function updatePromptTocPreviews() {
  document.querySelectorAll('.toc-preview[data-raw-preview]').forEach((node) => {
    const raw = String(node.dataset.rawPreview || node.textContent || '')
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\n');
    const style = window.getComputedStyle(node);
    const width = node.clientWidth || parseFloat(style.width) || 120;
    const font = style.font || style.fontStyle + ' ' + style.fontVariant + ' ' + style.fontWeight + ' ' + style.fontSize + ' / ' + style.lineHeight + ' ' + style.fontFamily;
    const lineHeight = parseFloat(style.lineHeight) || (parseFloat(style.fontSize) || 12) * 1.45;
    const preview = measureWrappedText(raw, width, {
      font,
      lineHeight,
      maxLines: 3,
    });
    node.textContent = preview.lines.join('\n');
  });
}

function stripFencedCodeBlocks(input) {
  const value = String(input || '');
  const fence = String.fromCharCode(96, 96, 96);
  let result = '';
  let cursor = 0;
  while (cursor < value.length) {
    const start = value.indexOf(fence, cursor);
    if (start === -1) {
      result += value.slice(cursor);
      break;
    }
    result += value.slice(cursor, start);
    const fenceLineEnd = value.indexOf('\\n', start + 3);
    const contentStart = fenceLineEnd === -1 ? value.length : fenceLineEnd + 1;
    const end = value.indexOf(fence, contentStart);
    if (end === -1) {
      result += value.slice(contentStart);
      break;
    }
    result += value.slice(contentStart, end).trim();
    cursor = end + 3;
  }
  return result;
}

function stripInlineMarkdownFormatting(input) {
  const value = String(input || '');
  const tick = String.fromCharCode(96);
  let result = '';
  let index = 0;
  while (index < value.length) {
    const char = value[index];
    if (char === tick) {
      index += 1;
      continue;
    }
    if (char === '*' || char === '_') {
      index += 1;
      continue;
    }
    if (char === '[') {
      const closeBracket = value.indexOf(']', index + 1);
      const openParen = closeBracket === -1 ? -1 : value.indexOf('(', closeBracket + 1);
      const closeParen = openParen === -1 ? -1 : value.indexOf(')', openParen + 1);
      if (closeBracket !== -1 && openParen === closeBracket + 1 && closeParen !== -1) {
        result += value.slice(index + 1, closeBracket);
        index = closeParen + 1;
        continue;
      }
    }
    if (char === '<') {
      const closeAngle = value.indexOf('>', index + 1);
      if (closeAngle !== -1) {
        index = closeAngle + 1;
        continue;
      }
    }
    result += char;
    index += 1;
  }
  return result;
}

function normalizeMarkdownLinePrefix(line) {
  const value = String(line || '');
  let index = 0;
  while (index < value.length && (value[index] === ' ' || value[index] === '\\t')) {
    index += 1;
  }

  let cursor = index;
  while (cursor < value.length && value[cursor] === '#') {
    cursor += 1;
  }
  if (cursor > index && cursor < value.length && value[cursor] === ' ') {
    return value.slice(cursor + 1);
  }

  if (cursor < value.length && (value[cursor] === '-' || value[cursor] === '+' || value[cursor] === '*')) {
    const next = value[cursor + 1];
    if (next === ' ' || next === '\\t') {
      return value.slice(cursor + 1).trimStart();
    }
  }

  let digitCursor = cursor;
  while (digitCursor < value.length && value[digitCursor] >= '0' && value[digitCursor] <= '9') {
    digitCursor += 1;
  }
  if (digitCursor > cursor && value[digitCursor] === '.' && (value[digitCursor + 1] === ' ' || value[digitCursor + 1] === '\\t')) {
    return value.slice(digitCursor + 1).trimStart();
  }

  return value;
}

function normalizeReplyTextForLayout(raw) {
  const normalized = stripFencedCodeBlocks(String(raw || '').split('\\r\\n').join('\\n'));
  const lines = normalized.split('\\n').map((line) => {
    const withoutPrefix = normalizeMarkdownLinePrefix(line);
    return stripInlineMarkdownFormatting(withoutPrefix);
  });
  return lines.join('\\n').trim();
}

function estimatePureTextReplyHeight(wrap, containerWidth) {
  const raw = normalizeReplyTextForLayout(wrap.dataset.raw || '');
  const mdNode = wrap.querySelector('.md');
  const metaNode = wrap.querySelector('.turn-meta--assistant');
  const style = window.getComputedStyle(mdNode || document.body);
  const font = style.font || '16px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  const lineHeight = parseFloat(style.lineHeight) || 28;
  const maxWidth = Math.max(140, Number(containerWidth || wrap.getBoundingClientRect().width || 0) - 16);
  const paragraphs = raw ? raw.split('\\n\\n').filter(Boolean) : [];
  const wrapped = measureWrappedText(raw || ' ', maxWidth, {
    font,
    lineHeight,
    maxLines: Number.POSITIVE_INFINITY,
  });
  const paragraphGap = paragraphs.length > 1 ? (paragraphs.length - 1) * 12 : 0;
  const metaHeight = metaNode ? 32 : 0;
  return Math.max(140, 28 + wrapped.height + paragraphGap + metaHeight);
}

function estimateReplyExpandedHeight(wrap, containerWidth) {
  if (!wrap) return 160;
  if (wrap.dataset.layoutKind === 'text-only') {
    return estimatePureTextReplyHeight(wrap, containerWidth);
  }
  const widthBase = Number(containerWidth || wrap.getBoundingClientRect().width || 0);
  const replyWidth = widthBase || Math.max(260, (document.querySelector('.chat-container')?.getBoundingClientRect().width || 780) - 82);
  let estimated = 44;
  const rawText = wrap.dataset.raw || '';

  if (rawText.trim()) {
    const mdNode = wrap.querySelector('.md');
    const style = window.getComputedStyle(mdNode || document.body);
    const font = style.font || '16px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    const lineHeight = parseFloat(style.lineHeight) || 28;
    const result = measureWrappedText(rawText, Math.max(120, replyWidth - 16), {
      font,
      lineHeight,
      maxLines: Number.POSITIVE_INFINITY,
    });
    estimated += result.height;
  }

  estimated += wrap.querySelectorAll('.code-block').length * 180;
  estimated += wrap.querySelectorAll('.widget-wrapper').length * 380;
  estimated += wrap.querySelectorAll('.thinking-block').length * 130;
  estimated += wrap.querySelectorAll('table').length * 130;

  return Math.max(estimated, 140);
}

function estimateExchangeHeight(exchange) {
  const containerWidth = document.querySelector('.chat-container')?.getBoundingClientRect().width || 780;
  let estimated = 96;

  const userText = exchange.querySelector('.user-text');
  if (userText) {
    const style = window.getComputedStyle(userText);
    const font = style.font || '15px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    const lineHeight = parseFloat(style.lineHeight) || 27;
    const width = userText.closest('.bubble')?.getBoundingClientRect().width
      || Math.max(240, containerWidth * 0.84 - 32);
    const result = measureWrappedText(userText.textContent || '', width - 28, {
      font,
      lineHeight,
      maxLines: 4000,
    });
    estimated += result.height + 42;
  }

  const attachments = exchange.querySelectorAll('.attachments .att-tag, .attachments .att-button').length;
  if (attachments > 0) {
    estimated += Math.ceil(attachments / 2) * 28;
  }

  const replyWrap = exchange.querySelector('.reply-wrap');
  if (replyWrap && replyWrap.dataset.state !== 'collapsed') {
    const replyWidth = replyWrap.getBoundingClientRect().width || Math.max(260, containerWidth - 82);
    estimated += estimateReplyExpandedHeight(replyWrap, replyWidth);
  }

  return Math.max(estimated, 140);
}

function syncExchangeIntrinsicSize(exchange) {
  if (!exchange || !exchange.classList.contains('is-virtualized')) return;
  const height = Math.max(Math.ceil(exchange.getBoundingClientRect().height), estimateExchangeHeight(exchange));
  exchange.style.containIntrinsicSize = 'auto ' + height + 'px';
}

function setupLongConversationVirtualization() {
  const exchanges = Array.from(document.querySelectorAll('.exchange'));
  if (exchanges.length < 40 || !CSS.supports('content-visibility', 'auto')) return;

  exchanges.forEach((exchange) => {
    exchange.classList.add('is-virtualized');
    exchange.style.contentVisibility = 'auto';
    exchange.style.contain = 'layout style paint';
    exchange.style.containIntrinsicSize = 'auto ' + estimateExchangeHeight(exchange) + 'px';
  });

  if (typeof ResizeObserver !== 'undefined') {
    const exchangeResizeObserver = new ResizeObserver((entries) => {
      entries.forEach((entry) => syncExchangeIntrinsicSize(entry.target));
      queuePageHeightPost();
    });
    exchanges.forEach((exchange) => exchangeResizeObserver.observe(exchange));
  }
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

function getReplyToggleForWrap(wrap) {
  if (!wrap || !wrap.id) return null;
  return document.querySelector('[data-reply-toggle="' + wrap.id + '"]');
}

function getBulkReplyToggleButton() {
  return document.querySelector('[data-bulk-reply-toggle]');
}

function syncBulkReplyToggleButton() {
  const button = getBulkReplyToggleButton();
  if (!button) return;
  const wraps = Array.from(document.querySelectorAll('.reply-wrap'));
  if (wraps.length === 0) {
    button.hidden = true;
    return;
  }
  button.hidden = false;
  const hasExpanded = wraps.some((wrap) => wrap.dataset.state !== 'collapsed');
  button.setAttribute('aria-expanded', hasExpanded ? 'true' : 'false');
  button.textContent = hasExpanded ? '全部折叠回复' : '全部展开回复';
}

function syncReplyToggle(toggle, expanded) {
  if (!toggle) return;
  toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  const label = expanded ? '折叠回复' : '展开回复';
  toggle.setAttribute('aria-label', label);
  toggle.setAttribute('title', label);
}

function setReplyWrapExpanded(wrap, expanded, options = {}) {
  if (!wrap) return;
  const immediate = Boolean(options.immediate);
  const toggle = getReplyToggleForWrap(wrap);
  const exchange = wrap.closest('.exchange');

  if (wrap.__replyTransitionHandler) {
    wrap.removeEventListener('transitionend', wrap.__replyTransitionHandler);
    wrap.__replyTransitionHandler = null;
  }

  if (expanded) {
    syncReplyToggle(toggle, true);
    const estimatedHeight = estimateReplyExpandedHeight(wrap, wrap.getBoundingClientRect().width);
    const shouldUsePureEstimate = pt && wrap.dataset.layoutKind === 'text-only';
    const fallbackHeight = (!immediate && !shouldUsePureEstimate) ? Math.ceil(wrap.scrollHeight) : 0;
    const targetHeight = Math.max(Math.ceil(estimatedHeight || 0), fallbackHeight, 0);
    wrap.dataset.state = immediate ? 'expanded' : 'animating';
    wrap.style.opacity = '1';
    if (immediate) {
      wrap.style.height = 'auto';
      syncExchangeIntrinsicSize(exchange);
      queuePageHeightPost();
      return;
    }
    wrap.style.height = '0px';
    requestAnimationFrame(() => {
      wrap.style.height = targetHeight + 'px';
    });
    const onExpandEnd = (event) => {
      if (event.propertyName !== 'height') return;
      wrap.dataset.state = 'expanded';
      wrap.style.height = 'auto';
      wrap.style.opacity = '1';
      wrap.removeEventListener('transitionend', onExpandEnd);
      wrap.__replyTransitionHandler = null;
      syncExchangeIntrinsicSize(exchange);
      syncBulkReplyToggleButton();
      queuePageHeightPost();
    };
    wrap.__replyTransitionHandler = onExpandEnd;
    wrap.addEventListener('transitionend', onExpandEnd);
    return;
  }

  syncReplyToggle(toggle, false);
  const currentHeight = Math.max(
    Math.ceil(wrap.getBoundingClientRect().height),
    Math.ceil(wrap.scrollHeight),
    0
  );
  wrap.style.opacity = '1';
  if (immediate) {
    wrap.dataset.state = 'collapsed';
    wrap.style.height = '0px';
    wrap.style.opacity = '0';
    syncExchangeIntrinsicSize(exchange);
    queuePageHeightPost();
    return;
  }
  wrap.style.height = currentHeight + 'px';
  wrap.dataset.state = 'animating';
  requestAnimationFrame(() => {
    wrap.dataset.state = 'collapsed';
    wrap.style.height = '0px';
    wrap.style.opacity = '0';
  });
  const onCollapseEnd = (event) => {
    if (event.propertyName !== 'height') return;
    wrap.removeEventListener('transitionend', onCollapseEnd);
    wrap.__replyTransitionHandler = null;
    syncExchangeIntrinsicSize(exchange);
    syncBulkReplyToggleButton();
    queuePageHeightPost();
  };
  wrap.__replyTransitionHandler = onCollapseEnd;
  wrap.addEventListener('transitionend', onCollapseEnd);
}

function setAllRepliesExpanded(expanded) {
  document.querySelectorAll('.reply-wrap').forEach((wrap) => {
    const isExpanded = wrap.dataset.state !== 'collapsed';
    if (isExpanded === expanded) return;
    setReplyWrapExpanded(wrap, expanded);
  });
  syncBulkReplyToggleButton();
}

function syncTocPanelToggle(panel) {
  if (!panel) return;
  const button = panel.querySelector('[data-toc-panel-toggle]');
  if (!button) return;
  const collapsed = panel.classList.contains('is-collapsed');
  button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  const labelBase = panel.classList.contains('toc-panel--left') ? '问题目录' : '控件目录';
  const label = collapsed ? '展开' + labelBase : '折叠' + labelBase;
  button.setAttribute('aria-label', label);
  button.setAttribute('title', label);
}

function toggleTocPanel(panel) {
  if (!panel) return;
  panel.classList.toggle('is-collapsed');
  syncTocPanelToggle(panel);
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
    appendRuntimeDebugLog('widget', 'copy-image-failed', {
      frameId,
      widgetTitle,
      error: error && error.message ? error.message : String(error),
    });
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
    appendRuntimeDebugLog('widget', 'download-image-failed', {
      frameId,
      widgetTitle,
      error: error && error.message ? error.message : String(error),
    });
    setTransientButtonContent(trigger, trigger.dataset.failureHtml || '下载失败', 'is-error');
    return false;
  }
}

document.addEventListener('click', (event) => {
  const tocLink = event.target.closest('.toc-link');
  if (tocLink) {
    const targetId = tocLink.dataset.targetId || '';
    const targetSection = targetId ? document.getElementById(targetId) : null;
    const collapsedReply = targetSection ? targetSection.closest('.reply-wrap[data-state="collapsed"]') : null;
    if (collapsedReply) {
      event.preventDefault();
      setReplyWrapExpanded(collapsedReply, true);
      setTimeout(() => {
        targetSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 220);
    }
    const tocPanel = tocLink.closest('.toc-panel');
    if (tocPanel) {
      tocPanel.querySelectorAll('.toc-link').forEach((link) => link.classList.remove('is-active'));
    }
    tocLink.classList.add('is-active');
    return;
  }

  const replyToggle = event.target.closest('[data-reply-toggle]');
  if (replyToggle) {
    const wrap = document.getElementById(replyToggle.dataset.replyToggle || '');
    if (wrap) {
      const expanded = replyToggle.getAttribute('aria-expanded') === 'true';
      setReplyWrapExpanded(wrap, !expanded);
    }
    return;
  }

  const bulkReplyToggle = event.target.closest('[data-bulk-reply-toggle]');
  if (bulkReplyToggle) {
    const shouldCollapse = bulkReplyToggle.getAttribute('aria-expanded') === 'true';
    setAllRepliesExpanded(!shouldCollapse);
    return;
  }

  const tocPanelToggle = event.target.closest('[data-toc-panel-toggle]');
  if (tocPanelToggle) {
    toggleTocPanel(tocPanelToggle.closest('.toc-panel'));
    return;
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
      appendRuntimeDebugLog('widget', 'capture-result-error', {
        requestId: data.requestId || '',
        frameId: data.frameId || '',
        error: data.error || 'widget-capture-failed',
      });
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
  syncRuntimeDebugUI();
  document.querySelectorAll('.reply-wrap').forEach((wrap) => {
    const expanded = wrap.dataset.state !== 'collapsed';
    setReplyWrapExpanded(wrap, expanded, { immediate: true });
  });
  document.querySelectorAll('.toc-panel').forEach((panel) => syncTocPanelToggle(panel));
  syncBulkReplyToggleButton();
  updatePromptTocPreviews();
  setupLongConversationVirtualization();
  postPageHeight();
  setTimeout(postPageHeight, 100);
  setTimeout(postPageHeight, 500);
});
window.addEventListener('resize', () => {
  updatePromptTocPreviews();
  document.querySelectorAll('.exchange.is-virtualized').forEach((exchange) => {
    exchange.style.containIntrinsicSize = 'auto ' + estimateExchangeHeight(exchange) + 'px';
  });
  postPageHeight();
});
document.addEventListener('readystatechange', postPageHeight);
postPageHeight();
