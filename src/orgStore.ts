import * as vscode from 'vscode';
import { getSharedOrg, setSharedOrg } from './kit/orgs';

/** This plugin's own org choice — the source of truth. Lives in `workspaceState`,
 *  so every VS Code window keeps its own target org. Same key name the extension
 *  has always used (the two mementos are separate namespaces). */
const PRIVATE_KEY = 'apexEditor.selectedOrg.v1';

/** Set once the one-time "adopt the family-shared org" migration has run. Stays
 *  in `globalState` — it must run once per install, not once per window. */
const MIGRATED_KEY = 'apexEditor.orgSyncMigrated.v1';

/** Set once this window has taken its single hop from the legacy machine-wide
 *  org. Lives in `workspaceState` — the hop is per window, not per install. */
const PORTED_KEY = 'apexEditor.orgPortedFromGlobal.v1';

/** Opt-in switch for following / publishing the family-shared org setting. */
const SYNC_SETTING = 'apexEditor.syncOrgWithFamily';

/**
 * Selected-org store. Apex Editor remembers its OWN target org in `workspaceState`
 * (`PRIVATE_KEY`) — that value is the source of truth and is rewritten on every
 * applied change: a user pick, a follow-from-family adoption, or the startup
 * fallback to the CLI default. Because it is workspace-scoped, two VS Code windows
 * on two projects each keep (and run against) their own org; only the one-time
 * migration flag is machine-wide (`installState` / `globalState`).
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
  constructor(
    private readonly privateState: vscode.Memento,
    private readonly installState: vscode.Memento
  ) {}

  get(): string | undefined {
    const raw = this.privateState.get<string>(PRIVATE_KEY);
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
    await this.privateState.update(PRIVATE_KEY, value);
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
   * (a) Legacy port-forward (see `adoptLegacyOrg`): on its first activation a
   *     window with no org of its own picks up the org older releases stored
   *     machine-wide, so nothing retargets silently on upgrade.
   * (b) One-time migration, regardless of the sync toggle: the private key lay
   *     dormant while the family kept the org choice solely in the shared
   *     setting, so its value can be months stale. On the FIRST activation adopt
   *     the shared org if there is one — then stamp the flag unconditionally,
   *     even when the shared setting was empty. A migration left pending would
   *     fire on some later activation and let a sync-off plugin silently take a
   *     sibling's org; off must mean island. The flag is machine-wide, so on an
   *     install that has not stamped it yet the adoption happens in whichever
   *     window activates first; the others keep what (a) gave them.
   * (c) With sync on, follow the family's current org at startup.
   *
   * No branch writes the shared setting.
   */
  async migrate(): Promise<boolean> {
    const before = this.get();
    await this.adoptLegacyOrg();
    const shared = getSharedOrg();
    if (!this.installState.get<boolean>(MIGRATED_KEY)) {
      if (shared) {
        await this.set(shared);
      }
      await this.installState.update(MIGRATED_KEY, true);
    } else if (this.isSyncEnabled() && shared && shared !== this.get()) {
      await this.set(shared);
    }
    return this.get() !== before;
  }

  /**
   * Port the pre-per-window org forward — at most ONE hop per window. Releases
   * before the per-window switch kept `PRIVATE_KEY` in `globalState`, so on its
   * first activation a window that has no org of its own adopts that value
   * instead of silently retargeting to the CLI default (which may be
   * production). The hop is then stamped in the window store, whether or not
   * there was anything to copy: without that stamp an org cleared on purpose
   * (logout, or a reconciliation dropping an org that is gone) would be
   * resurrected on every reload. The org is written before the stamp, so a crash
   * in between simply re-ports next time. The legacy value is only ever READ —
   * never rewritten and never deleted, because the other open windows still have
   * to port it forward too. Per-window separation starts at the next pick.
   */
  private async adoptLegacyOrg(): Promise<void> {
    if (this.privateState.get<boolean>(PORTED_KEY)) return;
    if (!this.get()) {
      // Read defensively: written by an older release and editable by hand.
      const legacy = this.installState.get<unknown>(PRIVATE_KEY);
      if (typeof legacy === 'string' && legacy.trim()) await this.set(legacy.trim());
    }
    await this.privateState.update(PORTED_KEY, true);
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
