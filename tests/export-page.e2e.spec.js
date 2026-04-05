const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

function loadPlaywrightTestApi() {
  const pathEntries = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const npxBinDir = pathEntries.find((entry) => entry.includes(`${path.sep}_npx${path.sep}`) && entry.endsWith(`${path.sep}.bin`));
  const candidates = [
    '@playwright/test',
    npxBinDir ? path.join(npxBinDir, '..', '@playwright', 'test') : '',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (error) {
    }
  }
  throw new Error('Unable to resolve @playwright/test. Run with `npx -p @playwright/test playwright test ...` or install it locally.');
}

const { test, expect } = loadPlaywrightTestApi();

const repoRoot = path.resolve(__dirname, '..');
const pageCss = fs.readFileSync(path.join(repoRoot, 'export-page.css'), 'utf8');
const pageJs = fs.readFileSync(path.join(repoRoot, 'export-page.js'), 'utf8');

test.use({
  browserName: 'chromium',
  channel: 'chrome',
});

function escapeHtmlAttribute(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;');
}

function escapeInlineScript(value) {
  return String(value).replace(/<\/script/gi, '<\\/script');
}

function buildExperimentSummaryFixture() {
  const previewSvg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">',
    '<rect width="1200" height="900" fill="#ffffff"/>',
    '<rect x="36" y="36" width="1128" height="828" rx="30" fill="#fffaf0" stroke="#ead8a2"/>',
    '<rect x="70" y="110" width="1060" height="88" rx="20" fill="#fff3cd"/>',
    '<text x="96" y="164" font-family="Arial" font-size="30" fill="#8b5e1a">研究问题概览（预览图）</text>',
    '<text x="96" y="258" font-family="Arial" font-size="26" fill="#2357c6">RQ1</text>',
    '<text x="166" y="258" font-family="Arial" font-size="24" fill="#1f2937">主效应：四种预读策略对眼动指标是否存在显著差异？</text>',
    '<text x="96" y="332" font-family="Arial" font-size="26" fill="#2357c6">RQ2</text>',
    '<text x="166" y="332" font-family="Arial" font-size="24" fill="#1f2937">理解结果：不同策略是否影响回忆与理解成绩？</text>',
    '<text x="96" y="406" font-family="Arial" font-size="26" fill="#2357c6">RQ3</text>',
    '<text x="166" y="406" font-family="Arial" font-size="24" fill="#1f2937">机制：AI 策略比较是否与认知激活路径一致？</text>',
    '<text x="96" y="480" font-family="Arial" font-size="26" fill="#2357c6">RQ4</text>',
    '<text x="166" y="480" font-family="Arial" font-size="24" fill="#1f2937">边界条件：不同词频层级是否存在稳定差异？</text>',
    '<text x="96" y="554" font-family="Arial" font-size="26" fill="#2357c6">RQ5</text>',
    '<text x="166" y="554" font-family="Arial" font-size="24" fill="#1f2937">探索性：词汇水平是否调节预读策略与眼动指标关系？</text>',
    '</svg>',
  ].join('');

  const previewDataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(previewSvg);
  const liveSrcdoc = [
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    '<meta charset="UTF-8">',
    '<style>',
    'body { margin: 0; font-family: Arial, sans-serif; background: #ffffff; color: #1f2937; }',
    '.panel { padding: 28px 32px 40px; }',
    '.hero { background: #fff7e6; border: 1px solid #f1ddb4; border-radius: 18px; padding: 18px 20px; margin-bottom: 20px; color: #915a11; font-weight: 600; }',
    '.item { display: grid; grid-template-columns: 60px 1fr; gap: 14px; padding: 18px 0; border-bottom: 1px solid #edf2f7; }',
    '.tag { color: #2357c6; font-weight: 700; }',
    '.text { line-height: 1.65; }',
    '</style>',
    '</head>',
    '<body>',
    '<div class="panel">',
    '<div class="hero">experiment_summary live iframe</div>',
    '<div class="item"><div class="tag">RQ1</div><div class="text">主效应: 四种预读策略在 L2 阅读过程中的眼动指标是否存在显著差异。</div></div>',
    '<div class="item"><div class="tag">RQ2</div><div class="text">理解结果: 不同策略是否影响自由回忆与主客观理解成绩。</div></div>',
    '<div class="item"><div class="tag">RQ3</div><div class="text">机制: AI 策略比较是否与认知激活路径保持一致。</div></div>',
    '<div class="item"><div class="tag">RQ4</div><div class="text">边界条件: B2/C1 词频层级下的策略效应是否稳定。</div></div>',
    '<div class="item"><div class="tag">RQ5</div><div class="text">探索性: 词汇水平是否调节预读策略与眼动指标关系。</div></div>',
    '</div>',
    '</body>',
    '</html>',
  ].join('');

  const compactLiveSrcdoc = [
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    '<meta charset="UTF-8">',
    '<style>',
    'body { margin: 0; font-family: Arial, sans-serif; background: #ffffff; color: #1f2937; }',
    '.card { margin: 16px; padding: 18px 20px; border: 1px solid #e5e7eb; border-radius: 16px; background: #f8fafc; }',
    '.title { font-size: 24px; font-weight: 700; margin-bottom: 8px; }',
    '.text { font-size: 16px; line-height: 1.55; }',
    '</style>',
    '</head>',
    '<body>',
    '<div class="card">',
    '<div class="title">compact_summary live iframe</div>',
    '<div class="text">这是一段短展示型 widget 内容，用来验证它默认直接展示 live iframe，而不是先走预览图链路。</div>',
    '</div>',
    '</body>',
    '</html>',
  ].join('');

  const interactiveLiveSrcdoc = [
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    '<meta charset="UTF-8">',
    '<style>',
    'body { margin: 0; font-family: Arial, sans-serif; background: #fffdf7; color: #1f2937; }',
    '.panel { padding: 24px 28px 32px; min-height: 880px; }',
    '.hero { padding: 18px 20px; border-radius: 18px; background: #fff3cd; border: 1px solid #f1ddb4; color: #8b5e1a; font-weight: 700; margin-bottom: 20px; }',
    '.controls { display: flex; gap: 12px; margin-bottom: 18px; }',
    '.btn { appearance: none; border: 1px solid #cbd5e1; border-radius: 999px; padding: 12px 18px; font-size: 18px; background: #ffffff; color: #334155; cursor: pointer; }',
    '.btn.primary { background: #dbeafe; color: #1d4ed8; border-color: #bfdbfe; }',
    '.body { line-height: 1.7; font-size: 18px; }',
    '</style>',
    '</head>',
    '<body>',
    '<div class="panel">',
    '<div class="hero">interactive_summary live iframe</div>',
    '<div class="controls">',
    '<button class="btn primary" type="button" id="toggle-view">切换视图</button>',
    '<button class="btn" type="button" id="pin-note">固定备注</button>',
    '</div>',
    '<div class="body">这是一个高但交互型 widget，默认应该直接显示 live iframe，而不是走预览图链路。</div>',
    '</div>',
    '<script>',
    'document.getElementById("toggle-view").addEventListener("click", function () {',
    '  document.body.setAttribute("data-clicked", "yes");',
    '});',
    '</script>',
    '</body>',
    '</html>',
  ].join('');

  return [
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    '<meta charset="UTF-8">',
    '<title>experiment_summary e2e</title>',
    '<script>',
    'window.__CLAUDE_EXPORT_RUNTIME_CONFIG = { debugMode: false, widgetImageExport: { id: "300dpi", label: "300 DPI", scale: 3.125, dpi: 300 } };',
    'window.__CLAUDE_EXPORT_WIDGET_CAPTURE_LIB = "";',
    '</script>',
    '<style>',
    pageCss,
    '</style>',
    '</head>',
    '<body>',
    '<div class="chat-container">',
    '<section class="widget-section">',
    '<div id="fixture-widget" class="widget-wrapper widget-wrapper--preview-ready">',
    '<div class="widget-header">⚡ experiment_summary</div>',
    `<img class="widget-preview-image" data-widget-preview-for="widget-e2e" data-widget-preview-activate="widget-e2e" alt="experiment_summary preview" title="点击切换到交互模式" src="${previewDataUrl}" width="1200" height="900">`,
    `<iframe class="widget-iframe" data-iframe-id="widget-e2e" data-initial-height="320" data-widget-behavior="display" style="height: 320px;" sandbox="allow-scripts" loading="eager" scrolling="no" srcdoc="${escapeHtmlAttribute(liveSrcdoc)}" aria-hidden="true" tabindex="-1"></iframe>`,
    '</div>',
    '</section>',
    '<section class="widget-section">',
    '<div id="fixture-short-widget" class="widget-wrapper">',
    '<div class="widget-header">⚡ compact_summary</div>',
    `<iframe class="widget-iframe" data-iframe-id="widget-short-e2e" data-initial-height="180" data-widget-behavior="display" style="height: 180px;" sandbox="allow-scripts" loading="lazy" scrolling="no" srcdoc="${escapeHtmlAttribute(compactLiveSrcdoc)}"></iframe>`,
    '</div>',
    '</section>',
    '<section class="widget-section">',
    '<div id="fixture-interactive-widget" class="widget-wrapper">',
    '<div class="widget-header">⚡ interactive_summary</div>',
    `<iframe class="widget-iframe" data-iframe-id="widget-interactive-e2e" data-initial-height="980" data-widget-behavior="interactive" style="height: 980px;" sandbox="allow-scripts" loading="eager" scrolling="no" srcdoc="${escapeHtmlAttribute(interactiveLiveSrcdoc)}"></iframe>`,
    '</div>',
    '</section>',
    '</div>',
    '<script>',
    escapeInlineScript(pageJs),
    '</script>',
    '</body>',
    '</html>',
  ].join('\n');
}

