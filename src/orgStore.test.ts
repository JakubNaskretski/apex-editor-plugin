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
const SHARED_KEY = 'skrety.salesforce.targetOrg';
const SYNC_KEY = 'apexEditor.syncOrgWithFamily';
const PRIVATE_KEY = 'apexEditor.selectedOrg.v1';
const MIGRATED_KEY = 'apexEditor.orgSyncMigrated.v1';

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
    const mem = makeMemento({ [MIGRATED_KEY]: true });
    const store = new OrgStore(mem);
    await store.set(OWN, { publish: true });
    expect(store.get()).toBe(OWN);
    expect(mem.store.get(PRIVATE_KEY)).toBe(OWN);
    expect(sharedWrites).toEqual([]);
    expect(config.has(SHARED_KEY)).toBe(false);
  });

  it('ignores a family org switch', async () => {
    const mem = makeMemento({ [MIGRATED_KEY]: true, [PRIVATE_KEY]: OWN });
    const store = new OrgStore(mem);
    config.set(SHARED_KEY, FAMILY);
    expect(await store.adoptShared()).toBe(false);
    expect(store.get()).toBe(OWN);
  });
});

describe('OrgStore with sync ON', () => {
  beforeEach(() => { config.set(SYNC_KEY, true); });

  it('publishes a user pick to the family-shared setting', async () => {
    const store = new OrgStore(makeMemento({ [MIGRATED_KEY]: true }));
    await store.set(OWN, { publish: true });
    expect(store.get()).toBe(OWN);
    expect(sharedWrites).toEqual([OWN]);
  });

  it('never publishes an empty pick — a "no org" choice must not blank the family', async () => {
    const store = new OrgStore(makeMemento({ [MIGRATED_KEY]: true, [PRIVATE_KEY]: OWN }));
    await store.set(undefined, { publish: true });
    await store.set('', { publish: true });
    expect(store.get()).toBeUndefined();
    expect(sharedWrites).toEqual([]);
  });

  it('never publishes a non-pick write (activation / reconciliation)', async () => {
    const store = new OrgStore(makeMemento({ [MIGRATED_KEY]: true }));
    await store.set(OWN);
    expect(store.get()).toBe(OWN);
    expect(sharedWrites).toEqual([]);
  });

  it('adopts a family org switch into our own key and reports the change', async () => {
    const store = new OrgStore(makeMemento({ [MIGRATED_KEY]: true, [PRIVATE_KEY]: OWN }));
    config.set(SHARED_KEY, FAMILY);
    expect(await store.adoptShared()).toBe(true);
    expect(store.get()).toBe(FAMILY);
    // Adopting is not publishing: the shared setting is left untouched.
    expect(sharedWrites).toEqual([]);
    // Echo of our own value: nothing changed, so no refresh is requested.
    expect(await store.adoptShared()).toBe(false);
  });

  it('never adopts an EMPTY shared value — a family clear must not blank our org', async () => {
    const store = new OrgStore(makeMemento({ [MIGRATED_KEY]: true, [PRIVATE_KEY]: OWN }));
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
    const store = new OrgStore(makeMemento({ [MIGRATED_KEY]: true, [PRIVATE_KEY]: OWN }));
    config.set(SHARED_KEY, FAMILY);
    config.set(SYNC_KEY, true); // the toggle-on event fires the same adopt path
    expect(await store.adoptShared()).toBe(true);
    expect(store.get()).toBe(FAMILY);
  });

  it('keeps our org when the shared setting is empty', async () => {
    const store = new OrgStore(makeMemento({ [MIGRATED_KEY]: true, [PRIVATE_KEY]: OWN }));
    config.set(SYNC_KEY, true);
    expect(await store.adoptShared()).toBe(false);
    expect(store.get()).toBe(OWN);
    expect(sharedWrites).toEqual([]);
  });
});

describe('OrgStore.migrate', () => {
  it('adopts the shared org once, regardless of the sync toggle, then no-ops', async () => {
    const mem = makeMemento({ [PRIVATE_KEY]: 'stale@acme.example' });
    const store = new OrgStore(mem);
    config.set(SHARED_KEY, FAMILY);

    expect(await store.migrate()).toBe(true);
    expect(store.get()).toBe(FAMILY);
    expect(mem.store.get(MIGRATED_KEY)).toBe(true);
    expect(sharedWrites).toEqual([]);

    // Second activation: the flag is set, sync is off — a later family switch is
    // not pulled in.
    config.set(SHARED_KEY, 'other@acme.example');
    expect(await store.migrate()).toBe(false);
    expect(store.get()).toBe(FAMILY);
  });

  it('follows the family org at startup once migrated, when sync is on', async () => {
    const store = new OrgStore(makeMemento({ [MIGRATED_KEY]: true, [PRIVATE_KEY]: OWN }));
    config.set(SYNC_KEY, true);
    config.set(SHARED_KEY, FAMILY);
    expect(await store.migrate()).toBe(true);
    expect(store.get()).toBe(FAMILY);
    expect(sharedWrites).toEqual([]);
  });

  it('stamps the flag on the first activation even when the shared setting is empty', async () => {
    const mem = makeMemento({ [PRIVATE_KEY]: OWN });
    const store = new OrgStore(mem);

    expect(await store.migrate()).toBe(false);
    expect(store.get()).toBe(OWN);
    expect(mem.store.get(MIGRATED_KEY)).toBe(true);

    // The migration is spent: a sibling setting the shared org later must NOT be
    // adopted while sync is off — "off" means island.
    config.set(SHARED_KEY, FAMILY);
    expect(await store.migrate()).toBe(false);
    expect(store.get()).toBe(OWN);
    expect(sharedWrites).toEqual([]);
  });
});
