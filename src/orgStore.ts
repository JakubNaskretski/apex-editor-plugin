import * as vscode from 'vscode';

const GLOBAL_KEY = 'apexEditor.selectedOrg.v1';

export class OrgStore {
  constructor(private readonly memento: vscode.Memento) {}

  get(): string | undefined {
    return this.memento.get<string>(GLOBAL_KEY);
  }

  async set(username: string | undefined): Promise<void> {
    await this.memento.update(GLOBAL_KEY, username);
  }
}
