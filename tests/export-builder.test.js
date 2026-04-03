const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const builderPath = '/Users/admin/PycharmProjects/TMP/claude-export/popup-export-builder.js';
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
