// Popup UI, runner orchestration, and event wiring.

const widgetImagePresetSelect = document.getElementById('widgetImagePreset');
if (widgetImagePresetSelect) {
  widgetImagePresetSelect.value = loadWidgetImagePresetId();
  widgetImagePresetSelect.addEventListener('change', () => {
    saveWidgetImagePresetId(widgetImagePresetSelect.value);
  });
}

const exportBtn = document.getElementById('exportBtn');
const selectMsgBtn = document.getElementById('selectMsgBtn');
const openDebugLogBtn = document.getElementById('openDebugLogBtn');
const statusEl = document.getElementById('status');
const selectModeHint = document.getElementById('selectModeHint');
const cancelSelectPageBtn = document.getElementById('cancelSelectPageBtn');
const enableDebugModeCheckbox = document.getElementById('enableDebugMode');
const useExportDirectoryCheckbox = document.getElementById('useExportDirectory');
const exportDirectoryMeta = document.getElementById('exportDirectoryMeta');
const chooseExportDirectoryBtn = document.getElementById('chooseExportDirectoryBtn');
const clearExportDirectoryBtn = document.getElementById('clearExportDirectoryBtn');

function refreshDebugModeUi() {
  const enabled = loadDebugModeEnabled();
  if (enableDebugModeCheckbox) enableDebugModeCheckbox.checked = enabled;
  if (openDebugLogBtn) openDebugLogBtn.style.display = enabled ? '' : 'none';
}

async function refreshExportDirectoryUi() {
  const enabled = loadUseExportDirectoryEnabled();
  const label = loadExportDirectoryLabel();
  const handle = await getStoredExportDirectoryHandle();
  const hasHandle = Boolean(handle);
  if (useExportDirectoryCheckbox) {
    useExportDirectoryCheckbox.checked = enabled && hasHandle;
    useExportDirectoryCheckbox.disabled = typeof window.showDirectoryPicker !== 'function';
  }
  if (exportDirectoryMeta) {
    if (hasHandle && label) {
      exportDirectoryMeta.classList.remove('is-empty');
      exportDirectoryMeta.innerHTML = `<strong>当前目录</strong>${label}`;
    } else if (typeof window.showDirectoryPicker !== 'function') {
      exportDirectoryMeta.classList.add('is-empty');
      exportDirectoryMeta.textContent = '当前环境不支持目录授权，只能走浏览器下载。';
    } else {
      exportDirectoryMeta.classList.add('is-empty');
      exportDirectoryMeta.textContent = '还没有选择固定导出目录。';
    }
  }
  if (clearExportDirectoryBtn) clearExportDirectoryBtn.disabled = !hasHandle;
}

refreshDebugModeUi();
void refreshExportDirectoryUi();

if (enableDebugModeCheckbox) {
  enableDebugModeCheckbox.addEventListener('change', () => {
    saveDebugModeEnabled(enableDebugModeCheckbox.checked);
    refreshDebugModeUi();
  });
}

if (chooseExportDirectoryBtn) {
  chooseExportDirectoryBtn.addEventListener('click', async () => {
    chooseExportDirectoryBtn.disabled = true;
    clearExportDirectoryBtn.disabled = true;
    try {
      const result = await pickAndStoreExportDirectory();
      await appendDebugLog('popup', 'export-directory-picked', { name: result.name });
      await refreshExportDirectoryUi();
      setStatus(`✅ 已固定导出目录：${result.name}`, 'success');
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      await appendDebugLog('popup', 'export-directory-pick-failed', { error: message });
      setStatus(`目录设置失败：${message}`, 'error');
    } finally {
      chooseExportDirectoryBtn.disabled = false;
      await refreshExportDirectoryUi();
    }
  });
}

