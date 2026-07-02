import * as vscode from 'vscode';
import { getSharedOrg, setSharedOrg, migrateToSharedOrg } from './kit/orgs';

/** Legacy per-extension key. Kept only as the migration source for the shared
 *  setting — read once on activation, then the shared setting owns the choice. */
const LEGACY_KEY = 'apexEditor.selectedOrg.v1';

/**
 * Selected-org store. The org choice now lives in the family-shared VS Code
 * setting `skrety.salesforce.targetOrg` (machine scope) so switching the org in
 * any Skrety SF plugin switches it here too. We do NOT contribute
 * the setting's schema — sf-org-deploy-helper owns that declaration; we read and
 * write it undeclared, which is fully functional.
 *
 * The legacy `globalState` key is used only to seed the shared setting once, so a
 * user who already picked an org before this release keeps it.
 */
export class OrgStore {
  constructor(private readonly memento: vscode.Memento) {}

  get(): string | undefined {
    return getSharedOrg();
  }

  async set(username: string | undefined): Promise<void> {
    await setSharedOrg(username);
  }

  /** One-time migration: if the shared setting is empty but this plugin's old
   *  private key holds a username, seed the shared setting from it. Safe to call
   *  on every activation (no-ops once the shared setting is populated). */
  async migrate(): Promise<void> {
    const legacy = this.memento.get<string>(LEGACY_KEY);
    await migrateToSharedOrg(legacy);
  }
}
