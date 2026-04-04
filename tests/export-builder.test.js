const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const adapterPath = '/Users/admin/PycharmProjects/TMP/claude-export/popup-page-adapter.js';
const builderPath = '/Users/admin/PycharmProjects/TMP/claude-export/popup-export-builder.js';
const adapterSource = fs.readFileSync(adapterPath, 'utf8');
const builderSource = fs.readFileSync(builderPath, 'utf8');

function createQueryClient(messages, title = 'Test Chat', chatUuid = 'chat-1', orgUuid = 'org-1') {
  return {
    getQueryCache() {
      return {
        getAll() {
          return [
            {
              queryKey: [{ orgUuid, chatUuid }],
              state: {
                data: {
                  name: title,
                  chat_messages: messages,
                },
              },
            },
          ];
        },
      };
    },
  };
}

function createContext(messages, options = {}) {
  const queryClient = createQueryClient(messages, options.title, options.chatUuid, options.orgUuid);
  const root = {};
  root.__reactContainer$test = {
    memoizedProps: {
      value: queryClient,
    },
  };

  const context = {
    console,
    setTimeout,
    clearTimeout,
    AbortController,
    URL,
    Date,
    Math,
    JSON,
    Number,
    String,
    Object,
    Array,
    RegExp,
    Map,
    Set,
    WeakSet,
    Promise,
    Error,
    Uint8Array,
    encodeURIComponent,
    decodeURIComponent,
    Buffer,
    Blob,
    TextEncoder,
    btoa(value) {
      return Buffer.from(String(value), 'binary').toString('base64');
    },
    fetch: async () => {
      throw new Error('unexpected fetch');
    },
    document: {
      getElementById(id) {
        return id === 'root' ? root : null;
      },
    },
    window: {
      location: {
        pathname: `/chat/${options.chatUuid || 'chat-1'}`,
      },
    },
  };

  vm.createContext(context);
  vm.runInContext(adapterSource, context, { filename: adapterPath });
  vm.runInContext('installClaudePageAdapter();', context, { filename: `${adapterPath}#bootstrap` });
  vm.runInContext(builderSource, context, { filename: builderPath });
  return context;
}

async function runBuilder(messages, overrideOptions = {}) {
  const context = createContext(messages, overrideOptions);
  const extractAndBuild = context.extractAndBuild;
  assert.equal(typeof extractAndBuild, 'function', 'extractAndBuild should be defined');
  return extractAndBuild('test-run', {
    includeThinking: false,
    debugMode: false,
    pageCss: 'body{background:#fff;}',
    pageScript: 'console.log("page-script-test");',
    widgetThemeCss: '.c-gray rect, rect.c-gray { fill:#f5f4ed; }',
    widgetShell: '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>__WIDGET_THEME_CSS__</style></head><body>__WIDGET_CODE__</body>__WIDGET_RUNTIME_SCRIPT__</html>',
    widgetImageExport: { id: '300dpi', label: '300 DPI', scale: 3.125, dpi: 300 },
    ...overrideOptions,
  });
}

test('md2html keeps valid list and code block structure', async () => {
  const messages = [
    {
      uuid: 'h1',
      index: 1,
      sender: 'human',
      content: [{ type: 'text', text: '请整理下面内容' }],
    },
    {
      uuid: 'a1',
      index: 2,
      sender: 'assistant',
      content: [
        {
          type: 'text',
          text: [
            '消息气泡方面：',
            '',
            '- 用户和 Claude 的消息如果有明显的背景色区分',
            '- 引用块（> 的部分）要更像引用',
            '',
            '```js',
            'const answer = 42;',
            '```',
          ].join('\n'),
        },
      ],
    },
  ];

  const result = await runBuilder(messages);
  assert.equal(result.error, undefined);
  assert.match(result.html, /<ul>[\s\S]*<li>用户和 Claude 的消息如果有明显的背景色区分<\/li>/);
  assert.match(result.html, /class="code-block"/);
  assert.doesNotMatch(result.html, /<p>\s*<ul>/);
  assert.doesNotMatch(result.html, /<ul><br>/);
  assert.doesNotMatch(result.html, /<p>\s*<div class="code-block">/);
});

test('selectedUuids exports only chosen human message and its assistant chain', async () => {
  const messages = [
    {
      uuid: 'h1',
      index: 1,
      sender: 'human',
      content: [{ type: 'text', text: '问题一：保留吗' }],
    },
    {
      uuid: 'a1',
      index: 2,
      sender: 'assistant',
      content: [{ type: 'text', text: '回答一：不应该出现在结果里' }],
    },
    {
      uuid: 'h2',
      index: 3,
      sender: 'human',
      content: [{ type: 'text', text: '问题二：应该保留' }],
    },
    {
      uuid: 'a2',
      index: 4,
      sender: 'assistant',
      content: [{ type: 'text', text: '回答二：应该出现在结果里' }],
    },
  ];

  const result = await runBuilder(messages, { selectedUuids: ['h2'] });
  assert.equal(result.error, undefined);
  assert.match(result.html, /问题二：应该保留/);
  assert.match(result.html, /回答二：应该出现在结果里/);
  assert.doesNotMatch(result.html, /问题一：保留吗/);
  assert.doesNotMatch(result.html, /回答一：不应该出现在结果里/);
  assert.equal(result.promptSummaries.length, 1);
  assert.equal(result.promptSummaries[0].text, '问题二：应该保留');
});