if (clearExportDirectoryBtn) {
  clearExportDirectoryBtn.addEventListener('click', async () => {
    clearExportDirectoryBtn.disabled = true;
    try {
      await clearStoredExportDirectoryHandle();
      await appendDebugLog('popup', 'export-directory-cleared');
      await refreshExportDirectoryUi();
      setStatus('已清除固定导出目录，后续回退到浏览器下载。', 'success');
    } finally {
      await refreshExportDirectoryUi();
    }
  });
}

if (useExportDirectoryCheckbox) {
  useExportDirectoryCheckbox.addEventListener('change', async () => {
    if (!useExportDirectoryCheckbox.checked) {
      saveUseExportDirectoryEnabled(false);
      await appendDebugLog('popup', 'export-directory-disabled');
      await refreshExportDirectoryUi();
      setStatus('已关闭固定目录导出。', 'success');
      return;
    }
    const handle = await getStoredExportDirectoryHandle();
    if (!handle) {
      try {
        const result = await pickAndStoreExportDirectory();
        await appendDebugLog('popup', 'export-directory-enabled-via-checkbox', { name: result.name });
        setStatus(`✅ 已固定导出目录：${result.name}`, 'success');
      } catch (error) {
        useExportDirectoryCheckbox.checked = false;
        saveUseExportDirectoryEnabled(false);
        setStatus(`目录设置失败：${error.message || error}`, 'error');
      } finally {
        await refreshExportDirectoryUi();
      }
      return;
    }
    saveUseExportDirectoryEnabled(true);
    await appendDebugLog('popup', 'export-directory-enabled');
    await refreshExportDirectoryUi();
    setStatus('已开启固定目录导出。', 'success');
  });
}

function setStatus(message, type = '') {
  if (!statusEl) return;
  statusEl.textContent = message || '';
  statusEl.className = type || '';
}

function setSelectModeHint(visible) {
  if (selectModeHint) selectModeHint.classList.toggle('visible', Boolean(visible));
  if (cancelSelectPageBtn) cancelSelectPageBtn.style.display = visible ? '' : 'none';
}

async function getActiveClaudeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !String(tab.url || '').includes('claude.ai')) {
    throw new Error('请在 Claude 聊天页面使用');
  }
  return tab;
}

async function maybeResolveBaseName(tabId, defaultBaseName, enableRename) {
  if (!enableRename) return defaultBaseName;
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: askFileNameOnPage,
    args: [defaultBaseName],
    world: 'MAIN',
  });
  const value = result && result.result;
  return value == null ? null : sanitizeBaseName(value) || defaultBaseName;
}

async function closeStoredSelectionRunnerTab() {
  const tabId = loadSelectionRunnerTabId();
  if (!tabId) return;
  try {
    await chrome.tabs.remove(tabId);
  } catch (error) {
    // Tab may already be gone.
  } finally {
    clearSelectionRunnerTabId();
  }
}

async function startSelectionRunnerTab(tab, { includeThinking, enableRename, widgetImageExport }) {
  await closeStoredSelectionRunnerTab();
  const params = new URLSearchParams();
  params.set('selectionRunner', '1');
  params.set('tabId', String(tab.id));
  params.set('sourceUrl', String(tab.url || 'https://claude.ai'));
  params.set('includeThinking', includeThinking ? '1' : '0');
  params.set('enableRename', enableRename ? '1' : '0');
  params.set('widgetPreset', String((widgetImageExport && widgetImageExport.id) || DEFAULT_WIDGET_IMAGE_PRESET));
  const runnerUrl = `${chrome.runtime.getURL('popup.html')}?${params.toString()}`;
  const runnerTab = await chrome.tabs.create({
    url: runnerUrl,
    active: false,
    windowId: tab.windowId,
    index: typeof tab.index === 'number' ? tab.index + 1 : undefined,
    openerTabId: tab.id,
  });
  if (!runnerTab || !runnerTab.id) {
    throw new Error('后台导出标签页创建失败，请重试');
  }
  saveSelectionRunnerTabId(runnerTab.id);
  await appendDebugLog('popup', 'runner-tab-created', { runnerTabId: runnerTab.id, sourceTabId: tab.id });
  return runnerTab;
}

