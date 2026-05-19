import * as vscode from 'vscode';
import { OrgStore } from './orgStore';
import { TabManager } from './tabManager';
import { ApexExecuteResult, OrgInfo, SfCliError, SfCliService } from './sfCliService';
import { generateNonce, getPanelHtml } from './panelHtml';
import { parseLogs } from './logParser';
import { TraceService } from './traceService';

type InboundMessage =
  | { type: 'ready' }
  | { type: 'updateCode'; tabId: string; code: string }
  | { type: 'newTab' }
  | { type: 'closeTab'; tabId: string }
  | { type: 'selectTab'; tabId: string }
  | { type: 'renameTab'; tabId: string; title: string }
  | { type: 'selectOrg'; username: string }
  | { type: 'refreshOrgs' }
  | { type: 'execute' };

interface OrgsPayload {
  orgs: Array<{ username: string; alias?: string; label: string }>;
  selected: string | null;
}

export class ApexPanelProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'apexEditor.panel';
  static readonly viewTypePanel = 'apexEditor.panelView';
  private view?: vscode.WebviewView;
  private orgs: OrgInfo[] = [];
  private readonly traceService: TraceService;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly tabs: TabManager,
    private readonly orgStore: OrgStore,
    private readonly sf: SfCliService,
    private readonly output: vscode.OutputChannel
  ) {
    this.tabs.onDidChange(() => this.postState());
    this.traceService = new TraceService(sf);
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'out')]
    };
    view.webview.html = getPanelHtml(view.webview, this.context.extensionUri, generateNonce());

    view.webview.onDidReceiveMessage((message: InboundMessage) => this.handleMessage(message));
    view.onDidDispose(() => { this.view = undefined; });
  }

  async executeActive(): Promise<void> {
    const active = this.tabs.getActive();
    if (!active) {
      vscode.window.showWarningMessage('No active Apex tab to execute.');
      return;
    }
    if (!active.code.trim()) {
      vscode.window.showWarningMessage('Active tab is empty.');
      return;
    }
    const selectedOrg = this.orgStore.get();
    if (!selectedOrg) {
      vscode.window.showWarningMessage('Select a Salesforce org first.');
      return;
    }
    await this.runApex(active.code, selectedOrg);
  }

  async newTab(): Promise<void> {
    this.tabs.createTab();
  }

  async pickOrg(): Promise<void> {
    if (this.orgs.length === 0) {
      await this.loadOrgs();
    }
    const items = this.orgs.map(org => ({
      label: org.alias ? `${org.alias}` : org.username,
      description: org.alias ? org.username : undefined,
      detail: org.instanceUrl,
      username: org.username
    }));
    if (items.length === 0) {
      const choice = await vscode.window.showWarningMessage(
        'No authenticated Salesforce orgs found. Run `sf org login web` first.',
        'Refresh'
      );
      if (choice === 'Refresh') {
        await this.loadOrgs(true);
      }
      return;
    }
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select Salesforce org',
      matchOnDescription: true,
      matchOnDetail: true
    });
    if (picked) {
      await this.orgStore.set(picked.username);
      this.postOrgs();
    }
  }

  private async handleMessage(message: InboundMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        await this.loadOrgs();
        this.postState();
        return;
      case 'updateCode':
        this.tabs.updateCode(message.tabId, message.code);
        return;
      case 'newTab':
        this.tabs.createTab();
        return;
      case 'closeTab':
        this.tabs.closeTab(message.tabId);
        return;
      case 'selectTab':
        this.tabs.setActive(message.tabId);
        return;
      case 'renameTab':
        this.tabs.renameTab(message.tabId, message.title);
        return;
      case 'selectOrg':
        await this.orgStore.set(message.username);
        this.postOrgs();
        return;
      case 'refreshOrgs':
        await this.loadOrgs(true);
        return;
      case 'execute':
        await this.executeActive();
        return;
    }
  }

  private async loadOrgs(notifyOnEmpty = false): Promise<void> {
    try {
      this.orgs = await this.sf.listOrgs();
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
      if (notifyOnEmpty && this.orgs.length === 0) {
        vscode.window.showWarningMessage('No authenticated Salesforce orgs found.');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.output.appendLine(`[orgs] Failed to load: ${message}`);
      if (err instanceof SfCliError && err.stderr) {
        this.output.appendLine(err.stderr);
      }
      vscode.window.showErrorMessage(`Apex Editor: failed to list orgs. ${message}`);
    }
  }

  private async runApex(code: string, username: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('apexEditor');
    const timeout = config.get<number>('executeTimeoutMs', 60_000);
    const apiVersion = config.get<string>('apiVersion', '60.0');
    this.post({ type: 'execStart' });
    this.output.appendLine(`[exec] Running anonymous Apex against ${username}...`);
    try {
      await this.traceService.ensureTraceFlag(username, apiVersion);
      const result = await this.sf.executeAnonymous(code, username, timeout);
      this.output.appendLine(this.formatResult(result));
      this.post({ type: 'execResult', result, logEntries: parseLogs(result.logs) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.output.appendLine(`[exec] Error: ${message}`);
      if (err instanceof SfCliError && err.stderr) {
        this.output.appendLine(err.stderr);
      }
      this.post({ type: 'execError', message });
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

  private postOrgs(): void {
    const payload: OrgsPayload = {
      orgs: this.orgs.map(o => ({
        username: o.username,
        alias: o.alias,
        label: o.alias ? `${o.alias} (${o.username})` : o.username
      })),
      selected: this.orgStore.get() ?? null
    };
    this.post({ type: 'orgs', ...payload });
  }

  private post(message: unknown): void {
    this.view?.webview.postMessage(message);
  }
}