test('page adapter exposes normalized human previews for selection mode', async () => {
  const messages = [
    {
      uuid: 'h1',
      index: 1,
      sender: 'human',
      content: [{ type: 'text', text: '第一行\\n第二行' }],
      attachments: [{ file_name: 'notes.txt' }],
    },
    {
      uuid: 'a1',
      index: 2,
      sender: 'assistant',
      content: [{ type: 'text', text: '回答' }],
    },
  ];

  const context = createContext(messages);
  const payload = vm.runInContext('window.__CLAUDE_EXPORT_PAGE_ADAPTER.getHumanMessageList()', context);
  assert.equal(payload.ok, true);
  assert.equal(payload.messages.length, 1);
  assert.equal(payload.messages[0].uuid, 'h1');
  assert.match(payload.messages[0].preview, /第一行 第二行/);
  assert.equal(payload.messages[0].hasAttach, true);
});

test('installClaudePageAdapter remains self-contained when serialized for executeScript', () => {
  const context = {
    window: {},
    document: {
      getElementById() {
        return null;
      },
    },
    Object,
    Array,
    JSON,
    WeakSet,
    Date,
    String,
    RegExp,
  };
  vm.createContext(context);
  const functionSource = vm.runInNewContext('installClaudePageAdapter.toString()', (() => {
    const inner = {
      window: {},
      document: { getElementById() { return null; } },
      Object,
      Array,
      JSON,
      WeakSet,
      Date,
      String,
      RegExp,
    };
    vm.createContext(inner);
    vm.runInContext(adapterSource, inner, { filename: adapterPath });
    return inner;
  })());
  const result = vm.runInContext(`(${functionSource})()`, context);
  assert.equal(result.ok, true);
  assert.equal(context.window.__CLAUDE_EXPORT_PAGE_ADAPTER.version, '1');
});