async function runExport(tab, { selectedUuids = null, sourceUrl = null, closeAfterSuccess = false } = {}) {
  const includeThinking = Boolean(document.getElementById('includeThinking')?.checked);
  const enableRename = Boolean(document.getElementById('enableRename')?.checked);
  const debugMode = loadDebugModeEnabled();
  const directoryPref = await ensureConfiguredExportDirectoryReady();
  const widgetImageExport = normalizeWidgetImagePreset(widgetImagePresetSelect?.value || DEFAULT_WIDGET_IMAGE_PRESET);
  const pretextBundle = await loadPretextBundleText();
  const exportResources = await loadExportResources();
  saveWidgetImagePresetId(widgetImageExport.id);
  await appendDebugLog('popup', 'run-export-start', {
    tabId: tab && tab.id,
    selectedCount: Array.isArray(selectedUuids) ? selectedUuids.length : 0,
    closeAfterSuccess,
    exportDirectoryEnabled: loadUseExportDirectoryEnabled(),
    exportDirectoryReady: directoryPref.ready,
    exportDirectoryError: directoryPref.error || '',
    debugMode,
  });

  exportBtn.disabled = true;
  if (selectMsgBtn) selectMsgBtn.disabled = true;
  setStatus(selectedUuids ? '正在提取选中消息…' : '正在提取聊天记录…');

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
          world: 'MAIN',
        });
        const progress = progressResult && progressResult.result;
        if (pollingActive && progress && progress.message) {
          setStatus(progress.message);
        }
      } catch (error) {
      } finally {
        pollBusy = false;
      }
    };

    const exportPromise = chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractAndBuild,
      args: [runId, {
        includeThinking,
        widgetImageExport,
        selectedUuids,
        pretextBundle,
        debugMode,
        pageCss: exportResources.pageCss,
        pageScript: exportResources.pageScript,
        widgetThemeCss: exportResources.widgetThemeCss,
        widgetShell: exportResources.widgetShell,
      }],
      world: 'MAIN',
    });
    pollTimer = setInterval(pollProgress, 350);
    await pollProgress();
    let results;
    try {
      results = await exportPromise;
    } finally {
      stopPolling();
    }

    const payload = results && results[0] && results[0].result;
    const { html, title, error } = payload || {};
    if (error) {
      await flushPageDebugLog(tab.id, 'extractAndBuild');
      throw new Error(error);
    }
    const defaultBaseName = sanitizeBaseName(`${title || 'claude-chat'}_${formatLocalTimestamp()}`);
    const baseName = await maybeResolveBaseName(tab.id, defaultBaseName, enableRename);
    if (baseName === null) {
      setStatus('已取消导出');
      return;
    }
    const htmlFileName = `${baseName}.html`;
    const mdFileName = `${baseName}.md`;
    const md = buildObsidianMarkdown({
      title: title || 'Claude Chat',
      htmlFileName,
      sourceUrl: sourceUrl || tab.url,
      promptSummaries: Array.isArray(payload.promptSummaries) ? payload.promptSummaries : [],
    });
    const htmlDownload = await triggerDownload(html, htmlFileName, 'text/html;charset=utf-8');
    await new Promise((resolve) => setTimeout(resolve, 150));
    const mdDownload = await triggerDownload(md, mdFileName, 'text/markdown;charset=utf-8');
    await appendDebugLog('popup', 'run-export-success', {
      htmlFileName,
      mdFileName,
      title: title || 'Claude Chat',
      htmlMethod: htmlDownload && htmlDownload.method,
      mdMethod: mdDownload && mdDownload.method,
    });
    const wantsDirectoryExport = loadUseExportDirectoryEnabled();
    const sameDirectory = htmlDownload && mdDownload && htmlDownload.method === 'directory' && mdDownload.method === 'directory';
    if (sameDirectory) {
      setStatus(`✅ 已导出到固定目录：${htmlDownload.directoryName}`, 'success');
    } else if (wantsDirectoryExport) {
      setStatus('⚠️ 固定目录写入未生效，已回退到浏览器下载。可开启调试模式查看原因。', 'error');
    } else {
      setStatus('✅ 已导出 HTML + Obsidian 模板', 'success');
    }
    if (closeAfterSuccess) {
      clearSelectionRunnerTabId();
      setTimeout(() => {
        try {
          chrome.tabs.getCurrent((currentTab) => {
            if (chrome.runtime.lastError) return;
            if (currentTab && currentTab.id) {
              chrome.tabs.remove(currentTab.id);
              return;
            }
            window.close();
          });
        } catch (error) {
        }
      }, 900);
    }
  } catch (error) {
    await appendDebugLog('popup', 'run-export-failed', {
      tabId: tab && tab.id,
      error: error.message || String(error),
    });
    await flushPageDebugLog(tab && tab.id, 'page');
    setStatus(`导出失败：${error.message || error}`, 'error');
  } finally {
    exportBtn.disabled = false;
    if (selectMsgBtn) selectMsgBtn.disabled = false;
  }
}

