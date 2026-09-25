import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// OrgStore (and the kit helpers it calls) read/write VS Code settings, so mock a
// single flat config store: `skrety.salesforce.targetOrg` (family-shared org) and
// `apexEditor.syncOrgWithFamily` (this plugin's opt-in toggle) both live in it.
const { config, sharedWrites } = vi.hoisted(() => ({
  config: new Map<string, unknown>(),
  sharedWrites: [] as Array<string | undefined>
}));

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: () => ({
      get: (key: string, def?: unknown) => (config.has(key) ? config.get(key) : def),
      update: (key: string, value: unknown) => {
        if (key === 'skrety.salesforce.targetOrg') sharedWrites.push(value as string | undefined);
        if (value === undefined) config.delete(key); else config.set(key, value);
        return Promise.resolve();
      }
    }),
    onDidChangeConfiguration: () => ({ dispose: () => undefined })
  },
  window: { createStatusBarItem: vi.fn(), showQuickPick: vi.fn(), showWarningMessage: vi.fn() },
  ConfigurationTarget: { Global: 1 },
  StatusBarAlignment: { Left: 1 },
  ThemeColor: class { constructor(public id: string) {} },
  EventEmitter: class { event = vi.fn(); fire = vi.fn(); dispose = vi.fn(); }
}));

import { OrgStore } from './orgStore';

const OWN = 'dev@acme.example';
const FAMILY = 'qa@acme.example';
/** What a pre-per-window release left behind in globalState. */
const LEGACY = 'legacy@acme.example';
const SHARED_KEY = 'skrety.salesforce.targetOrg';
const SYNC_KEY = 'apexEditor.syncOrgWithFamily';
const PRIVATE_KEY = 'apexEditor.selectedOrg.v1';
const MIGRATED_KEY = 'apexEditor.orgSyncMigrated.v1';
const PORTED_KEY = 'apexEditor.orgPortedFromGlobal.v1';

/** Stand-in for a VS Code memento — one instance per scope (workspace / global). */
function makeMemento(initial: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(initial));
  return {
    store,
    get: (key: string, def?: unknown) => (store.has(key) ? store.get(key) : def),
    update: (key: string, value: unknown) => { store.set(key, value); return Promise.resolve(); },
    keys: () => [...store.keys()],
    setKeysForSync: () => undefined
  } as any;
}

beforeEach(() => {
  config.clear();
  sharedWrites.length = 0;
});

describe('OrgStore with sync OFF (default)', () => {
  it('a pick writes only our own key — never the family-shared setting', async () => {
    const mem = makeMemento();
    const store = new OrgStore(mem, makeMemento({ [MIGRATED_KEY]: true }));
    await store.set(OWN, { publish: true });
    expect(store.get()).toBe(OWN);
    expect(mem.store.get(PRIVATE_KEY)).toBe(OWN);
    expect(sharedWrites).toEqual([]);
    expect(config.has(SHARED_KEY)).toBe(false);
  });

  it('ignores a family org switch', async () => {
    const store = new OrgStore(makeMemento({ [PRIVATE_KEY]: OWN }), makeMemento({ [MIGRATED_KEY]: true }));
    config.set(SHARED_KEY, FAMILY);
    expect(await store.adoptShared()).toBe(false);
    expect(store.get()).toBe(OWN);
  });
});

