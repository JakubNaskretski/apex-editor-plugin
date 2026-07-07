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
    registerSafe('apexEditor.execute', () => provider.executeActive('command')),
    registerSafe('apexEditor.executeEditor', () => provider.executeEditor()),
    registerSafe('apexEditor.selectOrg', () => provider.pickOrg()),
    registerSafe('apexEditor.newTab', () => provider.newTab())
  );

  // A rejected command handler (e.g. the org pick failing to save the shared
  // setting) is otherwise an unhandled rejection the user never sees.
  function registerSafe(id: string, fn: () => Promise<unknown> | void): vscode.Disposable {
    return vscode.commands.registerCommand(id, () => {
      void Promise.resolve(fn()).catch(err => {
        const msg = err instanceof Error ? err.message : String(err);
        output.appendLine(`[${id}] ${msg}`);
        void vscode.window.showErrorMessage(`Apex Editor: ${msg}`, 'Show Output').then(choice => {
          if (choice === 'Show Output') output.show(true);
        });
      });
    });
  }
}

export function deactivate(): void {
  // no-op
}
