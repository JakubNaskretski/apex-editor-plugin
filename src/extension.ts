import * as vscode from 'vscode';
import { OrgStore } from './orgStore';
import { TabManager } from './tabManager';
import { SfCliService } from './sfCliService';
import { ApexPanelProvider } from './panelProvider';
import { createOrgStatusBar, onSharedOrgChange } from './kit/orgs';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Apex Editor');
  const sf = new SfCliService();
  const tabs = new TabManager(context.workspaceState);
  const orgStore = new OrgStore(context.globalState);
  // One-time migration: seed the family-shared org setting from this plugin's old
  // private globalState key so an existing user keeps their selected org.
  void orgStore.migrate();
  // Single view, registered in the bottom panel (next to Terminal). A previous
  // version registered the same provider in both the sidebar and the panel, which
  // caused the two webviews to diverge (org selection, run results and the command
  // log only reached the acting view) — one view keeps everything in sync.
  const provider = new ApexPanelProvider(context, tabs, orgStore, sf, output, 'panel');

  // Status-bar org indicator with a PROD badge (kit factory). Clicking it opens
  // the org picker. It warn-tints when the target is production.
  const orgStatus = createOrgStatusBar({
    command: 'apexEditor.selectOrg',
    tooltip: 'Apex Editor: select Salesforce org',
    priority: 90
  });
  orgStatus.update(provider.selectedOrgInfo());
  orgStatus.item.show();
  context.subscriptions.push(
    orgStatus.item,
    provider.onOrgChanged(org => orgStatus.update(org)),
    // Follow org switches made by any other family plugin (shared setting).
    onSharedOrgChange(() => { void provider.refreshForExternalOrgChange(); })
  );

  context.subscriptions.push(
    output,
    vscode.window.registerWebviewViewProvider(ApexPanelProvider.viewTypePanel, provider, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.commands.registerCommand('apexEditor.execute', () => provider.executeActive('command')),
    vscode.commands.registerCommand('apexEditor.executeEditor', () => provider.executeEditor()),
    vscode.commands.registerCommand('apexEditor.selectOrg', () => provider.pickOrg()),
    vscode.commands.registerCommand('apexEditor.newTab', () => provider.newTab())
  );
}

export function deactivate(): void {
  // no-op
}
