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
  // Single view, registered in the bottom panel (next to Terminal). A previous
  // version registered the same provider in both the sidebar and the panel, which
  // caused the two webviews to diverge (org selection, run results and the command
  // log only reached the acting view) — one view keeps everything in sync.
  const provider = new ApexPanelProvider(context, tabs, orgStore, sf, output, 'panel');

  context.subscriptions.push(
    output,
    vscode.window.registerWebviewViewProvider(ApexPanelProvider.viewTypePanel, provider, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.commands.registerCommand('apexEditor.execute', () => provider.executeActive()),
    vscode.commands.registerCommand('apexEditor.selectOrg', () => provider.pickOrg()),
    vscode.commands.registerCommand('apexEditor.newTab', () => provider.newTab())
  );
}

export function deactivate(): void {
  // no-op
}
