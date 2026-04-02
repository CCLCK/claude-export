// Page-injected selection mode helpers. Must stay self-contained.

function extractMessageList() {
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
      source: 'extractMessageList',
      event,
      detail: safeDetail.slice(0, 1200),
    });
    if (debugStore.length > 200) debugStore.splice(0, debugStore.length - 200);
  };
  pushDebug('start');

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

  function findQueryClient() {
    const root = document.getElementById('root');
    if (!root) return null;
    const fiberKey = Object.keys(root).find((k) => k.startsWith('__reactContainer'));
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
      } catch (error) {}
      return walk(fiber.child, depth + 1) || walk(fiber.sibling, depth);
    }
    return walk(root[fiberKey], 0);
  }

  const currentChatUuid = window.location.pathname.split('/').pop();
  const qc = findQueryClient();
  if (!qc) {
    pushDebug('no-query-client');
    return { error: 'React Query Client 未找到，请确保页面已完整加载' };
  }

  const allQueries = qc.getQueryCache().getAll();
  const treeQuery = allQueries.find((q) =>
    JSON.stringify(q.queryKey || '').includes(currentChatUuid)
    && q.state.data && q.state.data.chat_messages
  );
  if (!treeQuery || !treeQuery.state.data) {
    pushDebug('no-tree-query');
    return { error: '对话数据未找到，请确保页面已完整加载' };
  }

  const msgs = (treeQuery.state.data.chat_messages || [])
    .slice()
    .sort((a, b) => (a.index || 0) - (b.index || 0));

  const payload = {
    title: treeQuery.state.data.name || 'Claude Chat',
    messages: msgs
      .filter((msg) => msg.sender === 'human')
      .map((msg) => {
        const contentParts = Array.isArray(msg.content) ? msg.content : [];
        const text = joinTextContentPartsLocal(contentParts, '\n')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 80);
        const attachCount = (msg.attachments || []).length + (msg.files || []).length;
        return {
          uuid: String(msg.uuid || msg.index || ''),
          index: msg.index || 0,
          sender: msg.sender,
          preview: text || (attachCount > 0 ? `[${attachCount} 个附件]` : '（空）'),
          hasAttach: attachCount > 0,
        };
      }),
  };
  pushDebug('success', { title: payload.title, count: payload.messages.length });
  return payload;
}

function askFileNameOnPage(defaultName) {
  const result = window.prompt('请输入导出文件名（不含扩展名）：', defaultName);
  if (result === null) return null;
  const cleaned = String(result).trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/\.+$/g, '')
    .slice(0, 120);
  return cleaned || defaultName;
}

function removeSelectUI() {
  if (typeof window.__CLAUDE_EXPORT_REMOVE_SELECT_UI === 'function') {
    window.__CLAUDE_EXPORT_REMOVE_SELECT_UI();
    return { ok: true };
  }
  document.getElementById('__claude-export-toolbar')?.remove();
  document.getElementById('__claude-export-selection-sidebar')?.remove();
  document.getElementById('__claude-export-select-style')?.remove();
  document.body.classList.remove('__claude-select-mode');
  window.__CLAUDE_EXPORT_SELECT_ACTIVE = false;
  window.__CLAUDE_EXPORT_PENDING_EXPORT = null;
  return { ok: true };
}

function readSelectExportState() {
  const pending = window.__CLAUDE_EXPORT_PENDING_EXPORT || null;
  if (pending) {
    window.__CLAUDE_EXPORT_PENDING_EXPORT = null;
  }
  return {
    active: Boolean(window.__CLAUDE_EXPORT_SELECT_ACTIVE),
    pending,
  };
}