if (exportBtn) {
  exportBtn.addEventListener('click', async () => {
    try {
      const tab = await getActiveClaudeTab();
      await appendDebugLog('popup', 'full-export-click', { tabId: tab.id });
      await runExport(tab);
    } catch (error) {
      await appendDebugLog('popup', 'full-export-click-failed', { error: error.message || String(error) });
      setStatus(error.message || String(error), 'error');
      exportBtn.disabled = false;
      if (selectMsgBtn) selectMsgBtn.disabled = false;
    }
  });
}

if (selectMsgBtn) {
  selectMsgBtn.addEventListener('click', async () => {
    let tab = null;
    try {
      tab = await getActiveClaudeTab();
      await appendDebugLog('popup', 'select-mode-click', { tabId: tab.id });
      const includeThinking = Boolean(document.getElementById('includeThinking')?.checked);
      const enableRename = Boolean(document.getElementById('enableRename')?.checked);
      const widgetImageExport = normalizeWidgetImagePreset(widgetImagePresetSelect?.value || DEFAULT_WIDGET_IMAGE_PRESET);
      saveWidgetImagePresetId(widgetImageExport.id);

      selectMsgBtn.disabled = true;
      setStatus('正在注入页面选择模式…');

      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: installSelectUI,
        args: [{
          includeThinking,
          enableRename,
          widgetImageExport,
          tabId: tab.id,
          sourceUrl: tab.url,
        }],
        world: 'MAIN',
      });

      const payload = result && result.result;
      if (!payload || !payload.ok) {
        await flushPageDebugLog(tab.id, 'installSelectUI');
        throw new Error(payload && payload.error ? payload.error : '注入选择模式失败');
      }

      await startSelectionRunnerTab(tab, { includeThinking, enableRename, widgetImageExport });
      await appendDebugLog('popup', 'select-mode-ready', {
        tabId: tab.id,
        count: payload.count || 0,
        alreadyActive: Boolean(payload.alreadyActive),
      });
      setSelectModeHint(true);
      setStatus(payload.alreadyActive ? '页面已处于选择模式，后台导出已待命' : `✅ 已进入选择模式，可选 ${payload.count} 条用户消息`, 'success');
    } catch (error) {
      try {
        await closeStoredSelectionRunnerTab();
        if (tab) {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: removeSelectUI,
            world: 'MAIN',
          });
        }
      } catch (cleanupError) {
      }
      await appendDebugLog('popup', 'select-mode-failed', {
        tabId: tab && tab.id,
        error: error.message || String(error),
      });
      if (tab) await flushPageDebugLog(tab.id, 'installSelectUI');
      setSelectModeHint(false);
      setStatus(error.message || String(error), 'error');
      selectMsgBtn.disabled = false;
    }
  });
}