test.describe('export page preview to live iframe', () => {
  let server;
  let baseUrl = '';

  test.beforeAll(async () => {
    const html = buildExperimentSummaryFixture();
    server = http.createServer((request, response) => {
      if (request.url === '/fixture.html') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(html);
        return;
      }
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('not found');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  test.afterAll(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });

  test('experiment_summary starts in preview mode and permanently flips to live iframe after click', async ({ page }) => {
    await page.goto(`${baseUrl}/fixture.html`);

    const widget = page.locator('#fixture-widget');
    const preview = widget.locator('.widget-preview-image');
    const iframe = widget.locator('.widget-iframe');

    await expect(widget).toHaveClass(/widget-wrapper--preview-ready/);
    await expect(widget).not.toHaveClass(/widget-wrapper--live-active/);
    await expect(preview).toBeVisible();
    await expect(iframe).toBeHidden();

    await preview.click();

    await expect(widget).toHaveClass(/widget-wrapper--live-active/);
    await expect(preview).toBeHidden();
    await expect(iframe).toBeVisible();
    await expect(page.frameLocator('iframe[data-iframe-id="widget-e2e"]').locator('text=RQ5')).toBeVisible();

    await page.locator('body').click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(300);

    await expect(widget).toHaveClass(/widget-wrapper--live-active/);
    await expect(preview).toBeHidden();
    await expect(iframe).toBeVisible();
  });

  test('experiment_summary stays in preview mode until the user clicks it', async ({ page }) => {
    await page.goto(`${baseUrl}/fixture.html`);

    const widget = page.locator('#fixture-widget');
    const preview = widget.locator('.widget-preview-image');
    const iframe = widget.locator('.widget-iframe');

    await page.waitForTimeout(3500);

    await expect(widget).toHaveClass(/widget-wrapper--preview-ready/);
    await expect(widget).not.toHaveClass(/widget-wrapper--live-active/);
    await expect(preview).toBeVisible();
    await expect(iframe).toBeHidden();
    await expect(iframe).toHaveAttribute('aria-hidden', 'true');
    await expect(iframe).toHaveAttribute('tabindex', '-1');
  });

  test('non-tall display widgets stay on live iframe by default', async ({ page }) => {
    await page.goto(`${baseUrl}/fixture.html`);

    const widget = page.locator('#fixture-short-widget');
    const preview = widget.locator('.widget-preview-image');
    const iframe = widget.locator('.widget-iframe');

    await page.waitForTimeout(500);

    await expect(widget).not.toHaveClass(/widget-wrapper--preview-ready/);
    await expect(widget).not.toHaveClass(/widget-wrapper--live-active/);
    await expect(preview).toHaveCount(0);
    await expect(iframe).toBeVisible();
    await expect(page.frameLocator('iframe[data-iframe-id="widget-short-e2e"]').locator('text=compact_summary live iframe')).toBeVisible();
  });

  test('tall interactive widgets stay on live iframe by default', async ({ page }) => {
    await page.goto(`${baseUrl}/fixture.html`);

    const widget = page.locator('#fixture-interactive-widget');
    const preview = widget.locator('.widget-preview-image');
    const iframe = widget.locator('.widget-iframe');

    await page.waitForTimeout(500);

    await expect(widget).not.toHaveClass(/widget-wrapper--preview-ready/);
    await expect(widget).not.toHaveClass(/widget-wrapper--live-active/);
    await expect(preview).toHaveCount(0);
    await expect(iframe).toBeVisible();
    await expect(iframe).toHaveAttribute('data-preview-state', 'skipped-interactive');
    await expect(page.frameLocator('iframe[data-iframe-id="widget-interactive-e2e"]').locator('text=interactive_summary live iframe')).toBeVisible();
    await expect(page.frameLocator('iframe[data-iframe-id="widget-interactive-e2e"]').locator('button:has-text("切换视图")')).toBeVisible();
  });

  test('tall interactive widgets remain live after internal interaction and are never taken over by preview mode', async ({ page }) => {
    await page.goto(`${baseUrl}/fixture.html`);

    const widget = page.locator('#fixture-interactive-widget');
    const preview = widget.locator('.widget-preview-image');
    const iframe = widget.locator('.widget-iframe');
    const interactiveFrame = page.frameLocator('iframe[data-iframe-id="widget-interactive-e2e"]');

    await page.waitForTimeout(500);

    await expect(iframe).toBeVisible();
    await expect(preview).toHaveCount(0);
    await interactiveFrame.locator('button:has-text("切换视图")').click();
    await expect(interactiveFrame.locator('body')).toHaveAttribute('data-clicked', 'yes');

    await page.waitForTimeout(3500);

    await expect(widget).not.toHaveClass(/widget-wrapper--preview-ready/);
    await expect(widget).not.toHaveClass(/widget-wrapper--live-active/);
    await expect(preview).toHaveCount(0);
    await expect(iframe).toBeVisible();
    await expect(iframe).toHaveAttribute('data-preview-state', 'skipped-interactive');
    await expect(interactiveFrame.locator('button:has-text("切换视图")')).toBeVisible();
    await expect(interactiveFrame.locator('body')).toHaveAttribute('data-clicked', 'yes');
  });
});
