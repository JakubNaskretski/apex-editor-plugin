import * as vscode from 'vscode';

export interface ApexTab {
  id: string;
  title: string;
  code: string;
}

interface PersistedState {
  tabs: ApexTab[];
  activeTabId: string | null;
}

const STORAGE_KEY = 'apexEditor.tabs.v1';

export class TabManager {
  private tabs: ApexTab[] = [];
  private activeTabId: string | null = null;
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;

  constructor(private readonly storage: vscode.Memento) {
    const persisted = storage.get<PersistedState>(STORAGE_KEY);
    if (persisted && Array.isArray(persisted.tabs) && persisted.tabs.length > 0) {
      this.tabs = persisted.tabs;
      this.activeTabId = persisted.activeTabId && this.tabs.some(t => t.id === persisted.activeTabId)
        ? persisted.activeTabId
        : this.tabs[0].id;
    } else {
      this.createTab();
    }
  }

  getState(): PersistedState {
    return { tabs: this.tabs.map(t => ({ ...t })), activeTabId: this.activeTabId };
  }

  getActive(): ApexTab | null {
    return this.tabs.find(t => t.id === this.activeTabId) ?? null;
  }

  createTab(): ApexTab {
    const id = this.generateId();
    const nextIndex = this.tabs.length + 1;
    const tab: ApexTab = {
      id,
      title: `Script ${nextIndex}`,
      code: ''
    };
    this.tabs.push(tab);
    this.activeTabId = id;
    this.persist();
    return tab;
  }

  closeTab(id: string): void {
    const index = this.tabs.findIndex(t => t.id === id);
    if (index === -1) {
      return;
    }
    this.tabs.splice(index, 1);
    if (this.tabs.length === 0) {
      this.createTab();
      return;
    }
    if (this.activeTabId === id) {
      const fallback = this.tabs[Math.min(index, this.tabs.length - 1)];
      this.activeTabId = fallback.id;
    }
    this.persist();
  }

  setActive(id: string): void {
    if (this.tabs.some(t => t.id === id) && this.activeTabId !== id) {
      this.activeTabId = id;
      this.persist();
    }
  }

  updateCode(id: string, code: string): void {
    const tab = this.tabs.find(t => t.id === id);
    if (tab && tab.code !== code) {
      tab.code = code;
      this.persist();
    }
  }

  renameTab(id: string, title: string): void {
    const tab = this.tabs.find(t => t.id === id);
    const trimmed = title.trim();
    if (tab && trimmed && tab.title !== trimmed) {
      tab.title = trimmed.slice(0, 60);
      this.persist();
    }
  }

  private generateId(): string {
    return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private persist(): void {
    void this.storage.update(STORAGE_KEY, {
      tabs: this.tabs,
      activeTabId: this.activeTabId
    });
    this.emitter.fire();
  }
}