if (cancelSelectPageBtn) {
  cancelSelectPageBtn.addEventListener('click', async () => {
    try {
      const tab = await getActiveClaudeTab();
      await appendDebugLog('popup', 'select-mode-cancel', { tabId: tab.id });
      await closeStoredSelectionRunnerTab();
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: removeSelectUI,
        world: 'MAIN',
      });
      setSelectModeHint(false);
      setStatus('已退出选择模式');
      if (selectMsgBtn) selectMsgBtn.disabled = false;
    } catch (error) {
      setStatus(error.message || String(error), 'error');
    }
  });
}

function parseSelectionRunnerRequest() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('selectionRunner') !== '1') return null;
  const tabId = Number(params.get('tabId'));
  if (!Number.isFinite(tabId) || tabId <= 0) return null;
  return {
    tabId,
    sourceUrl: params.get('sourceUrl') || 'https://claude.ai',
    includeThinking: params.get('includeThinking') === '1',
    enableRename: params.get('enableRename') === '1',
    widgetPreset: params.get('widgetPreset') || DEFAULT_WIDGET_IMAGE_PRESET,
  };
}

async function maybeRunSelectionRunnerFromQuery() {
  const request = parseSelectionRunnerRequest();
  if (!request) return false;
  await appendDebugLog('runner', 'runner-ready', request);

  if (document.getElementById('includeThinking')) {
    document.getElementById('includeThinking').checked = request.includeThinking;
  }
  if (document.getElementById('enableRename')) {
    document.getElementById('enableRename').checked = request.enableRename;
  }
  if (widgetImagePresetSelect) {
    widgetImagePresetSelect.value = normalizeWidgetImagePreset(request.widgetPreset).id;
  }

  exportBtn.disabled = true;
  if (selectMsgBtn) selectMsgBtn.disabled = true;
  setSelectModeHint(false);
  setStatus('后台导出已待命，等待页面点击“导出选中”…');

  let idlePolls = 0;
  while (true) {
    let state = null;
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: request.tabId },
        func: readSelectExportState,
        world: 'MAIN',
      });
      state = result && result.result;
    } catch (error) {
      await appendDebugLog('runner', 'read-select-state-failed', { error: error.message || String(error) });
      clearSelectionRunnerTabId();
      setStatus('导出失败：无法连接到 Claude 页面', 'error');
      return true;
    }

    if (state && state.pending && Array.isArray(state.pending.selectedUuids) && state.pending.selectedUuids.length > 0) {
      await appendDebugLog('runner', 'pending-export-detected', { selectedCount: state.pending.selectedUuids.length });
      try {
        await chrome.scripting.executeScript({
          target: { tabId: request.tabId },
          func: removeSelectUI,
          world: 'MAIN',
        });
      } catch (error) {
      }
      await runExport(
        { id: request.tabId, url: request.sourceUrl },
        {
          selectedUuids: state.pending.selectedUuids,
          sourceUrl: request.sourceUrl,
          closeAfterSuccess: true,
        }
      );
      return true;
    }

    if (!state || !state.active) {
      idlePolls += 1;
      if (idlePolls >= 2) {
        clearSelectionRunnerTabId();
        chrome.tabs.getCurrent((currentTab) => {
          if (chrome.runtime.lastError) return;
          if (currentTab && currentTab.id) {
            chrome.tabs.remove(currentTab.id);
            return;
          }
          window.close();
        });
        return true;
      }
    } else {
      idlePolls = 0;
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  return true;
}

if (openDebugLogBtn) {
  openDebugLogBtn.addEventListener('click', () => {
    window.open(chrome.runtime.getURL('debug-log.html'), '_blank');
  });
}

void maybeRunSelectionRunnerFromQuery();

// =====================================================================
// 以下函数在页面上下文（claude.ai）中执行
// =====================================================================
