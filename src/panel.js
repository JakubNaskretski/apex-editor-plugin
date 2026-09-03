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
  const completionEl = document.getElementById('completion');
  const mirrorEl = document.getElementById('code-mirror');

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
  let selectedKind = 'unknown';
  let suppressCodeEvent = false;
  let isRunning = false;
  // The id of the tab the textarea currently reflects. Used to tell a real tab
  // switch (load the new code) from a same-tab state refresh (textarea is the
  // source of truth for in-progress edits — never overwrite it).
  let renderedTabId = null;
  // Until the first `state` arrives we don't know which tab is active, so edits
  // would be dropped and then clobbered. Keep the editor read-only until then.
  let stateLoaded = false;
  codeEl.readOnly = true;
  // Snippet suggestions sent by the extension, and the popup's live state.
  let snippets = [];
  let completionOpen = false;
  let completionItems = [];
  let completionIndex = 0;
  let currentTokenRange = null; // {start, end} of the word being completed
  const MIN_TOKEN = 2;          // chars before the popup appears
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
    let matched = false;
    for (const org of orgs.orgs) {
      const opt = document.createElement('option');
      opt.value = org.username;
      const badge = org.kind === 'prod' ? ' [PROD]'
        : org.kind === 'sandbox' ? ' [SBX]'
        : org.kind === 'scratch' ? ' [SCR]' : '';
      opt.textContent = org.label + badge;
      if (org.username === orgs.selected) { opt.selected = true; matched = true; }
      orgSelect.appendChild(opt);
    }
    // No option matched the selected org — it was cleared (selected == null),
    // so show an explicit none-state instead of letting the <select> silently
    // display the first org as if it were the target (the status bar shows "No
    // Org"; the dropdown must agree). A missing-but-named org doesn't reach here:
    // the extension appends a stand-in option for it.
    if (!matched) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = orgs.selected ? orgs.selected : 'Select an org…';
      opt.disabled = true;
      orgSelect.insertBefore(opt, orgSelect.firstChild);
      opt.selected = true;
    }
    applyRunButtonKind();
  }

  // Tint the Run button when the selected org is production, as a standing warning.
  function applyRunButtonKind() {
    if (isRunning) {
      runBtn.classList.remove('danger');
      return;
    }
    // Tint the Run button when the target is production OR unclassified (unknown
    // ⇒ treated as prod by the guard), so the standing warning matches the modal.
    const isProd = selectedKind === 'prod' || selectedKind === 'unknown';
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
    // Only load code into the textarea on a genuine tab switch (or the very first
    // render). For a state refresh of the SAME tab — a rename, a sibling tab
    // closing, the initial state landing while the user is mid-paste — the
    // textarea holds the user's live edits and is the source of truth, so leave
    // it untouched. This is what stops a late `state` message from eating text
    // the user just typed.
    const tabChanged = state.activeTabId !== renderedTabId;
    renderedTabId = state.activeTabId;
    if (!tabChanged) { return; }
    const active = state.tabs.find(t => t.id === state.activeTabId);
    const next = active ? active.code : '';
    // Preserve the caret/selection if the user is currently typing in it —
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

  function renderExecResult(result, org) {
    // Attribute the outcome to the org it ran against — captured when the run
    // started, so a switch made mid-run doesn't mislabel the result under the new
    // org now showing in the dropdown/status bar.
    const on = org ? ` · ${org}` : '';
    if (!result.compiled) {
      setStatus(`Compile error at line ${result.line}: ${result.compileProblem}${on}`, 'status-err');
    } else if (!result.success) {
      setStatus(`Failed: ${result.exceptionMessage || 'unknown error'}${on}`, 'status-err');
    } else {
      setStatus(`Success${on}`, 'status-ok');
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

      // One flowing row: TYPE [line] message……                      time
      // The message takes the remaining width and wraps inside its own column,
      // so the category label sits on the SAME line as the text instead of on a
      // line above it.
      const type = document.createElement('span');
      type.className = 'log-type';
      type.textContent = entry.eventType;
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

      const time = document.createElement('span');
      time.className = 'log-time';
      time.textContent = entry.timestamp;
      row.appendChild(time);

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
    updateCompletion();
  });

  // Keep the highlight overlay scrolled in lockstep with the textarea.
  codeEl.addEventListener('scroll', () => {
    if (overlayEl) {
      overlayEl.scrollTop = codeEl.scrollTop;
      overlayEl.scrollLeft = codeEl.scrollLeft;
    }
    if (completionOpen) { positionCompletion(); }
  });

  // Dismiss the suggestion popup when focus leaves the editor.
  codeEl.addEventListener('blur', () => closeCompletion());

  codeEl.addEventListener('keydown', e => {
    // While the suggestion popup is open it owns the navigation/accept keys.
    if (completionOpen) {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveCompletion(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); moveCompletion(-1); return; }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.ctrlKey && !e.metaKey)) { e.preventDefault(); acceptCompletion(completionIndex); return; }
      if (e.key === 'Escape') { e.preventDefault(); closeCompletion(); return; }
      // Moving the caret away or running (Ctrl/Cmd+Enter) just dismisses it and
      // falls through to the normal handlers below.
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') { closeCompletion(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { closeCompletion(); }
    }
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

  // Replace a [start,end) range of the textarea with `text`, preferring
  // document.execCommand('insertText') so the browser's native undo stack is
  // preserved (a direct `.value =` write wipes it). Falls back to
  // a `.value` splice if execCommand is unavailable or refused.
  function replaceRange(start, end, text) {
    codeEl.focus();
    codeEl.setSelectionRange(start, end);
    // Suppress our own `input` handler for the duration of the edit: execCommand
    // fires a native input event, and we already post updateCode explicitly below
    // (double-posting is harmless but re-triggering the completion popup on an
    // indent/accept is not). The native undo stack is still recorded by
    // execCommand regardless of this flag.
    suppressCodeEvent = true;
    let ok = false;
    try {
      ok = document.execCommand('insertText', false, text);
    } catch (_e) { ok = false; }
    if (!ok) {
      const v = codeEl.value;
      codeEl.value = v.slice(0, start) + text + v.slice(end);
      const caret = start + text.length;
      try { codeEl.setSelectionRange(caret, caret); } catch (_e) { /* ignore */ }
    }
    suppressCodeEvent = false;
    highlightApex();
    if (state.activeTabId) { post({ type: 'updateCode', tabId: state.activeTabId, code: codeEl.value }); }
  }

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
      replaceRange(start - remove, start, '');
    } else {
      replaceRange(start, end, indent);
    }
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

  // ── Snippet suggestion popup ──────────────────────────────────────────────
  // A lightweight completion list over the textarea. It matches the word before
  // the caret against the dictionary the extension sent and inserts on Tab/Enter.
  // Bodies use VS Code snippet syntax ($0 final caret, $1/${1:placeholder} stops);
  // we place the caret at the first stop rather than offering multi-stop tabbing.

  // The word immediately before the caret (letters/digits/_), or null.
  function currentToken() {
    const pos = codeEl.selectionStart;
    if (pos !== codeEl.selectionEnd) { return null; } // no popup while selecting
    const m = /[A-Za-z_][A-Za-z0-9_]*$/.exec(codeEl.value.slice(0, pos));
    if (!m) { return null; }
    return { text: m[0], start: pos - m[0].length, end: pos };
  }

  // Match if the prefix OR the label starts with the typed token (so "sd" and
  // "system" both surface System.debug). Prefix matches rank above label-only.
  function matchSnippets(token) {
    const t = token.toLowerCase();
    return snippets
      .map(s => {
        const p = (s.prefix || '').toLowerCase();
        const l = (s.label || s.prefix || '').toLowerCase();
        const rank = p.startsWith(t) ? 0 : l.startsWith(t) ? 1 : -1;
        return { s: s, rank: rank };
      })
      .filter(x => x.rank >= 0)
      .sort((a, b) => a.rank - b.rank || (a.s.label || a.s.prefix).length - (b.s.label || b.s.prefix).length)
      .slice(0, 8)
      .map(x => x.s);
  }

  function updateCompletion() {
    const tok = currentToken();
    if (!tok || tok.text.length < MIN_TOKEN) { closeCompletion(); return; }
    const items = matchSnippets(tok.text);
    if (items.length === 0) { closeCompletion(); return; }
    currentTokenRange = { start: tok.start, end: tok.end };
    completionItems = items;
    completionIndex = 0;
    completionOpen = true;
    renderCompletion();
    completionEl.classList.remove('hidden');
    positionCompletion();
  }

  function closeCompletion() {
    if (!completionOpen) { return; }
    completionOpen = false;
    completionItems = [];
    currentTokenRange = null;
    completionEl.classList.add('hidden');
  }

  function moveCompletion(delta) {
    if (!completionOpen) { return; }
    const n = completionItems.length;
    completionIndex = (completionIndex + delta + n) % n;
    renderCompletion();
    const sel = completionEl.querySelector('.completion-item.selected');
    if (sel) { sel.scrollIntoView({ block: 'nearest' }); }
  }

  function renderCompletion() {
    completionEl.innerHTML = '';
    completionItems.forEach((item, i) => {
      const row = document.createElement('div');
      row.className = 'completion-item' + (i === completionIndex ? ' selected' : '');
      const label = document.createElement('span');
      label.className = 'completion-label';
      label.textContent = item.label || item.prefix;
      row.appendChild(label);
      if (item.description) {
        const desc = document.createElement('span');
        desc.className = 'completion-desc';
        desc.textContent = item.description;
        row.appendChild(desc);
      }
      // mousedown (not click) so we insert before the textarea loses focus.
      row.addEventListener('mousedown', e => { e.preventDefault(); acceptCompletion(i); });
      completionEl.appendChild(row);
    });
  }

  function acceptCompletion(index) {
    const item = completionItems[index];
    const range = currentTokenRange;
    if (!item || !range) { closeCompletion(); return; }
    const expanded = expandSnippet(item.body != null ? item.body : (item.label || item.prefix));
    // Replace the typed token with the expanded snippet through the native undo
    // path (replaceRange uses execCommand('insertText')), then place the caret at
    // the snippet's tab-stop.
    replaceRange(range.start, range.end, expanded.text);
    const caretPos = range.start + expanded.caret;
    try { codeEl.setSelectionRange(caretPos, caretPos); } catch (_e) { /* ignore */ }
    closeCompletion();
  }

  // Substitute ${n:placeholder} → its text, drop $n / ${n} / $0 markers, and
  // report where the caret should land: the first positive tab stop, else $0,
  // else the end of the inserted text.
  function expandSnippet(body) {
    let out = '';
    let i = 0;
    const stops = [];
    while (i < body.length) {
      if (body[i] === '\\' && body[i + 1] === '$') { out += '$'; i += 2; continue; }
      if (body[i] === '$') {
        const rest = body.slice(i);
        let m;
        if ((m = /^\$\{(\d+):([^}]*)\}/.exec(rest))) { stops.push({ order: +m[1], pos: out.length }); out += m[2]; i += m[0].length; continue; }
        if ((m = /^\$\{(\d+)\}/.exec(rest))) { stops.push({ order: +m[1], pos: out.length }); i += m[0].length; continue; }
        if ((m = /^\$(\d+)/.exec(rest))) { stops.push({ order: +m[1], pos: out.length }); i += m[0].length; continue; }
      }
      out += body[i];
      i++;
    }
    const positive = stops.filter(s => s.order > 0).sort((a, b) => a.order - b.order)[0];
    const zero = stops.find(s => s.order === 0);
    const anchor = positive || zero;
    return { text: out, caret: anchor ? anchor.pos : out.length };
  }

  function positionCompletion() {
    if (!completionOpen) { return; }
    const coords = caretCoords(); // viewport coordinates of the caret
    const margin = 4;
    const popupH = completionEl.offsetHeight;
    const popupW = completionEl.offsetWidth;
    let top = coords.top + coords.lineHeight; // below the caret line by default
    if (top + popupH > window.innerHeight - margin && coords.top - popupH > margin) {
      top = coords.top - popupH; // flip above when it would overflow the bottom
    }
    let left = coords.left;
    if (left + popupW > window.innerWidth - margin) {
      left = window.innerWidth - popupW - margin; // keep it on screen horizontally
    }
    completionEl.style.top = Math.max(margin, top) + 'px';
    completionEl.style.left = Math.max(margin, left) + 'px';
  }

  // Measure the caret's viewport position via a hidden twin of the textarea:
  // copy the text up to the caret, append a marker, read where it lands, then
  // offset by the textarea's own position on screen. The mirror shares the
  // textarea's font/padding/wrapping, so the marker tracks the real caret.
  function caretCoords() {
    const lineHeight = parseFloat(getComputedStyle(codeEl).lineHeight) || 18;
    const rect = codeEl.getBoundingClientRect();
    if (!mirrorEl) { return { top: rect.top, left: rect.left, lineHeight: lineHeight }; }
    mirrorEl.textContent = codeEl.value.slice(0, codeEl.selectionStart);
    const marker = document.createElement('span');
    marker.textContent = '\u200b'; // zero-width space
    mirrorEl.appendChild(marker);
    const top = rect.top + marker.offsetTop - codeEl.scrollTop;
    const left = rect.left + marker.offsetLeft - codeEl.scrollLeft;
    mirrorEl.removeChild(marker);
    return { top: top, left: left, lineHeight: lineHeight };
  }

  window.addEventListener('message', event => {
    const msg = event.data;
    switch (msg.type) {
      case 'state':
        state = { tabs: msg.tabs, activeTabId: msg.activeTabId };
        renderTabs();
        renderActiveCode();
        if (!stateLoaded) {
          stateLoaded = true;
          codeEl.readOnly = false; // tabs are known now — safe to accept edits
        }
        break;
      case 'snippets':
        snippets = Array.isArray(msg.items) ? msg.items : [];
        break;
      case 'orgs':
        orgs = { orgs: msg.orgs, selected: msg.selected };
        selectedKind = msg.selectedKind || 'unknown';
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
        renderExecResult(msg.result, msg.org);
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
