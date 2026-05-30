import { beforeEach, describe, expect, it, vi } from 'vitest';

// Minimal vscode mock — TabManager only needs EventEmitter (and a Memento, which
// is just a type at runtime).
vi.mock('vscode', () => {
  class EventEmitter<T> {
    private listeners: Array<(e: T) => void> = [];
    event = (fn: (e: T) => void) => {
      this.listeners.push(fn);
      return { dispose: () => undefined };
    };
    fire = (e?: T) => { this.listeners.forEach(fn => fn(e as T)); };
    dispose = () => undefined;
  }
  return { EventEmitter };
});

import { TabManager } from './tabManager';

function makeMemento(initial: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(initial));
  return {
    get: (key: string, def?: unknown) => (store.has(key) ? store.get(key) : def),
    update: (key: string, value: unknown) => { store.set(key, value); return Promise.resolve(); },
    keys: () => [...store.keys()],
    setKeysForSync: () => undefined
  } as any;
}

describe('TabManager', () => {
  let mem: ReturnType<typeof makeMemento>;
  let mgr: TabManager;
  let fires: number;

  beforeEach(() => {
    mem = makeMemento();
    mgr = new TabManager(mem);
    fires = 0;
    mgr.onDidChange(() => { fires += 1; });
  });

  it('creates one tab when storage is empty', () => {
    expect(mgr.getState().tabs).toHaveLength(1);
    expect(mgr.getActive()).not.toBeNull();
  });

  it('createTab adds a tab, activates it, and fires onDidChange', () => {
    mgr.createTab();
    expect(mgr.getState().tabs).toHaveLength(2);
    expect(mgr.getActive()?.id).toBe(mgr.getState().activeTabId);
    expect(fires).toBe(1);
  });

  it('updateCode persists WITHOUT firing onDidChange (so the caret is not reset)', () => {
    const active = mgr.getActive()!;
    mgr.updateCode(active.id, 'System.debug(1);');
    expect(mgr.getActive()?.code).toBe('System.debug(1);');
    expect(fires).toBe(0); // the key fix: no broadcast on code edits
  });

  it('setActive and rename fire onDidChange', () => {
    const a = mgr.getActive()!;
    mgr.createTab();           // fire 1
    const b = mgr.getActive()!;
    mgr.setActive(a.id);       // fire 2
    expect(mgr.getActive()?.id).toBe(a.id);
    mgr.renameTab(b.id, '  My Script  '); // fire 3 (trimmed)
    expect(mgr.getState().tabs.find(t => t.id === b.id)?.title).toBe('My Script');
    expect(fires).toBe(3);
  });

  it('closing the last tab recreates a fresh one', () => {
    const a = mgr.getActive()!;
    mgr.closeTab(a.id);
    expect(mgr.getState().tabs).toHaveLength(1);
    expect(mgr.getState().tabs[0].id).not.toBe(a.id);
  });

  it('restores persisted tabs on construction', () => {
    const seeded = makeMemento({
      'apexEditor.tabs.v1': { tabs: [{ id: 't1', title: 'Kept', code: 'x' }], activeTabId: 't1' }
    });
    const restored = new TabManager(seeded);
    expect(restored.getState().tabs).toHaveLength(1);
    expect(restored.getActive()?.title).toBe('Kept');
  });
});
