// Client-side webview script. Copied verbatim into out/panel.js at build time.
(function () {
  const vscode = acquireVsCodeApi();

  const orgSelect = document.getElementById('org-select');
  const refreshBtn = document.getElementById('refresh-orgs');
  const runBtn = document.getElementById('run-btn');
  const tabsEl = document.getElementById('tabs');
  const codeEl = document.getElementById('code');
  const outputBody = document.getElementById('output-body');
  const outputStatus = document.getElementById('output-status');
  const logBody = document.getElementById('log-body');

  let state = { tabs: [], activeTabId: null };
  let orgs = { orgs: [], selected: null };
  let suppressCodeEvent = false;
  let currentLogEntries = [];
  const activeFilters = new Set(['USER_DEBUG', 'SOQL', 'DML', 'EXCEPTION']);

  document.querySelectorAll('.log-header input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) {
        activeFilters.add(cb.dataset.cat);
      } else {
        activeFilters.delete(cb.dataset.cat);
      }
      renderLogEntries();
    });
  });

  function post(message) {
    vscode.postMessage(message);
  }

  function renderOrgs() {
    orgSelect.innerHTML = '';
    if (orgs.orgs.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No authenticated orgs';
      orgSelect.appendChild(opt);
      orgSelect.disabled = true;
      runBtn.disabled = true;
      return;
    }
    orgSelect.disabled = false;
    runBtn.disabled = false;
    for (const org of orgs.orgs) {
      const opt = document.createElement('option');
      opt.value = org.username;
      opt.textContent = org.label;
      if (org.username === orgs.selected) {
        opt.selected = true;
      }
      orgSelect.appendChild(opt);
    }
  }

  function renderTabs() {
    tabsEl.innerHTML = '';
    for (const tab of state.tabs) {
      const el = document.createElement('div');
      el.className = 'tab' + (tab.id === state.activeTabId ? ' active' : '');
      el.dataset.tabId = tab.id;

      const title = document.createElement('span');
      title.className = 'title';
      title.textContent = tab.title;
      title.title = 'Double-click to rename';
      title.addEventListener('dblclick', e => {
        e.stopPropagation();
        title.contentEditable = 'true';
        title.focus();
        const range = document.createRange();
        range.selectNodeContents(title);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      });
      title.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          title.blur();
        }
      });
      title.addEventListener('blur', () => {
        title.contentEditable = 'false';
        const next = title.textContent.trim();
        if (next && next !== tab.title) {
          post({ type: 'renameTab', tabId: tab.id, title: next });
        } else {
          title.textContent = tab.title;
        }
      });

      const close = document.createElement('span');
      close.className = 'close';
      close.textContent = '×';
      close.title = 'Close tab';
      close.addEventListener('click', e => {
        e.stopPropagation();
        post({ type: 'closeTab', tabId: tab.id });
      });

      el.appendChild(title);
      el.appendChild(close);
      el.addEventListener('click', () => {
        if (tab.id !== state.activeTabId) {
          post({ type: 'selectTab', tabId: tab.id });
        }
      });
      tabsEl.appendChild(el);
    }

    const add = document.createElement('div');
    add.className = 'new-tab';
    add.textContent = '+';
    add.title = 'New tab';
    add.addEventListener('click', () => post({ type: 'newTab' }));
    tabsEl.appendChild(add);
  }

  function renderActiveCode() {
    const active = state.tabs.find(t => t.id === state.activeTabId);
    suppressCodeEvent = true;
    codeEl.value = active ? active.code : '';
    suppressCodeEvent = false;
  }

  function setStatus(text, cls) {
    outputStatus.textContent = text;
    outputStatus.className = cls || '';
  }

  function renderExecResult(result) {
    if (!result.compiled) {
      setStatus(`Compile error at line ${result.line}: ${result.compileProblem}`, 'status-err');
    } else if (!result.success) {
      setStatus(`Failed: ${result.exceptionMessage || 'unknown error'}`, 'status-err');
    } else {
      setStatus('Success', 'status-ok');
    }
    const parts = [];
    if (result.exceptionMessage) {
      parts.push(`Exception: ${result.exceptionMessage}`);
    }
    if (result.exceptionStackTrace) {
      parts.push(`Stack:\n${result.exceptionStackTrace}`);
    }
    if (parts.length > 0) {
      outputBody.textContent = parts.join('\n\n');
      outputBody.classList.remove('hidden');
    } else {
      outputBody.textContent = '';
      outputBody.classList.add('hidden');
    }
  }

  function renderLogEntries() {
    logBody.innerHTML = '';
    const visible = currentLogEntries.filter(e => activeFilters.has(e.category));
    if (visible.length === 0) {
      const em = document.createElement('span');
      em.className = 'empty';
      em.style.padding = '8px';
      em.style.display = 'block';
      em.textContent = currentLogEntries.length === 0 ? 'No logs' : 'All entries filtered out';
      logBody.appendChild(em);
      return;
    }
    for (const entry of visible) {
      const row = document.createElement('div');
      row.className = `log-entry log-cat-${entry.category}`;

      const time = document.createElement('span');
      time.className = 'log-time';
      time.textContent = entry.timestamp;

      const type = document.createElement('span');
      type.className = 'log-type';
      type.textContent = entry.eventType;

      row.appendChild(time);
      row.appendChild(type);

      if (entry.lineRef) {
        const line = document.createElement('span');
        line.className = 'log-line';
        line.textContent = entry.lineRef;
        row.appendChild(line);
      }

      if (entry.message) {
        const msg = document.createElement('span');
        msg.className = 'log-msg';
        msg.textContent = entry.message;
        row.appendChild(msg);
      }

      logBody.appendChild(row);
    }
    logBody.scrollTop = logBody.scrollHeight;
  }

  orgSelect.addEventListener('change', () => {
    if (orgSelect.value) {
      post({ type: 'selectOrg', username: orgSelect.value });
    }
  });
  refreshBtn.addEventListener('click', () => post({ type: 'refreshOrgs' }));
  runBtn.addEventListener('click', () => post({ type: 'execute' }));

  codeEl.addEventListener('input', () => {
    if (suppressCodeEvent || !state.activeTabId) {
      return;
    }
    post({ type: 'updateCode', tabId: state.activeTabId, code: codeEl.value });
  });

  codeEl.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      post({ type: 'execute' });
    }
  });

  window.addEventListener('message', event => {
    const msg = event.data;
    switch (msg.type) {
      case 'state':
        state = { tabs: msg.tabs, activeTabId: msg.activeTabId };
        renderTabs();
        renderActiveCode();
        break;
      case 'orgs':
        orgs = { orgs: msg.orgs, selected: msg.selected };
        renderOrgs();
        break;
      case 'execStart':
        setStatus('Running...', 'status-warn');
        outputBody.textContent = '';
        outputBody.classList.add('hidden');
        currentLogEntries = [];
        renderLogEntries();
        runBtn.disabled = true;
        break;
      case 'execResult':
        runBtn.disabled = false;
        renderExecResult(msg.result);
        currentLogEntries = msg.logEntries || [];
        renderLogEntries();
        break;
      case 'execError':
        runBtn.disabled = false;
        setStatus('Error', 'status-err');
        outputBody.textContent = msg.message;
        outputBody.classList.remove('hidden');
        break;
    }
  });

  post({ type: 'ready' });
})();
