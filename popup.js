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
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
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

function buildObsidianMarkdown({ title, htmlFileName, sourceUrl }) {
  const date = formatLocalDate();
  const relativeHref = encodeURI(`./${htmlFileName}`);
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

## 说明

- 如果点击后在 Obsidian 内还是不显示，请直接在文件管理器或默认浏览器中打开 \`${htmlFileName}\`。
- 这篇笔记的作用是检索、标签、双链和归档管理；真正的交互内容保存在同目录 HTML 附件里。
`;
}

document.getElementById('exportBtn').addEventListener('click', async () => {
  const btn = document.getElementById('exportBtn');
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
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractAndBuild,
      world: 'MAIN'
    });

    const { html, title, error } = results[0].result;

    if (error) {
      status.textContent = '提取失败：' + error;
      status.className = 'error';
      btn.disabled = false;
      return;
    }

    const baseName = sanitizeBaseName(`${formatLocalTimestamp()}-${title || 'claude-chat'}`);
    const htmlFileName = `${baseName}.html`;
    const mdFileName = `${baseName}.md`;
    const md = buildObsidianMarkdown({
      title: title || 'Claude Chat',
      htmlFileName,
      sourceUrl: tab.url,
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
function extractAndBuild() {

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

  async function fetchFileContent(att, orgUuid, chatUuid) {
    try {
      if (att.source === 'attachments' && att.extractedContent) {
        return { text: att.extractedContent };
      }

      if (att.previewUrl) {
        const resp = await fetch(att.previewUrl);
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
        const resp = await fetch(url);
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
      return { fetchError: e.message };
    }
  }

  async function fetchUrlAsDataUrl(rawUrl) {
    try {
      if (!rawUrl || /^data:/i.test(rawUrl)) return null;
      const url = new URL(rawUrl, location.href);
      if (url.origin !== location.origin) return null;

      const resp = await fetch(url.href);
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
    const textDataUrl = typeof att.text === 'string' ? textToDataUrl(att.text, mime) : '';
    const downloadHref = att.dataUrl || textDataUrl;
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
    } else if (typeof att.text === 'string') {
      if (isMarkdownLike(att.type || att.name)) {
        previewHtml = `<div class="attachment-preview md">${md2html(att.text)}</div>`;
      } else {
        previewHtml = `<pre class="attachment-preview attachment-pre">${escHtml(att.text)}</pre>`;
      }
      if (downloadHref) {
        previewHtml += `
<div class="att-actions">
  <a class="att-dl-btn" href="${escHtml(downloadHref)}" download="${escHtml(att.name)}">⬇️ 下载文本</a>
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

  // ── 工具：widget_code → 完整独立 srcdoc HTML ───────────────────
  function makeWidgetSrcdoc(widgetCode, iframeId) {
    const frameIdLiteral = JSON.stringify(String(iframeId || ''));
    const resizeScript = `<script>
(() => {
  const frameId = ${frameIdLiteral};
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
    const currentChatUuid = window.location.pathname.split('/').pop();

    const qc = findQueryClient();
    if (!qc) {
      return { html: null, title: '', error: 'React Query Client 未找到，请确保页面已完整加载' };
    }

    const allQueries = qc.getQueryCache().getAll();
    const treeQuery = allQueries.find(q =>
      JSON.stringify(q.queryKey || '').includes(currentChatUuid)
      && q.state.data && q.state.data.chat_messages
    );

    if (!treeQuery || !treeQuery.state.data) {
      return { html: null, title: '', error: '对话数据未找到，请确保页面已完整加载' };
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

    const attMap = {};
    attachmentEntries.forEach(att => {
      if (!attMap[att.messageKey]) attMap[att.messageKey] = [];
      attMap[att.messageKey].push(att);
    });

    // ── 构建对话 HTML ────────────────────────────────────────────────
    const turnsHtml = [];

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

        if (!textContent.trim() && attList.length === 0) continue;

        const attachHtml = attList.length > 0
          ? `<div class="attachments">${attList.map(a =>
              `<button type="button" class="att-tag att-button" data-target="${a.dialogId}">${getFileIcon(a.type || a.name)} ${escHtml(a.name)}</button>`
            ).join('')}</div>`
          : '';
        const dialogHtml = attList.map(a => renderAttachmentDialog(a, a.dialogId)).join('');
        turnsHtml.push(`
<div class="turn user-turn">
  <div class="avatar ua">你</div>
  <div class="bubble ub">
    ${attachHtml}
    <div class="md user-text">${md2html(textContent)}</div>
    ${dialogHtml}
  </div>
</div>`);
        continue;
      }

      // Claude 回复
      if (msg.sender === 'assistant') {
        if (!Array.isArray(msg.content)) continue;
        const parts = [];
        const messageKey = String(msg.uuid || msg.index || turnsHtml.length)
          .replace(/[^a-zA-Z0-9_-]/g, '-');
        let widgetIndex = 0;
        for (const c of msg.content) {
          // 正文文字（跳过空白和思维链）
          if (c.type === 'text' && c.text && c.text.trim()) {
            const textHtml = md2html(await inlineTextAssetUrls(c.text));
            parts.push(`<div class="md">${textHtml}</div>`);
          }
          // 控件（show_widget）→ 内联为 srcdoc iframe
          if (
            c.type === 'tool_use' &&
            c.name && c.name.includes('show_widget') &&
            c.input && c.input.widget_code
          ) {
            const iframeId = `widget-${messageKey}-${widgetIndex++}`;
            const srcdoc = makeWidgetSrcdoc(c.input.widget_code, iframeId);
            const wTitle = escHtml(c.input.title || 'widget');
            parts.push(`
<div class="widget-wrapper">
  <div class="widget-header">⚡ ${wTitle}</div>
  <iframe srcdoc="${srcdoc}" sandbox="allow-scripts" class="widget-iframe" data-iframe-id="${iframeId}" loading="lazy" scrolling="no"></iframe>
</div>`);
          }
        }
        if (parts.length > 0) {
          turnsHtml.push(`
<div class="turn claude-turn">
  <div class="avatar ca">C</div>
  <div class="bubble cb">${parts.join('\n')}</div>
</div>`);
        }
        continue;
      }
    }

  // ── 页面样式 ─────────────────────────────────────────────────────
  const PAGE_CSS = `
*, ::before, *::after { box-sizing: border-box; }

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

/* ── Widget ── */
.widget-wrapper {
  margin: 16px 0; border: 1px solid #e8d5a3;
  border-radius: 12px; overflow: hidden; background: #fff;
  box-shadow: 0 1px 6px rgba(0,0,0,.05);
}
.widget-header {
  background: #fdf6e3; color: #7c4f10;
  padding: 7px 14px; font-size: 12px; font-weight: 600;
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

/* ── 打印优化 ── */
@media print {
  body { background: #fff; font-size: 14px; padding: 0; }
  .widget-iframe { height: auto !important; }
  .att-dialog { display: none; }
  .bubble { max-width: 100%; }
  .turn { page-break-inside: avoid; }
}

/* ── 深色模式（系统自动） ── */
@media (prefers-color-scheme: dark) {
  body { background: #1a1917; color: #e8e4dc; }
  .chat-title { color: #f0ece4; border-bottom-color: #3a3830; }
  .claude-turn + .user-turn { border-top-color: #3a3830; }
  .ub { background: #2c2a26; color: #e8e4dc; }
  .md p code, .md li code { background: rgba(255,255,255,.1); color: #d4d0c8; border-color: rgba(255,255,255,.15); }
  .md blockquote { border-left-color: rgba(255,255,255,.2); color: #b5b0a8; }
  .md th { background: #2c2a26; color: #e8e4dc; }
  .md td { border-color: #3a3830; }
  .md tr:nth-child(even) { background: #222018; }
  .md tr:hover { background: #2c2a26; }
  .widget-wrapper { border-color: #5a4a20; background: #1e1c18; }
  .widget-header { background: #2a2416; color: #d4a84b; border-bottom-color: #3d3420; }
  .widget-iframe { background: #fff; }
}
`;

  const PAGE_SCRIPT = `
let pageHeightRaf = 0;

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

document.addEventListener('click', (event) => {
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
  }
});

window.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type !== 'claude-export-widget-height') return;
  const frame = Array.from(document.querySelectorAll('.widget-iframe')).find((el) => el.dataset.iframeId === data.frameId);
  if (!frame) return;
  const height = Number(data.height || 0);
  if (!Number.isFinite(height) || height <= 0) return;
  frame.style.height = Math.max(120, Math.ceil(height)) + 'px';
  postPageHeight();
  setTimeout(postPageHeight, 0);
});

if (typeof ResizeObserver !== 'undefined') {
  const pageResizeObserver = new ResizeObserver(() => queuePageHeightPost());
  if (document.body) pageResizeObserver.observe(document.body);
  const container = document.querySelector('.chat-container');
  if (container && container !== document.body) {
    pageResizeObserver.observe(container);
  }
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
  const fullHtml = `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${escHtml(chatTitle)}</title>
  <style>${PAGE_CSS}</style>
</head>
<body>
  <div class="chat-container">
    <h1 class="chat-title">💬 ${escHtml(chatTitle)}</h1>
    ${turnsHtml.join('\n')}
  </div>
  <script>${PAGE_SCRIPT}</script>
</body>
</html>`;

    return { html: fullHtml, title: chatTitle };
  })();
}
