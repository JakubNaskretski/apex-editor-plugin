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
    // Follow org switches made by any other family plugin — but only while
    // `apexEditor.syncOrgWithFamily` is on. The flag is checked inside the
    // handler, at event time, so toggling it needs no reload.
    onSharedOrgChange(() => { void provider.followSharedOrgChange(); }),
    // Turning sync ON adopts the family's current org right away (turning it off
    // does nothing — we simply keep the org we already have).
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('apexEditor.syncOrgWithFamily')) {
        void provider.followSharedOrgChange();
      }
    })
  );

  // Activation reconciliation: one-time adoption of the shared org (the private
  // key lay dormant while the family shared setting owned the choice), plus the
  // follow-the-family startup step when sync is on. Neither writes the shared
  // setting. Refresh the panel + status bar if the effective org changed.
  void orgStore.migrate()
    .then(changed => (changed ? provider.refreshAfterMigration() : undefined))
    .catch(err => output.appendLine(`[orgs] Migration failed: ${err instanceof Error ? err.message : String(err)}`));

  context.subscriptions.push(
    output,
    vscode.window.registerWebviewViewProvider(ApexPanelProvider.viewTypePanel, provider, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    registerSafe('apexEditor.execute', () => provider.executeActive('command')),
    registerSafe('apexEditor.executeEditor', () => provider.executeEditor()),
    registerSafe('apexEditor.selectOrg', () => provider.pickOrg()),
    registerSafe('apexEditor.newTab', () => provider.newTab()),
    registerSafe('apexEditor.help', () => help(context))
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

// The "?" in the panel title: a short plain-text guide (a modal's detail renders no markdown).
async function help(context: vscode.ExtensionContext): Promise<void> {
  const HELP = `1. Open the Apex Editor tab in the bottom panel, next to Terminal.
2. Pick an org in the dropdown — any org authenticated with the sf CLI.
3. Write anonymous Apex in a tab and press Run (or Cmd/Ctrl+Enter inside the panel).
4. Results, limits and the debug log appear below; filter the log by category.
5. + opens another tab; tabs are saved per workspace. Type a snippet prefix, then Tab.
6. In an Apex file (.apex or the Apex language) Cmd/Ctrl+Alt+R runs the file, or just the selection.
7. Orgs tagged [PROD], and any org it can't classify, ask for confirmation first (apexEditor.confirmProductionRun).

Needs the Salesforce CLI (sf) on your PATH with at least one authenticated org.`;
  const choice = await vscode.window.showInformationMessage('Apex Editor', { modal: true, detail: HELP }, 'Open README');
  if (choice === 'Open README') {
    // vsce ships the file as readme.md while the dev host has README.md: open whichever exists
    for (const name of ['readme.md', 'README.md']) {
      const uri = vscode.Uri.joinPath(context.extensionUri, name);
      try {
        await vscode.workspace.fs.stat(uri);
        await vscode.commands.executeCommand('markdown.showPreview', uri);
        return;
      } catch { /* try the other spelling */ }
    }
    void vscode.window.showWarningMessage('README not found in the extension folder.');
  }
}

export function deactivate(): void {
  // no-op
}