function installSelectUI(config) {
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
      source: 'installSelectUI',
      event,
      detail: safeDetail.slice(0, 1200),
    });
    if (debugStore.length > 200) debugStore.splice(0, debugStore.length - 200);
  };
  pushDebug('start', { tabId: config && config.tabId });
  if (window.__CLAUDE_EXPORT_SELECT_ACTIVE) {
    pushDebug('already-active');
    return { ok: true, alreadyActive: true };
  }

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

  function findQueryClient() {
    const root = document.getElementById('root');
    if (!root) return null;
    const fiberKey = Object.keys(root).find((k) => k.startsWith('__reactContainer'));
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
      } catch (error) {}
      return walk(fiber.child, depth + 1) || walk(fiber.sibling, depth);
    }
    return walk(root[fiberKey], 0);
  }

  const currentChatUuid = window.location.pathname.split('/').pop();
  const qc = findQueryClient();
  if (!qc) return { ok: false, error: 'React Query Client 未找到，请确保页面已完整加载' };

  const allQueries = qc.getQueryCache().getAll();
  const treeQuery = allQueries.find((q) =>
    JSON.stringify(q.queryKey || '').includes(currentChatUuid) &&
    q.state.data && q.state.data.chat_messages
  );
  if (!treeQuery) return { ok: false, error: '对话数据未找到，请确保页面已完整加载' };

  const humanMessages = (treeQuery.state.data.chat_messages || [])
    .slice()
    .sort((a, b) => (a.index || 0) - (b.index || 0))
    .filter((msg) => msg.sender === 'human');

  const style = document.createElement('style');
  style.id = '__claude-export-select-style';
  style.textContent = `
    .__ce-user-row {
      display: flex !important;
      flex-direction: row !important;
      align-items: flex-start !important;
    }
    .__ce-chk-col {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      padding-top: 14px;
      opacity: 0;
      transform: translateX(-6px);
      transition: opacity .2s ease, transform .2s ease;
      pointer-events: none;
    }
    .__ce-chk-col.ready {
      opacity: 1;
      transform: translateX(0);
      pointer-events: auto;
    }
    .__ce-chk {
      width: 22px;
      height: 22px;
      border-radius: 50%;
      border: 2px solid #d8c6ac;
      background: #fff;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: border-color .15s, background .15s, box-shadow .15s;
      flex-shrink: 0;
      box-sizing: border-box;
    }
    .__ce-chk:hover {
      border-color: #a36422;
      box-shadow: 0 0 0 3px rgba(163,100,34,.15);
    }
    .__ce-chk.checked {
      border-color: #a36422;
      background: #a36422;
    }
    .__ce-chk.checked::after {
      content: '';
      display: block;
      width: 6px;
      height: 10px;
      border: 2px solid #fff;
      border-top: none;
      border-left: none;
      transform: rotate(45deg) translate(-1px, -1px);
    }
    .__ce-turn-selected {
      background: rgba(163,100,34,.05) !important;
      border-radius: 12px;
      outline: 1.5px solid rgba(163,100,34,.18);
      outline-offset: 2px;
      transition: background .15s, outline .15s;
    }
    #__claude-export-toolbar {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%) translateY(80px);
      opacity: 0;
      transition: transform .28s cubic-bezier(.34,1.56,.64,1), opacity .22s ease;
      z-index: 99999;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 16px;
      border-radius: 20px;
      background: rgba(250,247,241,.97);
      border: 1px solid #d8c6ac;
      box-shadow: 0 8px 32px rgba(114,91,56,.22), 0 2px 8px rgba(114,91,56,.12);
      backdrop-filter: blur(12px);
      white-space: nowrap;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    #__claude-export-toolbar.show {
      transform: translateX(-50%) translateY(0);
      opacity: 1;
    }
    #__ce-toolbar-count {
      font-size: 13px;
      font-weight: 600;
      color: #7a6d5a;
      min-width: 90px;
    }
    #__ce-toolbar-export,
    #__ce-select-all-btn,
    #__ce-toolbar-cancel {
      padding: 9px 14px;
      border-radius: 12px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid #d8c6ac;
      font-family: inherit;
    }
    #__ce-toolbar-export {
      background: linear-gradient(180deg, #b57229 0%, #9c5d1f 100%);
      color: #fffaf2;
      box-shadow: 0 4px 12px rgba(156,93,31,.25);
      padding: 9px 18px;
    }
    #__ce-toolbar-export:hover:not(:disabled) {
      background: linear-gradient(180deg, #bf7a2d 0%, #a76422 100%);
    }
    #__ce-toolbar-export:disabled {
      background: linear-gradient(180deg, #c9baa7 0%, #b4a28c 100%);
      box-shadow: none;
      cursor: not-allowed;
    }
    #__ce-select-all-btn,
    #__ce-toolbar-cancel {
      background: transparent;
      color: #7a6d5a;
    }
    #__ce-select-all-btn:hover,
    #__ce-toolbar-cancel:hover {
      background: rgba(163,100,34,.08);
      color: #3f3a33;
    }
    #__claude-export-selection-sidebar {
      position: fixed;
      top: 120px;
      right: 24px;
      width: 260px;
      max-height: calc(100vh - 170px);
      z-index: 99998;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border-radius: 18px;
      border: 1px solid #d8c6ac;
      background: rgba(250,247,241,.96);
      box-shadow: 0 12px 30px rgba(114,91,56,.18);
      backdrop-filter: blur(12px);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    #__ce-selection-sidebar-header {
      padding: 14px 16px 10px;
      border-bottom: 1px solid rgba(216,198,172,.7);
    }
    #__ce-selection-sidebar-title {
      margin: 0;
      font-size: 13px;
      font-weight: 700;
      color: #5f513e;
    }
    #__ce-selection-sidebar-meta {
      margin-top: 4px;
      font-size: 11px;
      color: #8a7b67;
    }
    #__ce-selection-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 12px;
      overflow-y: auto;
    }
    .__ce-selection-item {
      display: flex;
      gap: 10px;
      align-items: flex-start;
      padding: 10px 11px;
      border-radius: 12px;
      border: 1px solid rgba(216,198,172,.78);
      background: rgba(255,252,246,.92);
      color: #4a4034;
      cursor: pointer;
      transition: transform .16s ease, background .16s ease, border-color .16s ease, box-shadow .16s ease;
    }
    .__ce-selection-item:hover {
      transform: translateY(-1px);
      border-color: rgba(163,100,34,.45);
      background: #fff9ef;
      box-shadow: 0 6px 16px rgba(163,100,34,.12);
    }
    .__ce-selection-item-badge {
      width: 24px;
      height: 24px;
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 999px;
      background: rgba(163,100,34,.12);
      color: #915718;
      font-size: 11px;
      font-weight: 700;
    }
    .__ce-selection-item-body {
      min-width: 0;
      flex: 1;
    }
    .__ce-selection-item-title {
      margin: 0;
      font-size: 11px;
      font-weight: 700;
      color: #8f5417;
      letter-spacing: .04em;
      text-transform: uppercase;
    }
    .__ce-selection-item-preview {
      margin-top: 4px;
      font-size: 12px;
      line-height: 1.45;
      color: #4a4034;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 3;
      overflow: hidden;
    }
    #__ce-selection-empty {
      padding: 18px 12px 8px;
      font-size: 12px;
      line-height: 1.5;
      color: #8a7b67;
      text-align: center;
    }
    @media (max-width: 1400px) {
      #__claude-export-selection-sidebar {
        width: 232px;
        right: 18px;
      }
    }
  `;
  document.head.appendChild(style);

  const userMsgEls = Array.from(document.querySelectorAll('[data-testid="user-message"]'));
  if (userMsgEls.length === 0) {
    style.remove();
    return { ok: false, error: '未找到用户消息元素（[data-testid="user-message"]），请确保页面已完整加载' };
  }

  function getUuidFromEl(el) {
    const fiberKey = Object.keys(el).find((k) => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
    if (!fiberKey) return null;
    try {
      let fiber = el[fiberKey];
      for (let i = 0; i < 30; i += 1) {
        if (!fiber) break;
        const props = fiber.memoizedProps || fiber.pendingProps || {};
        if (props.message && props.message.uuid) return String(props.message.uuid);
        if (props.uuid) return String(props.uuid);
        fiber = fiber.return;
      }
    } catch (error) {}
    return null;
  }

  function buildPreview(msg, index) {
    const contentParts = Array.isArray(msg && msg.content) ? msg.content : [];
    const text = joinTextContentPartsLocal(contentParts, '\n')
      .replace(/\s+/g, ' ')
      .trim();
    const attachCount = ((msg && msg.attachments) || []).length + ((msg && msg.files) || []).length;
    return {
      label: `问题 ${index + 1}`,
      preview: text || (attachCount > 0 ? `[${attachCount} 个附件]` : '（空消息）'),
    };
  }

  const messageMetaByUuid = new Map();
  humanMessages.forEach((msg, index) => {
    messageMetaByUuid.set(String(msg.uuid || msg.index || index), buildPreview(msg, index));
  });

  const turnData = [];

  userMsgEls.forEach((msgEl, index) => {
    let depth5 = msgEl;
    for (let step = 0; step < 5; step += 1) {
      if (!depth5.parentElement) break;
      depth5 = depth5.parentElement;
    }

    if (!depth5 || !depth5.parentElement || depth5.querySelector(':scope > .__ce-chk-col')) {
      return;
    }

    const depth6 = depth5.parentElement;
    const aiSiblingEl = depth6 ? depth6.nextElementSibling : null;
    const uuid = getUuidFromEl(msgEl) || (humanMessages[index] ? String(humanMessages[index].uuid) : `__ce-turn-${index}`);
    const messageMeta = messageMetaByUuid.get(uuid) || buildPreview(humanMessages[index], index);

    const origStyle = {
      display: depth5.style.display,
      flexDirection: depth5.style.flexDirection,
      alignItems: depth5.style.alignItems,
    };

    depth5.classList.add('__ce-user-row');

    const chkCol = document.createElement('div');
    chkCol.className = '__ce-chk-col';
    const chk = document.createElement('div');
    chk.className = '__ce-chk';
    chkCol.appendChild(chk);
    depth5.prepend(chkCol);

    const toggle = (forceState) => {
      const shouldCheck = forceState !== undefined ? forceState : !chk.classList.contains('checked');
      chk.classList.toggle('checked', shouldCheck);
      if (depth6) depth6.classList.toggle('__ce-turn-selected', shouldCheck);
      if (aiSiblingEl) aiSiblingEl.classList.toggle('__ce-turn-selected', shouldCheck);
      updateToolbar();
    };

    chk.addEventListener('click', (event) => {
      event.stopPropagation();
      toggle();
    });
    depth5.addEventListener('click', (event) => {
      if (event.target.closest('a, button, input, textarea, select, [role="button"], .__ce-chk')) return;
      toggle();
    });

    turnData.push({
      uuid,
      depth5,
      depth6,
      aiSiblingEl,
      chk,
      chkCol,
      origStyle,
      label: messageMeta.label,
      preview: messageMeta.preview,
    });
  });

  if (turnData.length === 0) {
    style.remove();
    pushDebug('no-selectable-nodes');
    return { ok: false, error: '未找到可选择的用户消息节点，请确保当前页面已完整加载' };
  }

  const toolbar = document.createElement('div');
  toolbar.id = '__claude-export-toolbar';
  toolbar.innerHTML = `
    <button id="__ce-select-all-btn" type="button">全选</button>
    <span id="__ce-toolbar-count">已选 0 条</span>
    <button id="__ce-toolbar-export" type="button" disabled>导出选中</button>
    <button id="__ce-toolbar-cancel" type="button">取消</button>
  `;
  document.body.appendChild(toolbar);

  const selectionSidebar = document.createElement('aside');
  selectionSidebar.id = '__claude-export-selection-sidebar';
  selectionSidebar.innerHTML = `
    <div id="__ce-selection-sidebar-header">
      <p id="__ce-selection-sidebar-title">已选消息目录</p>
      <div id="__ce-selection-sidebar-meta">还没选消息</div>
    </div>
    <div id="__ce-selection-list"></div>
  `;
  document.body.appendChild(selectionSidebar);

  window.__CLAUDE_EXPORT_SELECT_ACTIVE = true;
  window.__CLAUDE_EXPORT_PENDING_EXPORT = null;

  const cleanup = () => {
    pushDebug('cleanup');
    turnData.forEach(({ depth5, depth6, aiSiblingEl, chkCol, origStyle }) => {
      depth5.classList.remove('__ce-user-row');
      depth5.style.display = origStyle.display;
      depth5.style.flexDirection = origStyle.flexDirection;
      depth5.style.alignItems = origStyle.alignItems;
      chkCol.remove();
      if (depth6) depth6.classList.remove('__ce-turn-selected');
      if (aiSiblingEl) aiSiblingEl.classList.remove('__ce-turn-selected');
    });
    toolbar.remove();
    selectionSidebar.remove();
    style.remove();
    window.__CLAUDE_EXPORT_SELECT_ACTIVE = false;
    window.__CLAUDE_EXPORT_PENDING_EXPORT = null;
    delete window.__CLAUDE_EXPORT_REMOVE_SELECT_UI;
  };
  window.__CLAUDE_EXPORT_REMOVE_SELECT_UI = cleanup;

  const countEl = toolbar.querySelector('#__ce-toolbar-count');
  const exportBtn = toolbar.querySelector('#__ce-toolbar-export');
  const selAllBtn = toolbar.querySelector('#__ce-select-all-btn');
  const cancelBtn = toolbar.querySelector('#__ce-toolbar-cancel');
  const selectionListEl = selectionSidebar.querySelector('#__ce-selection-list');
  const selectionMetaEl = selectionSidebar.querySelector('#__ce-selection-sidebar-meta');

  const selectedTurns = () => turnData.filter((item) => item.chk.classList.contains('checked'));
  const updateSelectionSidebar = () => {
    const selected = selectedTurns();
    selectionListEl.innerHTML = '';
    if (selected.length === 0) {
      selectionMetaEl.textContent = '还没选消息';
      const empty = document.createElement('div');
      empty.id = '__ce-selection-empty';
      empty.textContent = '勾选左侧复选框后，这里会列出你准备导出的 prompt。';
      selectionListEl.appendChild(empty);
      return;
    }

    selectionMetaEl.textContent = `已选 ${selected.length} 条，点击可跳转`;
    selected.forEach((item, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = '__ce-selection-item';

      const badge = document.createElement('span');
      badge.className = '__ce-selection-item-badge';
      badge.textContent = String(index + 1);

      const body = document.createElement('span');
      body.className = '__ce-selection-item-body';

      const title = document.createElement('span');
      title.className = '__ce-selection-item-title';
      title.textContent = item.label;

      const preview = document.createElement('span');
      preview.className = '__ce-selection-item-preview';
      preview.textContent = item.preview;

      body.appendChild(title);
      body.appendChild(preview);
      button.appendChild(badge);
      button.appendChild(body);
      button.addEventListener('click', () => {
        const target = item.depth6 || item.depth5;
        if (target && typeof target.scrollIntoView === 'function') {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
      selectionListEl.appendChild(button);
    });
  };
  const updateToolbar = () => {
    const checked = selectedTurns();
    countEl.textContent = `已选 ${checked.length} 条`;
    exportBtn.disabled = checked.length === 0;
    selAllBtn.textContent = checked.length === turnData.length ? '取消全选' : '全选';
    updateSelectionSidebar();
  };

  selAllBtn.addEventListener('click', () => {
    const shouldSelectAll = selectedTurns().length !== turnData.length;
    turnData.forEach((item) => {
      item.chk.classList.toggle('checked', shouldSelectAll);
      if (item.depth6) item.depth6.classList.toggle('__ce-turn-selected', shouldSelectAll);
      if (item.aiSiblingEl) item.aiSiblingEl.classList.toggle('__ce-turn-selected', shouldSelectAll);
    });
    updateToolbar();
  });

  cancelBtn.addEventListener('click', () => cleanup());

  exportBtn.addEventListener('click', async () => {
    const selected = selectedTurns();
    if (selected.length === 0) return;
    if (!config || !config.tabId) {
      countEl.textContent = '导出桥接未就绪，请关闭后重试';
      return;
    }
    window.__CLAUDE_EXPORT_PENDING_EXPORT = {
      selectedUuids: selected.map((item) => item.uuid),
      timestamp: Date.now(),
    };
    pushDebug('queue-export', { selected: selected.length });
    countEl.textContent = '正在导出中…';
    exportBtn.disabled = true;
    selAllBtn.disabled = true;
    cancelBtn.disabled = true;
  });

  requestAnimationFrame(() => {
    setTimeout(() => {
      toolbar.classList.add('show');
      turnData.forEach((item, idx) => {
        setTimeout(() => item.chkCol.classList.add('ready'), idx * 20);
      });
    }, 80);
  });

  updateToolbar();
  pushDebug('ready', { selectableCount: turnData.length });
  return { ok: true, alreadyActive: false, count: turnData.length };
}