describe('OrgStore with sync ON', () => {
  beforeEach(() => { config.set(SYNC_KEY, true); });

  it('publishes a user pick to the family-shared setting', async () => {
    const store = new OrgStore(makeMemento(), makeMemento({ [MIGRATED_KEY]: true }));
    await store.set(OWN, { publish: true });
    expect(store.get()).toBe(OWN);
    expect(sharedWrites).toEqual([OWN]);
  });

  it('never publishes an empty pick — a "no org" choice must not blank the family', async () => {
    const store = new OrgStore(makeMemento({ [PRIVATE_KEY]: OWN }), makeMemento({ [MIGRATED_KEY]: true }));
    await store.set(undefined, { publish: true });
    await store.set('', { publish: true });
    expect(store.get()).toBeUndefined();
    expect(sharedWrites).toEqual([]);
  });

  it('never publishes a non-pick write (activation / reconciliation)', async () => {
    const store = new OrgStore(makeMemento(), makeMemento({ [MIGRATED_KEY]: true }));
    await store.set(OWN);
    expect(store.get()).toBe(OWN);
    expect(sharedWrites).toEqual([]);
  });

  it('adopts a family org switch into our own key and reports the change', async () => {
    const store = new OrgStore(makeMemento({ [PRIVATE_KEY]: OWN }), makeMemento({ [MIGRATED_KEY]: true }));
    config.set(SHARED_KEY, FAMILY);
    expect(await store.adoptShared()).toBe(true);
    expect(store.get()).toBe(FAMILY);
    // Adopting is not publishing: the shared setting is left untouched.
    expect(sharedWrites).toEqual([]);
    // Echo of our own value: nothing changed, so no refresh is requested.
    expect(await store.adoptShared()).toBe(false);
  });

  it('never adopts an EMPTY shared value — a family clear must not blank our org', async () => {
    const store = new OrgStore(makeMemento({ [PRIVATE_KEY]: OWN }), makeMemento({ [MIGRATED_KEY]: true }));
    config.set(SHARED_KEY, FAMILY);
    expect(await store.adoptShared()).toBe(true);

    // Sibling (or the user) clears `skrety.salesforce.targetOrg`.
    config.delete(SHARED_KEY);
    expect(await store.adoptShared()).toBe(false);
    expect(store.get()).toBe(FAMILY);

    // Same for an all-whitespace value written by hand into settings.json.
    config.set(SHARED_KEY, '   ');
    expect(await store.adoptShared()).toBe(false);
    expect(store.get()).toBe(FAMILY);
  });
});

describe('turning sync ON', () => {
  it('adopts the family org when one is set', async () => {
    const store = new OrgStore(makeMemento({ [PRIVATE_KEY]: OWN }), makeMemento({ [MIGRATED_KEY]: true }));
    config.set(SHARED_KEY, FAMILY);
    config.set(SYNC_KEY, true); // the toggle-on event fires the same adopt path
    expect(await store.adoptShared()).toBe(true);
    expect(store.get()).toBe(FAMILY);
  });

  it('keeps our org when the shared setting is empty', async () => {
    const store = new OrgStore(makeMemento({ [PRIVATE_KEY]: OWN }), makeMemento({ [MIGRATED_KEY]: true }));
    config.set(SYNC_KEY, true);
    expect(await store.adoptShared()).toBe(false);
    expect(store.get()).toBe(OWN);
    expect(sharedWrites).toEqual([]);
  });
});

describe('OrgStore.migrate', () => {
  it('adopts the shared org once, regardless of the sync toggle, then no-ops', async () => {
    const mem = makeMemento({ [PRIVATE_KEY]: 'stale@acme.example' });
    const install = makeMemento();
    const store = new OrgStore(mem, install);
    config.set(SHARED_KEY, FAMILY);

    expect(await store.migrate()).toBe(true);
    expect(store.get()).toBe(FAMILY);
    expect(install.store.get(MIGRATED_KEY)).toBe(true);
    expect(sharedWrites).toEqual([]);

    // Second activation: the flag is set, sync is off — a later family switch is
    // not pulled in.
    config.set(SHARED_KEY, 'other@acme.example');
    expect(await store.migrate()).toBe(false);
    expect(store.get()).toBe(FAMILY);
  });

  it('follows the family org at startup once migrated, when sync is on', async () => {
    const store = new OrgStore(makeMemento({ [PRIVATE_KEY]: OWN }), makeMemento({ [MIGRATED_KEY]: true }));
    config.set(SYNC_KEY, true);
    config.set(SHARED_KEY, FAMILY);
    expect(await store.migrate()).toBe(true);
    expect(store.get()).toBe(FAMILY);
    expect(sharedWrites).toEqual([]);
  });

  it('stamps the flag on the first activation even when the shared setting is empty', async () => {
    const mem = makeMemento({ [PRIVATE_KEY]: OWN });
    const install = makeMemento();
    const store = new OrgStore(mem, install);

    expect(await store.migrate()).toBe(false);
    expect(store.get()).toBe(OWN);
    expect(install.store.get(MIGRATED_KEY)).toBe(true);

    // The migration is spent: a sibling setting the shared org later must NOT be
    // adopted while sync is off — "off" means island.
    config.set(SHARED_KEY, FAMILY);
    expect(await store.migrate()).toBe(false);
    expect(store.get()).toBe(OWN);
    expect(sharedWrites).toEqual([]);
  });
});

