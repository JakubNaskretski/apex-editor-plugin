import * as vscode from 'vscode';
import { OrgStore } from './orgStore';
import { TabManager } from './tabManager';
import { SfCliService } from './sfCliService';
import { ApexPanelProvider } from './panelProvider';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Apex Editor');
  const sf = new SfCliService();
  const tabs = new TabManager(context.workspaceState);
  const orgStore = new OrgStore(context.globalState);
  const provider = new ApexPanelProvider(context, tabs, orgStore, sf, output);
  const panelProvider = new ApexPanelProvider(context, tabs, orgStore, sf, output, 'panel');

  context.subscriptions.push(
    output,
    vscode.window.registerWebviewViewProvider(ApexPanelProvider.viewType, provider),
    vscode.window.registerWebviewViewProvider(ApexPanelProvider.viewTypePanel, panelProvider),
    vscode.commands.registerCommand('apexEditor.execute', () => provider.executeActive()),
    vscode.commands.registerCommand('apexEditor.selectOrg', () => provider.pickOrg()),
    vscode.commands.registerCommand('apexEditor.newTab', () => provider.newTab())
  );
}

export function deactivate(): void {
  // no-op
}