test('exported html keeps critical DOM hooks and widget shell pieces', async () => {
  const messages = [
    {
      uuid: 'h1',
      index: 1,
      sender: 'human',
      content: [{ type: 'text', text: '讲解 pretext 如何接入导出器' }],
    },
    {
      uuid: 'a1',
      index: 2,
      sender: 'assistant',
      content: [
        { type: 'text', text: '先讲整体思路，再给一个控件。' },
        {
          type: 'tool_use',
          name: 'show_widget',
          input: {
            title: 'pretext_integration_explainer',
            widget_code: '<svg viewBox="0 0 100 40"><rect class="c-gray" x="0" y="0" width="40" height="20"></rect></svg>',
          },
        },
      ],
    },
  ];

  const result = await runBuilder(messages, {
    pretextBundle: 'var pretextExports = { prepareWithSegments: function(){}, layoutWithLines: function(){} };',
  });
  assert.equal(result.error, undefined);
  assert.match(result.html, /class="reply-toggle"/);
  assert.match(result.html, /class="toc-panel toc-panel--left"/);
  assert.match(result.html, /class="toc-panel toc-panel--right"/);
  assert.match(result.html, /class="widget-wrapper"/);
  assert.match(result.html, /data-raw="/);
  assert.match(result.html, /window\.__CLAUDE_EXPORT_RUNTIME_CONFIG/);
  assert.match(result.html, /rect\.c-gray/);
});

test('widget code demo escapes raw tags without swallowing later sections', async () => {
  const messages = [
    {
      uuid: 'h1',
      index: 1,
      sender: 'human',
      content: [{ type: 'text', text: '演示 html_to_dom_live' }],
    },
    {
      uuid: 'a1',
      index: 2,
      sender: 'assistant',
      content: [
        {
          type: 'tool_use',
          name: 'show_widget',
          input: {
            title: 'html_to_dom_live',
            widget_code: [
              '<div class="code-wrap" id="code">',
              '<div class="code-line"><!DOCTYPE html></div>',
              '<div class="code-line"><span class="t-tag"><html</span> <span class="t-attr">lang</span>=<span class="t-val">"zh"</span><span class="t-tag">></span></div>',
              '<div class="code-line"><span class="t-tag"><title></span><span class="t-text">阅读实验</span><span class="t-tag"></title></span></div>',
              '<div class="code-line"><span class="t-tag"><span</span> <span class="t-attr">class</span>=<span class="t-val">"word b2"</span><span class="t-tag">></span><span class="t-text">unprecedented</span><span class="t-tag"></span></div>',
              '</div>',
              '<svg><text x="10" y="10"><button></text></svg>',
              '<div class="preview" id="preview-box"><div class="preview-label">浏览器渲染结果</div><h1>北极冰川消融</h1></div>',
              '<div class="info" id="info-box2">第二段说明</div>',
            ].join(''),
          },
        },
      ],
    },
  ];

  const result = await runBuilder(messages);
  assert.equal(result.error, undefined);
  assert.match(result.html, /&lt;!DOCTYPE html&gt;/);
  assert.match(result.html, /&lt;html/);
  assert.match(result.html, /&lt;\/title&gt;/);
  assert.match(result.html, /&lt;\/span&gt;/);
  assert.match(result.html, /&amp;lt;button&amp;gt;/);
  assert.match(result.html, /浏览器渲染结果/);
  assert.match(result.html, /第二段说明/);
});

test('widget srcdoc height measurement avoids scrollHeight feedback loop', () => {
  assert.doesNotMatch(
    builderSource,
    /if \(maxBottom <= 0\)\s*\{\s*maxBottom = body\.scrollHeight \|\| body\.offsetHeight \|\| 0;\s*\}/
  );
  assert.match(
    builderSource,
    /if \(maxBottom > 0\) return contentHeight;\s*return candidates\.length > 0 \? 0 : fallbackHeight;/
  );
});

test('parent page height sync can shrink from optimistic initial widget height', () => {
  const pageSource = fs.readFileSync('/Users/admin/PycharmProjects/TMP/claude-export/export-page.js', 'utf8');
  assert.match(
    pageSource,
    /if \(maxBottom > 0\) return contentHeight;\s*return candidates\.length > 0 \? 0 : fallbackHeight;/
  );
  assert.match(pageSource, /const safeHintedHeight = \(\(\) => \{/);
  assert.match(pageSource, /const maxReasonableHeight = Math\.max\(baseline \* 4, baseline \+ 2400\);/);
  assert.match(pageSource, /return rawHintedHeight >= 120 && rawHintedHeight <= maxReasonableHeight \? rawHintedHeight : 0;/);
  assert.match(pageSource, /const hasReliableHeight = localHeight > 0 \|\| safeHintedHeight > 0;/);
  assert.doesNotMatch(
    pageSource,
    /const nextHeight = Math\.max\(\s*120,\s*initialHeight,\s*Math\.ceil\(Number\(hintedHeight \|\| 0\) \|\| 0\),\s*measureWidgetFrameContentHeight\(frame\)\s*\);/
  );
});

test('html widget image export falls back to viewport-sized captures when measurement is unreliable', () => {
  assert.doesNotMatch(
    builderSource,
    /const exportHeight = Math\.max\(1, measureContentHeight\(\)\);/
  );
  assert.match(
    builderSource,
    /const exportHeight = Math\.max\(\s*1,\s*measuredHeight,[\s\S]*Math\.ceil\(window\.innerHeight \|\| 0\)/
  );
});

test('svg widgets get a meaningful initial iframe height guess', async () => {
  const messages = [
    {
      uuid: 'h1',
      index: 1,
      sender: 'human',
      content: [{ type: 'text', text: '给我一张大图' }],
    },
    {
      uuid: 'a1',
      index: 2,
      sender: 'assistant',
      content: [
        {
          type: 'tool_use',
          name: 'show_widget',
          input: {
            title: 'large_svg_widget',
            widget_code: '<svg viewBox="0 0 960 420"><rect class="c-gray" x="40" y="110" rx="16" width="220" height="88"></rect></svg>',
          },
        },
      ],
    },
  ];

  const result = await runBuilder(messages);
  assert.equal(result.error, undefined);
  const match = result.html.match(/class="widget-iframe" style="height: (\d+)px;"/);
  assert.ok(match, 'widget iframe should include inline initial height');
  assert.ok(Number(match[1]) >= 360, 'svg widget initial height should not fall back to tiny default height');
});

test('grid widgets get taller initial iframe heights based on card count', async () => {
  const cards = Array.from({ length: 14 }, (_, index) => `
<div class="item-card">
  <p class="item-title">Card ${index + 1}</p>
  <p class="item-desc">This card carries enough text to need a realistic initial widget height.</p>
</div>`).join('');

  const messages = [
    {
      uuid: 'h1',
      index: 1,
      sender: 'human',
      content: [{ type: 'text', text: '给我一个 checklist widget' }],
    },
    {
      uuid: 'a1',
      index: 2,
      sender: 'assistant',
      content: [
        {
          type: 'tool_use',
          name: 'show_widget',
          input: {
            title: 'grid_widget',
            widget_code: [
              '<style>',
              '.section-label{display:inline-block;margin:1.5rem 0 .75rem;}',
              '.item-grid{display:grid;grid-template-columns:repeat(auto-fill, minmax(280px, 1fr));gap:10px;}',
              '.item-card{padding:12px 14px;border:1px solid #ddd;border-radius:8px;}',
              '.item-title{font-weight:600;margin:0 0 6px;}',
              '.item-desc{margin:0;line-height:1.5;}',
              '</style>',
              '<div class="section-label">Checklist</div>',
              '<div class="item-grid">',
              cards,
              '</div>',
            ].join(''),
          },
        },
      ],
    },
  ];

  const result = await runBuilder(messages);
  assert.equal(result.error, undefined);
  const match = result.html.match(/class="widget-iframe" style="height: (\d+)px;"/);
  assert.ok(match, 'grid widget iframe should include inline initial height');
  assert.ok(Number(match[1]) >= 1400, 'grid widget initial height should scale with large card grids');
});