describe('per-window scope', () => {
  it('ports the legacy org forward into the window store once, then keeps the org per window', async () => {
    // Upgrade from a pre-per-window release: this window has no org yet, so it
    // adopts the one globalState still holds instead of silently retargeting to
    // the CLI default org.
    const workspaceState = makeMemento();
    const globalState = makeMemento({ [PRIVATE_KEY]: LEGACY });
    const store = new OrgStore(workspaceState, globalState);

    await store.migrate();
    expect(store.get()).toBe(LEGACY);

    // The port-forward must WRITE the window store: a get() that just fell back
    // to globalState would leave this window empty.
    expect(workspaceState.store.get(PRIVATE_KEY)).toBe(LEGACY);

    // The legacy value is read-only — other open windows still have to port it
    // forward — and the flag is the only machine-wide write.
    expect(globalState.store.get(PRIVATE_KEY)).toBe(LEGACY);
    expect(globalState.store.get(MIGRATED_KEY)).toBe(true);
    expect(workspaceState.store.has(MIGRATED_KEY)).toBe(false);

    // A pick in this window stays in this window.
    await store.set(OWN, { publish: true });
    expect(workspaceState.store.get(PRIVATE_KEY)).toBe(OWN);
    expect(globalState.store.get(PRIVATE_KEY)).toBe(LEGACY);

    // A "no org" pick clears THIS window; the machine-wide leftover must not
    // resurface as a read fallback.
    await store.set(undefined);
    expect(store.get()).toBeUndefined();

    // The hop is stamped in THIS window's store, so it happens at most once: an
    // org cleared on purpose (logout, or a reconciliation dropping an org that
    // is gone) must not be resurrected by the next activation.
    expect(workspaceState.store.get(PORTED_KEY)).toBe(true);
    expect(globalState.store.has(PORTED_KEY)).toBe(false);
    expect(await store.migrate()).toBe(false);
    expect(store.get()).toBeUndefined();

    // A window with nothing to port stamps itself all the same — the stamp is
    // what makes the hop one-per-window rather than one-per-activation.
    const freshWindow = makeMemento();
    const freshInstall = makeMemento({ [MIGRATED_KEY]: true });
    await new OrgStore(freshWindow, freshInstall).migrate();
    expect(freshWindow.store.get(PORTED_KEY)).toBe(true);
    expect(freshInstall.store.has(PORTED_KEY)).toBe(false);

    // A second window that already has its own org keeps it.

    const otherWindow = makeMemento({ [PRIVATE_KEY]: FAMILY });
    const otherStore = new OrgStore(otherWindow, globalState);
    await otherStore.migrate();
    expect(otherStore.get()).toBe(FAMILY);
    expect(globalState.store.get(PRIVATE_KEY)).toBe(LEGACY);
  });
});

describe('extension wiring', () => {
  // Source pins: a swapped memento pair compiles and passes every unit test
  // while silently making the org machine-wide again.
  const source = readFileSync(join(process.cwd(), 'src', 'extension.ts'), 'utf8');

  it('hands the private org to workspaceState and the migration flag to globalState', () => {
    expect(source).toContain('new OrgStore(context.workspaceState, context.globalState)');
  });

  it('never constructs the OrgStore on globalState', () => {
    expect(
      source.includes('new OrgStore(context.globalState'),
      'src/extension.ts must construct new OrgStore(context.workspaceState, context.globalState): passing globalState as the private store puts the org back in every other VS Code window'
    ).toBe(false);
  });
});
