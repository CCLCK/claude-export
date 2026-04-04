// Shared Claude page adapter. Injected into claude.ai before page-side helpers run.

const CLAUDE_EXPORT_PAGE_ADAPTER_KEY = '__CLAUDE_EXPORT_PAGE_ADAPTER';

function installClaudePageAdapter() {
  const ADAPTER_KEY = '__CLAUDE_EXPORT_PAGE_ADAPTER';
  const existing = window[ADAPTER_KEY];
  if (existing && existing.version === '1') {
    return { ok: true, reused: true, version: existing.version };
  }

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
      source: 'page-adapter',
      event,
      detail: safeDetail.slice(0, 1200),
    });
    if (debugStore.length > 200) debugStore.splice(0, debugStore.length - 200);
  };

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

  function findQueryClient() {
    const root = document.getElementById('root');
    if (!root) return null;
    const fiberKey = Object.keys(root).find((key) => key.startsWith('__reactContainer'));
    if (!fiberKey) return null;
    const visited = new WeakSet();
    function walk(fiber, depth) {
      if (!fiber || depth > 200) return null;
      if (visited.has(fiber)) return null;
      visited.add(fiber);
      try {
        const value = fiber.memoizedProps && fiber.memoizedProps.value;
        if (value && typeof value === 'object') {
          if (typeof value.getQueryCache === 'function') return value;
          if (value.client && typeof value.client.getQueryCache === 'function') return value.client;
        }
      } catch (error) {}
      return walk(fiber.child, depth + 1) || walk(fiber.sibling, depth);
    }
    return walk(root[fiberKey], 0);
  }

  function getCurrentChatUuid() {
    return String(window.location.pathname.split('/').pop() || '');
  }

  function getConversationSnapshot() {
    const currentChatUuid = getCurrentChatUuid();
    const qc = findQueryClient();
    if (!qc) {
      return { error: 'React Query Client 未找到，请确保页面已完整加载' };
    }

    const allQueries = qc.getQueryCache().getAll();
    const treeQuery = allQueries.find((query) =>
      JSON.stringify(query.queryKey || '').includes(currentChatUuid)
      && query.state.data
      && query.state.data.chat_messages
    );
    if (!treeQuery || !treeQuery.state.data) {
      return { error: '对话数据未找到，请确保页面已完整加载' };
    }

    const messages = (treeQuery.state.data.chat_messages || [])
      .slice()
      .sort((a, b) => (a.index || 0) - (b.index || 0));

    return {
      ok: true,
      title: treeQuery.state.data.name || 'Claude Chat',
      chatUuid: currentChatUuid,
      messages,
    };
  }

  function getHumanMessageList() {
    const snapshot = getConversationSnapshot();
    if (!snapshot || snapshot.error) return snapshot;

    const messages = snapshot.messages
      .filter((msg) => msg.sender === 'human')
      .map((msg) => {
        const text = joinTextContentParts(msg.content, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\n/g, '\n')
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
          rawMessage: msg,
        };
      });

    return {
      ok: true,
      title: snapshot.title,
      chatUuid: snapshot.chatUuid,
      messages,
    };
  }

  window[ADAPTER_KEY] = {
    version: '1',
    joinTextContentParts,
    findQueryClient,
    getCurrentChatUuid,
    getConversationSnapshot,
    getHumanMessageList,
  };
  pushDebug('adapter-ready', { version: '1' });
  return { ok: true, reused: false, version: '1' };
}

async function ensureClaudePageAdapter(tabId) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: installClaudePageAdapter,
    world: 'MAIN',
  });
  return result && result.result;
}
