const DEBUG_LOG_KEY = 'claude-export-debug-log';

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || '');
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
}

function getLogs() {
  return new Promise((resolve) => {
    chrome.storage.local.get([DEBUG_LOG_KEY], (result) => {
      if (chrome.runtime.lastError) {
        resolve([]);
        return;
      }
      resolve(Array.isArray(result && result[DEBUG_LOG_KEY]) ? result[DEBUG_LOG_KEY] : []);
    });
  });
}

function setLogs(entries) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [DEBUG_LOG_KEY]: entries }, () => resolve());
  });
}

async function renderLogs() {
  const logList = document.getElementById('logList');
  const meta = document.getElementById('meta');
  const entries = await getLogs();
  meta.textContent = `当前共有 ${entries.length} 条日志`;
  logList.innerHTML = '';
  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = '还没有日志。先在弹窗里开启调试模式，再去跑一次导出或选择消息导出，然后回来刷新。';
    logList.appendChild(empty);
    return;
  }
  entries.slice().reverse().forEach((entry) => {
    const item = document.createElement('article');
    item.className = 'entry';

    const head = document.createElement('div');
    head.className = 'entry-head';

    const source = document.createElement('span');
    source.className = 'badge';
    source.textContent = entry.source || 'unknown';

    const event = document.createElement('span');
    event.className = 'event';
    event.textContent = entry.event || 'event';

    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = formatTime(entry.at);

    head.appendChild(source);
    head.appendChild(event);
    head.appendChild(time);
    item.appendChild(head);

    if (entry.detail) {
      const body = document.createElement('pre');
      body.textContent = String(entry.detail || '');
      item.appendChild(body);
    }

    logList.appendChild(item);
  });
}

document.getElementById('refreshBtn').addEventListener('click', () => {
  void renderLogs();
});

document.getElementById('clearBtn').addEventListener('click', async () => {
  await setLogs([]);
  await renderLogs();
});

void renderLogs();
