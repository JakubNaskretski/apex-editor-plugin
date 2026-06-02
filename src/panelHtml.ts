import * as vscode from 'vscode';
import { randomBytes } from 'crypto';

export function getPanelHtml(webview: vscode.Webview, extensionUri: vscode.Uri, nonce: string, location: 'sidebar' | 'panel' = 'sidebar'): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'panel.js'));
  const csp = [
    `default-src 'none'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
    `font-src ${webview.cspSource}`,
    `img-src ${webview.cspSource} data:`
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <title>Apex Editor</title>
  <style>
    :root { color-scheme: light dark; }
    body {
      margin: 0;
      padding: 0;
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      display: flex;
      flex-direction: column;
      height: 100vh;
    }
    .toolbar {
      display: flex;
      gap: 6px;
      padding: 6px 8px;
      border-bottom: 1px solid var(--vscode-panel-border);
      align-items: center;
      flex-wrap: wrap;
    }
    .toolbar select, .toolbar button {
      background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
      color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
      border: 1px solid var(--vscode-button-border, transparent);
      padding: 4px 8px;
      font-size: 12px;
      cursor: pointer;
    }
    .toolbar button.primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .toolbar button:disabled { opacity: 0.5; cursor: not-allowed; }
    .toolbar select { min-width: 140px; flex: 1; }
    .tabs {
      display: flex;
      overflow-x: auto;
      background: var(--vscode-tab-inactiveBackground);
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .tab {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 8px;
      font-size: 12px;
      border-right: 1px solid var(--vscode-panel-border);
      background: var(--vscode-tab-inactiveBackground);
      color: var(--vscode-tab-inactiveForeground);
      cursor: pointer;
      user-select: none;
      white-space: nowrap;
    }
    .tab.active {
      background: var(--vscode-tab-activeBackground);
      color: var(--vscode-tab-activeForeground);
    }
    .tab .close {
      opacity: 0.6;
      padding: 0 2px;
      border-radius: 2px;
    }
    .tab .close:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground); }
    .tab .title { outline: none; }
    .tab .title[contenteditable="true"] {
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      padding: 0 2px;
    }
    .new-tab {
      padding: 4px 10px;
      cursor: pointer;
      font-size: 14px;
      color: var(--vscode-foreground);
    }
    /* Editor: a transparent textarea on top of a highlighted overlay (same
       technique as the SOQL editor) so the caret stays in the textarea while the
       overlay shows syntax colors. Both MUST share font / padding / line-height /
       wrapping for the text to line up. */
    .editor {
      flex: 1 1 0;
      position: relative;
      min-height: 100px;
      overflow: hidden;
    }
    #code-overlay,
    #code-mirror,
    .editor textarea {
      position: absolute;
      inset: 0;
      margin: 0;
      box-sizing: border-box;
      padding: 8px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: var(--vscode-editor-font-size, 13px);
      line-height: 1.4;
      tab-size: 4;
      white-space: pre-wrap;
      word-wrap: break-word;
      overflow: auto;
    }
    #code-overlay {
      pointer-events: none;
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      z-index: 0;
    }
    .editor textarea {
      border: 0;
      outline: none;
      resize: none;
      background: transparent;
      color: transparent;
      caret-color: var(--vscode-editor-foreground);
      z-index: 1;
    }
    /* Hidden twin of the textarea, used only to measure the caret's pixel
       position for the suggestion popup (textareas don't expose that directly).
       It shares the textarea's exact metrics via the selector list above, so a
       marker placed at the caret offset lands in the right spot. Never shown. */
    #code-mirror {
      visibility: hidden;
      pointer-events: none;
      overflow: hidden;
      z-index: 0;
    }
    /* Suggestion popup (snippet completions). Positioned at the caret from JS.
       Uses position:fixed so the editor's overflow:hidden can't clip it. */
    .completion {
      position: fixed;
      z-index: 5;
      min-width: 160px;
      max-width: 340px;
      max-height: 180px;
      overflow-y: auto;
      background: var(--vscode-editorSuggestWidget-background, var(--vscode-editorWidget-background, #252526));
      border: 1px solid var(--vscode-editorSuggestWidget-border, var(--vscode-widget-border, #454545));
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.36);
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
    }
    .completion.hidden { display: none; }
    .completion-item {
      display: flex;
      align-items: baseline;
      gap: 10px;
      padding: 2px 8px;
      cursor: pointer;
      white-space: nowrap;
    }
    .completion-item.selected {
      background: var(--vscode-editorSuggestWidget-selectedBackground, var(--vscode-list-activeSelectionBackground, #04395e));
      color: var(--vscode-editorSuggestWidget-selectedForeground, var(--vscode-list-activeSelectionForeground, #ffffff));
    }
    .completion-label { color: var(--vscode-editorSuggestWidget-foreground, var(--vscode-foreground)); }
    .completion-item.selected .completion-label { color: inherit; }
    .completion-desc {
      margin-left: auto;
      opacity: 0.7;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
    }
    .completion-item.selected .completion-desc { color: inherit; }
    /* syntax token colors (VS Code Dark+ palette) */
    .tok-keyword { color: #569cd6; font-weight: 600; }
    .tok-type { color: #4ec9b0; }
    .tok-annotation { color: #dcdcaa; }
    .tok-string { color: #ce9178; }
    .tok-number { color: #b5cea8; }
    .tok-comment { color: #6a9955; font-style: italic; }
    .output {
      flex: 0 0 auto;
      border-top: 1px solid var(--vscode-panel-border);
      display: flex;
      flex-direction: column;
      max-height: 35%;
      overflow: hidden;
    }
    .output-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 8px;
      background: var(--vscode-panel-background);
      border-bottom: 1px solid var(--vscode-panel-border);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      flex-shrink: 0;
    }
    .output-body {
      overflow: auto;
      padding: 8px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .output-body.hidden { display: none; }
    .status-ok { color: var(--vscode-testing-iconPassed, #2ea043); }
    .status-err { color: var(--vscode-testing-iconFailed, #f85149); }
    .status-warn { color: var(--vscode-editorWarning-foreground, #d29922); }
    .empty { opacity: 0.6; font-style: italic; }
    .limits {
      margin-left: auto;
      font-size: 11px;
      text-transform: none;
      letter-spacing: normal;
      color: var(--vscode-descriptionForeground);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .limits .lim-warn { color: var(--vscode-editorWarning-foreground, #d29922); }
    .limits .lim-over { color: var(--vscode-testing-iconFailed, #f85149); }
    button.ghost {
      margin-left: auto;
      background: transparent;
      border: 1px solid var(--vscode-panel-border);
      color: var(--vscode-foreground);
      font-size: 11px;
      padding: 1px 7px;
      cursor: pointer;
      border-radius: 3px;
    }
    button.ghost:hover { background: var(--vscode-list-hoverBackground); }
    #run-btn.danger {
      background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
      color: #fff;
      border-color: var(--vscode-inputValidation-errorBorder, #be1100);
    }
    .log-viewer {
      flex: 1 1 0;
      border-top: 1px solid var(--vscode-panel-border);
      display: flex;
      flex-direction: column;
      min-height: 80px;
      overflow: hidden;
    }
    .log-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 4px 8px;
      background: var(--vscode-panel-background);
      border-bottom: 1px solid var(--vscode-panel-border);
      font-size: 11px;
      flex-shrink: 0;
      flex-wrap: wrap;
    }
    .log-title {
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-right: 4px;
    }
    .log-filter {
      display: flex;
      align-items: center;
      gap: 3px;
      cursor: pointer;
      user-select: none;
    }
    .log-filter input[type="checkbox"] { cursor: pointer; margin: 0; }
    .log-body {
      flex: 1;
      overflow: auto;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
      padding: 4px 0;
    }
    .log-entry {
      display: flex;
      align-items: baseline;
      gap: 6px;
      padding: 2px 8px;
      line-height: 1.4;
    }
    .log-entry:hover { background: var(--vscode-list-hoverBackground); }
    .log-time {
      color: var(--vscode-descriptionForeground);
      font-size: 10px;
      margin-left: auto;
      flex-shrink: 0;
    }
    .log-type {
      font-weight: 600;
      font-size: 11px;
      flex-shrink: 0;
      white-space: nowrap;
    }
    .log-line {
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      flex-shrink: 0;
    }
    /* Message fills the rest of the row and wraps within its own column, so a
       long debug line breaks onto multiple visual lines without pushing the
       category label onto a line of its own. min-width:0 lets it actually shrink
       inside the flex row instead of overflowing. */
    .log-msg {
      flex: 1 1 0;
      min-width: 0;
      word-break: break-word;
      white-space: pre-wrap;
      color: var(--vscode-foreground);
    }
    .log-cat-USER_DEBUG .log-type { color: var(--vscode-debugConsole-infoForeground, #3794ff); }
    .log-cat-SOQL .log-type { color: var(--vscode-editorWarning-foreground, #d29922); }
    .log-cat-DML .log-type { color: var(--vscode-charts-purple, #9d4edd); }
    .log-cat-EXCEPTION .log-type { color: var(--vscode-testing-iconFailed, #f85149); }
    .log-cat-SYSTEM .log-type { color: var(--vscode-descriptionForeground, #8b8b8b); }
    body[data-location="panel"] .toolbar {
      border-top: 2px solid var(--vscode-focusBorder, #007acc);
    }
    body[data-location="panel"] #run-btn {
      background: var(--vscode-focusBorder, #007acc);
      color: #fff;
    }
    /* Command log */
    .cmd-log {
      border-top: 1px solid var(--vscode-panel-border);
      flex-shrink: 0;
    }
    .cmd-log-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 8px;
      background: var(--vscode-panel-background);
      cursor: pointer;
      font-size: 11px;
      user-select: none;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .cmd-log-header:hover { background: var(--vscode-list-hoverBackground); }
    .cmd-chevron { font-style: normal; font-size: 9px; }
    .cmd-count {
      background: var(--vscode-badge-background, #4d4d4d);
      color: var(--vscode-badge-foreground, #fff);
      border-radius: 10px;
      padding: 0 5px;
      font-size: 10px;
      min-width: 16px;
      text-align: center;
    }
    .cmd-log-body {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 11px;
      max-height: 140px;
      overflow: auto;
    }
    .cmd-log-body.hidden { display: none; }
    .cmd-entry {
      padding: 3px 8px 4px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .cmd-entry:last-child { border-bottom: none; }
    .cmd-entry-meta {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .cmd-ok { color: var(--vscode-testing-iconPassed, #2ea043); }
    .cmd-err { color: var(--vscode-testing-iconFailed, #f85149); }
    .cmd-time { color: var(--vscode-descriptionForeground); font-size: 10px; }
    .cmd-duration { color: var(--vscode-descriptionForeground); font-size: 10px; margin-left: auto; }
    .cmd-line {
      margin-top: 2px;
      color: var(--vscode-foreground);
      word-break: break-all;
    }
  </style>
</head>
<body data-location="${location}">
  <div class="toolbar">
    <select id="org-select" title="Selected org"></select>
    <button id="refresh-orgs" title="Refresh org list">&#x21bb;</button>
    <button id="run-btn" class="primary" title="Execute active script">&#x25b6; Run</button>
  </div>
  <div class="tabs" id="tabs"></div>
  <div class="editor">
    <pre id="code-overlay" aria-hidden="true"></pre>
    <div id="code-mirror" aria-hidden="true"></div>
    <textarea id="code" spellcheck="false" placeholder="// Anonymous Apex&#10;System.debug('Hello from Apex Editor');"></textarea>
    <div id="completion" class="completion hidden"></div>
  </div>
  <div class="output">
    <div class="output-header">
      <span id="output-status" class="empty">No execution yet</span>
      <span id="limits" class="limits"></span>
    </div>
    <div class="output-body hidden" id="output-body"></div>
  </div>
  <div class="log-viewer">
    <div class="log-header">
      <span class="log-title">Log</span>
      <label class="log-filter"><input type="checkbox" data-cat="USER_DEBUG" checked> USER_DEBUG</label>
      <label class="log-filter"><input type="checkbox" data-cat="SOQL" checked> SOQL</label>
      <label class="log-filter"><input type="checkbox" data-cat="DML" checked> DML</label>
      <label class="log-filter"><input type="checkbox" data-cat="EXCEPTION" checked> EXCEPTION</label>
      <label class="log-filter"><input type="checkbox" data-cat="SYSTEM"> SYSTEM</label>
      <button id="copy-log-btn" class="ghost" title="Copy the full debug log">&#x2398; Copy</button>
    </div>
    <div class="log-body" id="log-body">
      <span class="empty" style="padding: 8px; display: block;">No execution yet</span>
    </div>
  </div>
  <div class="cmd-log">
    <div class="cmd-log-header" id="cmd-log-toggle">
      <span class="cmd-chevron" id="cmd-chevron">&#x25b6;</span>
      <span>Commands</span>
      <span class="cmd-count" id="cmd-count">0</span>
    </div>
    <div class="cmd-log-body hidden" id="cmd-log-body"></div>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

export function generateNonce(): string {
  // CSPRNG (not Math.random) so the CSP script nonce isn't predictable.
  return randomBytes(16).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 32);
}
