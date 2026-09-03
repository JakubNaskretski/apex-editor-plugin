import * as vscode from 'vscode';
import { getSharedOrg, setSharedOrg } from './kit/orgs';

/** This plugin's own org choice — the source of truth. Same globalState key the
 *  extension has always used, so an existing selection is picked back up. */
const PRIVATE_KEY = 'apexEditor.selectedOrg.v1';

/** Set once the one-time "adopt the family-shared org" migration has run. */
const MIGRATED_KEY = 'apexEditor.orgSyncMigrated.v1';

/** Opt-in switch for following / publishing the family-shared org setting. */
const SYNC_SETTING = 'apexEditor.syncOrgWithFamily';

/**
 * Selected-org store. Apex Editor remembers its OWN target org in `globalState`
 * (`PRIVATE_KEY`) — that value is the source of truth and is rewritten on every
 * applied change: a user pick, a follow-from-family adoption, or the startup
 * fallback to the CLI default.
 *
 * The family-shared setting `skrety.salesforce.targetOrg` is opt-in: with
 * `apexEditor.syncOrgWithFamily` on we follow switches made in sibling Skrety SF
 * plugins and publish our own picks back to them; with it off (the default) this
 * plugin keeps its own org and neither reads nor writes the shared setting. We do
 * NOT contribute the shared setting's schema — sf-org-deploy-helper owns that
 * declaration; we read and write it undeclared, which is fully functional.
 *
 * The toggle is read at call time (never cached), so flipping it takes effect
 * without a window reload.
 */
export class OrgStore {
  constructor(private readonly memento: vscode.Memento) {}

  get(): string | undefined {
    const raw = this.memento.get<string>(PRIVATE_KEY);
    return raw && raw.trim() ? raw : undefined;
  }

  /**
   * Persist an applied org change. The private key is ALWAYS written, whatever
   * the sync toggle says. `publish` marks a user-initiated pick: only those, and
   * only while sync is on, also write the family-shared setting — activation,
   * the watcher and the org-list reconciliation must never touch it.
   */
  async set(username: string | undefined, opts: { publish?: boolean } = {}): Promise<void> {
    const value = username && username.trim() ? username : undefined;
    await this.memento.update(PRIVATE_KEY, value);
    // Never publish an empty value: a "no org" pick must not blank the family.
    if (opts.publish && value && this.isSyncEnabled()) {
      await setSharedOrg(value);
    }
  }

  /** Whether this plugin follows / publishes the family-shared org right now. */
  isSyncEnabled(): boolean {
    return vscode.workspace.getConfiguration().get<boolean>(SYNC_SETTING, false) === true;
  }

  /**
   * Activation-time reconciliation. Returns true when the selected org changed.
   *
   * (a) One-time migration, regardless of the sync toggle: the private key lay
   *     dormant while the family kept the org choice solely in the shared
   *     setting, so its value can be months stale. On the FIRST activation adopt
   *     the shared org if there is one — then stamp the flag unconditionally,
   *     even when the shared setting was empty. A migration left pending would
   *     fire on some later activation and let a sync-off plugin silently take a
   *     sibling's org; off must mean island.
   * (b) With sync on, follow the family's current org at startup.
   *
   * Neither branch writes the shared setting.
   */
  async migrate(): Promise<boolean> {
    const before = this.get();
    const shared = getSharedOrg();
    if (!this.memento.get<boolean>(MIGRATED_KEY)) {
      if (shared) {
        await this.set(shared);
      }
      await this.memento.update(MIGRATED_KEY, true);
    } else if (this.isSyncEnabled() && shared && shared !== this.get()) {
      await this.set(shared);
    }
    return this.get() !== before;
  }

  /**
   * Adopt the family-shared org when sync is on and it differs from ours — the
   * shared path for "another plugin switched org" and "the user just turned sync
   * on". Returns true when our org actually changed (so the caller refreshes its
   * surfaces); false when sync is off or the value already matches, which is
   * also what de-dups the echo of our own published pick.
   *
   * An EMPTY shared value is never adopted: another plugin (or the user) clearing
   * the family org must not blank our working target — that would show "No Org"
   * and let the next reconciliation silently auto-select the CLI default.
   */
  async adoptShared(): Promise<boolean> {
    if (!this.isSyncEnabled()) return false;
    const shared = getSharedOrg();
    if (!shared || shared === this.get()) return false;
    await this.set(shared);
    return true;
  }
}
