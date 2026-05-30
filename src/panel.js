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
  const cmdLogToggle = document.getElementById('cmd-log-toggle');
  const cmdLogBody = document.getElementById('cmd-log-body');
  const cmdCount = document.getElementById('cmd-count');
  const cmdChevron = document.getElementById('cmd-chevron');
  const limitsEl = document.getElementById('limits');
  const copyLogBtn = document.getElementById('copy-log-btn');
  const overlayEl = document.getElementById('code-overlay');

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ── Apex syntax highlighting (transparent textarea over a tokenized overlay) ──
  const APEX_KEYWORDS = new Set([
    'public', 'private', 'protected', 'global', 'static', 'final', 'virtual', 'abstract',
    'override', 'transient', 'webservice', 'testmethod', 'with', 'without', 'sharing',
    'inherited', 'class', 'interface', 'enum', 'extends', 'implements', 'trigger', 'on',
    'new', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'when', 'break',
    'continue', 'try', 'catch', 'finally', 'throw', 'this', 'super', 'instanceof',
    'null', 'true', 'false', 'void', 'as', 'get', 'set',
    'insert', 'update', 'upsert', 'delete', 'undelete', 'merge',
    'before', 'after', 'isbefore', 'isafter', 'isinsert', 'isupdate', 'isdelete'
  ]);
  const APEX_TYPES = new Set([
    'integer', 'string', 'boolean', 'decimal', 'double', 'long', 'date', 'datetime',
    'time', 'id', 'blob', 'object', 'list', 'set', 'map', 'sobject', 'schema', 'system',
    'database', 'test', 'userinfo', 'trigger', 'exception', 'type', 'pagereference'
  ]);

  function tokenizeApex(text) {
    const tokens = [];
    let i = 0;
    while (i < text.length) {
      const c = text[i];
      if (/\s/.test(c)) { let s = i; while (i < text.length && /\s/.test(text[i])) { i++; } tokens.push({ t: 'ws', v: text.slice(s, i) }); continue; }
      if (c === '/' && text[i + 1] === '/') { let s = i; while (i < text.length && text[i] !== '\n') { i++; } tokens.push({ t: 'comment', v: text.slice(s, i) }); continue; }
      if (c === '/' && text[i + 1] === '*') { let s = i; i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) { i++; } i = Math.min(i + 2, text.length); tokens.push({ t: 'comment', v: text.slice(s, i) }); continue; }
      if (c === "'") { let s = i; i++; while (i < text.length) { if (text[i] === '\\') { i += 2; continue; } if (text[i] === "'") { i++; break; } i++; } tokens.push({ t: 'string', v: text.slice(s, i) }); continue; }
      if (c === '@' && /[a-zA-Z_]/.test(text[i + 1] || '')) { let s = i; i++; while (i < text.length && /[a-zA-Z0-9_]/.test(text[i])) { i++; } tokens.push({ t: 'annotation', v: text.slice(s, i) }); continue; }
      if (/\d/.test(c)) { let s = i; while (i < text.length && /[\d._a-fxLlDd]/.test(text[i])) { i++; } tokens.push({ t: 'number', v: text.slice(s, i) }); continue; }
      if (/[a-zA-Z_]/.test(c)) {
        let s = i; while (i < text.length && /[a-zA-Z0-9_]/.test(text[i])) { i++; }
        const w = text.slice(s, i); const lw = w.toLowerCase();
        tokens.push({ t: APEX_KEYWORDS.has(lw) ? 'keyword' : APEX_TYPES.has(lw) ? 'type' : 'plain', v: w });
        continue;
      }
      tokens.push({ t: 'plain', v: c }); i++;
    }
    return tokens;
  }

  function highlightApex() {
    if (!overlayEl) { return; }
    const text = codeEl.value;
    if (!text) { overlayEl.innerHTML = ''; return; }
    let html = '';
    for (const tok of tokenizeApex(text)) {
      html += (tok.t === 'ws' || tok.t === 'plain') ? esc(tok.v) : '<span class="tok-' + tok.t + '">' + esc(tok.v) + '</span>';
    }
    overlayEl.innerHTML = html + '\n'; // trailing newline so overlay height matches textarea
  }

  let state = { tabs: [], activeTabId: null };
  let orgs = { orgs: [], selected: null };
  let selectedKind = 'other';
  let suppressCodeEvent = false;
  let isRunning = false;
  let lastRawLog = '';
  let currentLogEntries = [];
  let cmdHistory = [];
  let cmdLogOpen = false;
  const activeFilters = new Set(['USER_DEBUG', 'SOQL', 'DML', 'EXCEPTION']);

  document.querySelectorAll('.log-header input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) { activeFilters.add(cb.dataset.cat); }
      else { activeFilters.delete(cb.dataset.cat); }
      renderLogEntries();
    });
  });

  cmdLogToggle.addEventListener('click', () => {
    cmdLogOpen = !cmdLogOpen;
    cmdLogBody.classList.toggle('hidden', !cmdLogOpen);
    cmdChevron.innerHTML = cmdLogOpen ? '&#x25bc;' : '&#x25b6;';
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
      const badge = org.kind === 'prod' ? ' [PROD]'
        : org.kind === 'sandbox' ? ' [SBX]'
        : org.kind === 'scratch' ? ' [SCR]' : '';
      opt.textContent = org.label + badge;
      if (org.username === orgs.selected) { opt.selected = true; }
      orgSelect.appendChild(opt);
    }
    applyRunButtonKind();
  }

  // Tint the Run button when the selected org is production, as a standing warning.
  function applyRunButtonKind() {
    if (isRunning) {
      runBtn.classList.remove('danger');
      return;
    }
    const isProd = selectedKind === 'prod';
    runBtn.classList.toggle('danger', isProd);
    runBtn.title = isProd ? 'Execute on PRODUCTION' : 'Execute active script';
  }

  function setRunning(running) {
    isRunning = running;
    if (running) {
      runBtn.disabled = false; // keep enabled so it can be clicked to cancel
      runBtn.classList.remove('danger');
      runBtn.innerHTML = '&#x25a0; Cancel';
      runBtn.title = 'Cancel the running execution';
    } else {
      runBtn.disabled = orgs.orgs.length === 0;
      runBtn.innerHTML = '&#x25b6; Run';
      applyRunButtonKind();
    }
  }

  function renderLimits(limits) {
    limitsEl.innerHTML = '';
    if (!limits || limits.length === 0) { return; }
    const pick = limits
      .filter(l => l.max > 0)
      .sort((a, b) => (b.used / b.max) - (a.used / a.max))
      .slice(0, 4);
    pick.forEach((l, i) => {
      if (i > 0) { limitsEl.appendChild(document.createTextNode(' · ')); }
      const span = document.createElement('span');
      const ratio = l.used / l.max;
      if (ratio >= 1) { span.className = 'lim-over'; }
      else if (ratio >= 0.8) { span.className = 'lim-warn'; }
      const short = l.name.replace(/queries/i, 'q').replace(/statements/i, 'stmts');
      span.textContent = `${short} ${l.used}/${l.max}`;
      limitsEl.appendChild(span);
    });
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
        if (e.key === 'Enter') { e.preventDefault(); title.blur(); }
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
        if (tab.id !== state.activeTabId) { post({ type: 'selectTab', tabId: tab.id }); }
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
    const next = active ? active.code : '';
    // Only touch the textarea when the content actually changed (e.g. tab switch),
    // and preserve the caret/selection if the user is currently typing in it —
    // assigning `.value` otherwise jumps the caret to the end.
    if (codeEl.value === next) { return; }
    const focused = document.activeElement === codeEl;
    const selStart = codeEl.selectionStart;
    const selEnd = codeEl.selectionEnd;
    suppressCodeEvent = true;
    codeEl.value = next;
    suppressCodeEvent = false;
    highlightApex();
    if (focused) {
      try { codeEl.setSelectionRange(selStart, selEnd); } catch (_e) { /* ignore */ }
    }
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
    if (result.exceptionMessage) { parts.push(`Exception: ${result.exceptionMessage}`); }
    if (result.exceptionStackTrace) { parts.push(`Stack:\n${result.exceptionStackTrace}`); }
    if (parts.length > 0) {
      outputBody.textContent = parts.join('\n\n');
      outputBody.classList.remove('hidden');
    } else {
      outputBody.textContent = '';
      outputBody.classList.add('hidden');
    }
    // Move the caret to the offending line on a compile error.
    if (!result.compiled && result.line > 0) {
      focusErrorLocation(result.line, result.column);
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

      const meta = document.createElement('div');
      meta.className = 'log-entry-meta';

      const type = document.createElement('span');
      type.className = 'log-type';
      type.textContent = entry.eventType;
      meta.appendChild(type);

      if (entry.lineRef) {
        const line = document.createElement('span');
        line.className = 'log-line';
        line.textContent = entry.lineRef;
        meta.appendChild(line);
      }

      const time = document.createElement('span');
      time.className = 'log-time';
      time.textContent = entry.timestamp;
      meta.appendChild(time);

      row.appendChild(meta);

      if (entry.message) {
        const msg = document.createElement('div');
        msg.className = 'log-msg';
        msg.textContent = entry.message;
        row.appendChild(msg);
      }

      logBody.appendChild(row);
    }
    logBody.scrollTop = logBody.scrollHeight;
  }

  function renderCmdLog() {
    cmdCount.textContent = cmdHistory.length;
    cmdLogBody.innerHTML = '';
    for (const entry of cmdHistory) {
      const el = document.createElement('div');
      el.className = 'cmd-entry';

      const meta = document.createElement('div');
      meta.className = 'cmd-entry-meta';

      const status = document.createElement('span');
      status.className = entry.success ? 'cmd-ok' : 'cmd-err';
      status.textContent = entry.success ? '✓' : '✗';

      const time = document.createElement('span');
      time.className = 'cmd-time';
      time.textContent = entry.timestamp;

      const dur = document.createElement('span');
      dur.className = 'cmd-duration';
      dur.textContent = entry.durationMs + 'ms';

      meta.appendChild(status);
      meta.appendChild(time);
      meta.appendChild(dur);

      const cmd = document.createElement('div');
      cmd.className = 'cmd-line';
      cmd.textContent = entry.command;

      el.appendChild(meta);
      el.appendChild(cmd);
      cmdLogBody.appendChild(el);
    }
    if (cmdLogOpen) { cmdLogBody.scrollTop = cmdLogBody.scrollHeight; }
  }

  orgSelect.addEventListener('change', () => {
    if (orgSelect.value) { post({ type: 'selectOrg', username: orgSelect.value }); }
  });
  refreshBtn.addEventListener('click', () => post({ type: 'refreshOrgs' }));
  runBtn.addEventListener('click', () => {
    if (isRunning) { post({ type: 'cancel' }); }
    else { post({ type: 'execute' }); }
  });
  if (copyLogBtn) {
    copyLogBtn.addEventListener('click', () => {
      if (lastRawLog) { post({ type: 'copy', text: lastRawLog }); }
    });
  }

  codeEl.addEventListener('input', () => {
    highlightApex();
    if (suppressCodeEvent || !state.activeTabId) { return; }
    post({ type: 'updateCode', tabId: state.activeTabId, code: codeEl.value });
  });

  // Keep the highlight overlay scrolled in lockstep with the textarea.
  codeEl.addEventListener('scroll', () => {
    if (!overlayEl) { return; }
    overlayEl.scrollTop = codeEl.scrollTop;
    overlayEl.scrollLeft = codeEl.scrollLeft;
  });

  codeEl.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      post({ type: 'execute' });
      return;
    }
    // Trap Tab so it indents instead of moving focus out of the editor.
    if (e.key === 'Tab') {
      e.preventDefault();
      insertIndent(e.shiftKey);
    }
  });

  function insertIndent(dedent) {
    const indent = '  ';
    const start = codeEl.selectionStart;
    const end = codeEl.selectionEnd;
    const value = codeEl.value;
    if (dedent) {
      // Remove up to two leading whitespace chars before the caret on this line.
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      const lead = value.slice(lineStart, start);
      const remove = lead.endsWith('  ') ? 2 : (lead.endsWith(' ') || lead.endsWith('\t')) ? 1 : 0;
      if (remove === 0) { return; }
      codeEl.value = value.slice(0, start - remove) + value.slice(start);
      codeEl.selectionStart = codeEl.selectionEnd = start - remove;
    } else {
      codeEl.value = value.slice(0, start) + indent + value.slice(end);
      codeEl.selectionStart = codeEl.selectionEnd = start + indent.length;
    }
    highlightApex();
    if (state.activeTabId) { post({ type: 'updateCode', tabId: state.activeTabId, code: codeEl.value }); }
  }

  function focusErrorLocation(line, column) {
    if (!line || line < 1) { return; }
    const lines = codeEl.value.split('\n');
    let offset = 0;
    for (let i = 0; i < line - 1 && i < lines.length; i++) { offset += lines[i].length + 1; }
    offset += Math.max(0, (column || 1) - 1);
    offset = Math.min(offset, codeEl.value.length);
    codeEl.focus();
    try { codeEl.setSelectionRange(offset, offset); } catch (_e) { /* ignore */ }
  }

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
        selectedKind = msg.selectedKind || 'other';
        renderOrgs();
        break;
      case 'execStart':
        setStatus('Running...', 'status-warn');
        outputBody.textContent = '';
        outputBody.classList.add('hidden');
        limitsEl.innerHTML = '';
        currentLogEntries = [];
        renderLogEntries();
        setRunning(true);
        break;
      case 'execResult':
        setRunning(false);
        renderExecResult(msg.result);
        lastRawLog = (msg.result && msg.result.logs) || '';
        currentLogEntries = msg.logEntries || [];
        renderLogEntries();
        renderLimits(msg.limits);
        break;
      case 'execError':
        setRunning(false);
        setStatus('Error', 'status-err');
        outputBody.textContent = msg.message;
        outputBody.classList.remove('hidden');
        break;
      case 'execCancelled':
        setRunning(false);
        setStatus('Cancelled', 'status-warn');
        break;
      case 'cmdLog':
        cmdHistory.push(msg.entry);
        renderCmdLog();
        break;
    }
  });

  post({ type: 'ready' });
})();
