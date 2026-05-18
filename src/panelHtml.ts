import * as vscode from 'vscode';

export function getPanelHtml(webview: vscode.Webview, extensionUri: vscode.Uri, nonce: string): string {
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
    .editor {
      flex: 1 1 60%;
      display: flex;
      min-height: 120px;
    }
    .editor textarea {
      flex: 1;
      width: 100%;
      height: 100%;
      box-sizing: border-box;
      padding: 8px;
      border: 0;
      outline: none;
      resize: none;
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: var(--vscode-editor-font-size, 13px);
      line-height: 1.4;
      tab-size: 4;
    }
    .output {
      flex: 1 1 40%;
      border-top: 1px solid var(--vscode-panel-border);
      display: flex;
      flex-direction: column;
      min-height: 80px;
      max-height: 50%;
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
    }
    .output-body {
      flex: 1;
      overflow: auto;
      padding: 8px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .status-ok { color: var(--vscode-testing-iconPassed, #2ea043); }
    .status-err { color: var(--vscode-testing-iconFailed, #f85149); }
    .status-warn { color: var(--vscode-editorWarning-foreground, #d29922); }
    .empty { opacity: 0.6; font-style: italic; }
  </style>
</head>
<body>
  <div class="toolbar">
    <select id="org-select" title="Selected org"></select>
    <button id="refresh-orgs" title="Refresh org list">&#x21bb;</button>
    <button id="run-btn" class="primary" title="Execute active script">&#x25b6; Run</button>
  </div>
  <div class="tabs" id="tabs"></div>
  <div class="editor">
    <textarea id="code" spellcheck="false" placeholder="// Anonymous Apex&#10;System.debug('Hello from Apex Editor');"></textarea>
  </div>
  <div class="output">
    <div class="output-header">
      <span id="output-status" class="empty">No execution yet</span>
    </div>
    <div class="output-body" id="output-body"></div>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

export function generateNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
