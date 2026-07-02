import * as vscode from 'vscode';
import { OrgStore } from './orgStore';
import { TabManager } from './tabManager';
import { ApexExecuteResult, OrgInfo, OrgKind, SfCliCancelledError, SfCliError, SfCliService } from './sfCliService';
import { generateNonce, getPanelHtml } from './panelHtml';
import { parseLogs, parseLimitUsage } from './logParser';
import { TraceService } from './traceService';
import { mergeSnippets } from './snippets';
import { validateMessage } from './kit/webviewHtml';
import { pickOrg as kitPickOrg } from './kit/orgs';

type InboundMessage =
  | { type: 'ready' }
  | { type: 'updateCode'; tabId: string; code: string }
  | { type: 'newTab' }
  | { type: 'closeTab'; tabId: string }
  | { type: 'selectTab'; tabId: string }
  | { type: 'renameTab'; tabId: string; title: string }
  | { type: 'selectOrg'; username: string }
  | { type: 'refreshOrgs' }
  | { type: 'execute' }
  | { type: 'cancel' }
  | { type: 'copy'; text: string };

interface OrgsPayload {
  orgs: Array<{ username: string; alias?: string; label: string; kind: OrgKind }>;
  selected: string | null;
  selectedKind: OrgKind;
}

export class ApexPanelProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'apexEditor.panel';
  static readonly viewTypePanel = 'apexEditor.panelView';
  private view?: vscode.WebviewView;
  private orgs: OrgInfo[] = [];
  private orgsLoaded = false;
  private readonly traceService: TraceService;
  private running = false;
  private currentAbort?: AbortController;

  /** Fires with the currently-selected OrgInfo (or undefined) whenever the org
   *  set or selection changes, so a status-bar indicator can track it. */
  private readonly orgChangedEmitter = new vscode.EventEmitter<OrgInfo | undefined>();
  readonly onOrgChanged = this.orgChangedEmitter.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly tabs: TabManager,
    private readonly orgStore: OrgStore,
    private readonly sf: SfCliService,
    private readonly output: vscode.OutputChannel,
    private readonly location: 'sidebar' | 'panel' = 'sidebar'
  ) {
    this.tabs.onDidChange(() => this.postState());
    this.traceService = new TraceService(sf);
    // Re-send the snippet dictionary to the webview whenever the user edits it.
    context.subscriptions.push(
      this.orgChangedEmitter,
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('apexEditor.customSnippets')) {
          this.postSnippets();
        }
      })
    );
  }

  /** The OrgInfo for the currently-selected org, or undefined if unknown/unset.
   *  Used to seed a status-bar indicator on activation. */
  selectedOrgInfo(): OrgInfo | undefined {
    const selected = this.orgStore.get();
    return selected ? this.orgs.find(o => o.username === selected) : undefined;
  }

  /** Reload the org list, honouring an externally-changed shared org setting, and
   *  refresh the webview + status bar. Call when another plugin switches the org. */
  async refreshForExternalOrgChange(): Promise<void> {
    if (!this.orgsLoaded) {
      await this.loadOrgs();
      return;
    }
    this.postOrgs();
    this.orgChangedEmitter.fire(this.selectedOrgInfo());
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'out')]
    };
    view.webview.html = getPanelHtml(view.webview, this.context.extensionUri, generateNonce(), this.location);

    view.webview.onDidReceiveMessage((message: InboundMessage) => this.handleMessage(message));
    view.onDidDispose(() => { this.view = undefined; });
  }

  /** Execute the active tab against the selected org, with a production guard.
   *  Callable from the panel (execute message) or the command palette — including
   *  BEFORE the panel is ever opened, so it must not assume `this.orgs` is loaded
   *  or that a webview exists to show results. */
  async executeActive(source: 'panel' | 'command' = 'panel'): Promise<void> {
    const active = this.tabs.getActive();
    if (!active) {
      vscode.window.showWarningMessage('Apex Editor: no active Apex tab to execute.');
      return;
    }
    await this.runCode(active.code, source, 'Active tab is empty.');
  }

  /** P1: Execute the current text editor's Apex — the selection if there is one,
   *  otherwise the whole document. Wired to a command gated on `.apex` files /
   *  the apex language so it appears in the editor title bar and palette. */
  async executeEditor(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('Apex Editor: open an Apex file to run.');
      return;
    }
    const sel = editor.selection;
    const code = sel && !sel.isEmpty ? editor.document.getText(sel) : editor.document.getText();
    await this.runCode(code, 'command', 'The Apex file / selection is empty.');
  }

  /** Shared execution entry: busy-reserve, resolve + confirm the org, run. Used by
   *  both the tab runner and the editor-file runner. `emptyMessage` is shown when
   *  `code` is blank. */
  private async runCode(code: string, source: 'panel' | 'command', emptyMessage: string): Promise<void> {
    // Busy reservation: claim `running` synchronously, before the first await
    // (org load / prod-confirm modal). Without this, a second invocation could
    // slip past the guard while the first is parked on the modal, launching two
    // concurrent runs that clobber `currentAbort`.
    if (this.running) {
      vscode.window.showInformationMessage('An Apex execution is already running.');
      return;
    }
    this.running = true;
    let started = false;
    try {
      if (!code.trim()) {
        this.warn(emptyMessage, source);
        return;
      }

      // Load the org list if it hasn't been loaded yet (palette / editor run
      // before the panel opened). This is what closes the silent-skip bug: without
      // it, `this.orgs` is empty, the selected org resolves to `undefined`, and
      // the production guard is silently skipped. With the list loaded — or, if
      // the load fails, still `undefined` ⇒ isLikelyProduction(undefined) === true
      // — an unknown org now triggers the confirmation.
      if (!this.orgsLoaded) {
        await this.loadOrgs();
      }

      const selectedOrg = this.orgStore.get();
      if (!selectedOrg) {
        this.warn('Select a Salesforce org first.', source);
        return;
      }

      // Production safety: anonymous Apex executes immediately and can modify live
      // data, send emails, and make callouts. Confirm before running against prod.
      // An org we couldn't classify (not in the loaded list) is treated as prod.
      const orgInfo = this.orgs.find(o => o.username === selectedOrg);
      const confirmProd = vscode.workspace.getConfiguration('apexEditor').get<boolean>('confirmProductionRun', true);
      if (confirmProd && SfCliService.isLikelyProduction(orgInfo)) {
        const label = orgInfo?.alias ?? selectedOrg;
        const target = orgInfo ? `PRODUCTION (${label})` : `${label} — an unrecognized org (treated as PRODUCTION)`;
        const choice = await vscode.window.showWarningMessage(
          `⚠ Run anonymous Apex against ${target}?`,
          { modal: true, detail: 'This executes immediately and can modify live data, send emails, and make callouts.' },
          'Run on Production'
        );
        if (choice !== 'Run on Production') {
          return;
        }
      }

      started = true;
      await this.runApex(code, selectedOrg, source);
    } finally {
      // runApex owns `running` (it clears it in its own finally once the run
      // completes). For every early-return path that never reached runApex,
      // release the reservation here so the UI doesn't stay stuck "busy".
      if (!started) {
        this.running = false;
      }
    }
  }

  /** Show a warning where the user will see it. When the palette fired this with
   *  the panel closed, a webview post() is a no-op, so use a native notification. */
  private warn(message: string, source: 'panel' | 'command'): void {
    this.output.appendLine(`[exec] ${message}`);
    if (source === 'command' || !this.view) {
      vscode.window.showWarningMessage(`Apex Editor: ${message}`);
    } else {
      vscode.window.showWarningMessage(message);
    }
  }

  async newTab(): Promise<void> {
    this.tabs.createTab();
  }

  async pickOrg(): Promise<void> {
    if (!this.orgsLoaded) {
      await this.loadOrgs();
    }
    if (this.orgs.length === 0) {
      const choice = await vscode.window.showWarningMessage(
        'No authenticated Salesforce orgs found. Run `sf org login web` first.',
        'Refresh'
      );
      if (choice === 'Refresh') {
        await this.loadOrgs(true);
      }
      return;
    }
    // Kit picker: badges each org [PROD]/[SBX]/[SCR] and marks the current +
    // CLI-default org — the family-canonical QuickPick.
    const username = await kitPickOrg(this.orgs, {
      placeHolder: 'Select Salesforce org',
      current: this.orgStore.get()
    });
    if (username) {
      await this.setSelectedOrg(username);
    }
  }

  /** Persist a newly-chosen org and refresh the webview + status bar. Writing
   *  through OrgStore updates the family-shared setting, so every SF plugin
   *  follows the switch. */
  private async setSelectedOrg(username: string): Promise<void> {
    await this.orgStore.set(username);
    this.postOrgs();
    this.orgChangedEmitter.fire(this.selectedOrgInfo());
  }

  private async handleMessage(raw: unknown): Promise<void> {
    // Shape-guard inbound webview messages before trusting their fields (REVIEW
    // §5 LOW: "inbound webview messages shape-unvalidated"). A message that fails
    // its per-type descriptor is dropped.
    if (!validateMessage<{ type: string }>({ type: 'string' }, raw)) { return; }
    const message = raw as InboundMessage;
    switch (message.type) {
      case 'ready':
        // Send tab state FIRST so the editor is wired up immediately. Loading
        // orgs spawns the `sf` CLI and can take seconds; if we awaited it before
        // posting state, the textarea would be live but tab-less for that whole
        // window — anything typed then is dropped and later clobbered when state
        // finally arrives. Post state synchronously, then load orgs.
        this.postState();
        this.postSnippets();
        await this.loadOrgs();
        return;
      case 'updateCode':
        if (!validateMessage({ tabId: 'string', code: 'string' }, message)) { return; }
        this.tabs.updateCode(message.tabId, message.code);
        return;
      case 'newTab':
        this.tabs.createTab();
        return;
      case 'closeTab':
        if (!validateMessage({ tabId: 'string' }, message)) { return; }
        this.tabs.closeTab(message.tabId);
        return;
      case 'selectTab':
        if (!validateMessage({ tabId: 'string' }, message)) { return; }
        this.tabs.setActive(message.tabId);
        return;
      case 'renameTab':
        if (!validateMessage({ tabId: 'string', title: 'string' }, message)) { return; }
        this.tabs.renameTab(message.tabId, message.title);
        return;
      case 'selectOrg':
        if (!validateMessage({ username: 'string' }, message)) { return; }
        await this.setSelectedOrg(message.username);
        return;
      case 'refreshOrgs':
        await this.loadOrgs(true);
        return;
      case 'execute':
        await this.executeActive('panel');
        return;
      case 'cancel':
        this.currentAbort?.abort();
        return;
      case 'copy':
        if (typeof message.text === 'string' && message.text) {
          await vscode.env.clipboard.writeText(message.text);
          vscode.window.showInformationMessage('Apex Editor: copied to clipboard.');
        }
        return;
    }
  }

  private async loadOrgs(notifyOnEmpty = false): Promise<void> {
    try {
      this.orgs = await this.sf.listOrgs();
      this.orgsLoaded = true;
      const current = this.orgStore.get();
      if (current && !this.orgs.some(o => o.username === current)) {
        await this.orgStore.set(undefined);
      } else if (!current) {
        const defaultOrg = this.orgs.find(o => o.isDefaultUsername) ?? this.orgs[0];
        if (defaultOrg) {
          await this.orgStore.set(defaultOrg.username);
        }
      }
      this.postOrgs();
      this.orgChangedEmitter.fire(this.selectedOrgInfo());
      if (notifyOnEmpty && this.orgs.length === 0) {
        vscode.window.showWarningMessage('No authenticated Salesforce orgs found.');
      }
    } catch (err) {
      // Leave orgsLoaded false so a later attempt retries; the run guard still
      // treats the unresolved org as production (unknown ⇒ prod) in the meantime.
      const message = err instanceof Error ? err.message : String(err);
      this.output.appendLine(`[orgs] Failed to load: ${message}`);
      if (err instanceof SfCliError && err.stderr) {
        this.output.appendLine(err.stderr);
      }
      vscode.window.showErrorMessage(`Apex Editor: failed to list orgs. ${message}`);
    }
  }

  private async runApex(code: string, username: string, source: 'panel' | 'command' = 'panel'): Promise<void> {
    const config = vscode.workspace.getConfiguration('apexEditor');
    const timeout = config.get<number>('executeTimeoutMs', 60_000);
    const apiVersion = config.get<string>('apiVersion', '60.0');
    const controller = new AbortController();
    this.running = true;
    this.currentAbort = controller;
    // If the run was launched from the palette with the panel closed, the webview
    // posts are no-ops and the user would see nothing at all
    // (palette run with panel closed is completely silent). Surface progress and
    // the outcome through the output channel in that case.
    const headless = !this.view;
    if (headless) {
      this.output.show(true);
    }
    this.post({ type: 'execStart' });
    this.output.appendLine(`[exec] Running anonymous Apex against ${username}...`);
    const start = Date.now();
    const cmd = `sf apex run --target-org ${username}`;
    try {
      await this.traceService.ensureTraceFlag(username, apiVersion, {
        signal: controller.signal,
        timeoutMs: timeout,
        onWarn: msg => {
          this.output.appendLine(`[trace] ${msg}`);
          vscode.window.showWarningMessage(`Apex Editor: ${msg}`);
        }
      });
      const result = await this.sf.executeAnonymous(code, username, timeout, controller.signal);
      const durationMs = Date.now() - start;
      this.output.appendLine(this.formatResult(result));
      this.post({
        type: 'execResult',
        result,
        logEntries: parseLogs(result.logs),
        limits: parseLimitUsage(result.logs)
      });
      this.post({
        type: 'cmdLog',
        entry: { timestamp: new Date().toLocaleTimeString(), command: cmd, durationMs, success: result.compiled && result.success }
      });
      if (headless || source === 'command') {
        this.notifyResult(result);
      }
    } catch (err) {
      const durationMs = Date.now() - start;
      if (err instanceof SfCliCancelledError) {
        this.output.appendLine('[exec] Cancelled by user.');
        this.post({ type: 'execCancelled' });
      } else {
        const message = err instanceof Error ? err.message : String(err);
        this.output.appendLine(`[exec] Error: ${message}`);
        if (err instanceof SfCliError && err.stderr) {
          this.output.appendLine(err.stderr);
        }
        this.post({ type: 'execError', message });
        if (headless || source === 'command') {
          vscode.window.showErrorMessage(`Apex Editor: execution failed — ${message}`);
        }
      }
      this.post({
        type: 'cmdLog',
        entry: { timestamp: new Date().toLocaleTimeString(), command: cmd, durationMs, success: false }
      });
    } finally {
      this.running = false;
      this.currentAbort = undefined;
    }
  }

  /** Native notification of a completed run — used when there is no visible panel
   *  to render the result into (palette-launched, panel closed). */
  private notifyResult(result: ApexExecuteResult): void {
    if (!result.compiled) {
      vscode.window.showErrorMessage(`Apex Editor: compile error at line ${result.line}: ${result.compileProblem}`);
    } else if (!result.success) {
      vscode.window.showErrorMessage(`Apex Editor: execution failed — ${result.exceptionMessage || 'unknown error'}`);
    } else {
      vscode.window.showInformationMessage('Apex Editor: execution succeeded. See the Apex Editor output for the debug log.');
    }
  }

  private formatResult(result: ApexExecuteResult): string {
    const lines: string[] = [];
    lines.push(`[exec] success=${result.success} compiled=${result.compiled}`);
    if (!result.compiled) {
      lines.push(`[exec] compile error at line ${result.line}: ${result.compileProblem}`);
    }
    if (result.exceptionMessage) {
      lines.push(`[exec] exception: ${result.exceptionMessage}`);
    }
    if (result.exceptionStackTrace) {
      lines.push(`[exec] stack:\n${result.exceptionStackTrace}`);
    }
    if (result.logs) {
      lines.push('--- debug log ---');
      lines.push(result.logs);
    }
    return lines.join('\n');
  }

  private postState(): void {
    const state = this.tabs.getState();
    this.post({ type: 'state', tabs: state.tabs, activeTabId: state.activeTabId });
  }

  private postSnippets(): void {
    const custom = vscode.workspace.getConfiguration('apexEditor').get('customSnippets');
    this.post({ type: 'snippets', items: mergeSnippets(custom) });
  }

  private postOrgs(): void {
    const selected = this.orgStore.get() ?? null;
    const selectedOrg = selected ? this.orgs.find(o => o.username === selected) : undefined;
    const payload: OrgsPayload = {
      orgs: this.orgs.map(o => ({
        username: o.username,
        alias: o.alias,
        label: o.alias ? `${o.alias} (${o.username})` : o.username,
        kind: SfCliService.kindOf(o)
      })),
      selected,
      selectedKind: SfCliService.kindOf(selectedOrg)
    };
    this.post({ type: 'orgs', ...payload });
  }

  private post(message: unknown): void {
    this.view?.webview.postMessage(message);
  }
}
