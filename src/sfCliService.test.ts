import { describe, expect, it, vi } from 'vitest';

// SfCliService now delegates classification to kit/orgs, which imports `vscode`
// at module top level for its setting/UI helpers. The functions under test are
// pure; mock the vscode surface so the import chain resolves under Node.
const { vscodeMock } = vi.hoisted(() => ({
  vscodeMock: {
    workspace: {
      getConfiguration: vi.fn(() => ({ get: vi.fn(), update: vi.fn() })),
      onDidChangeConfiguration: vi.fn()
    },
    window: { createStatusBarItem: vi.fn(), showQuickPick: vi.fn(), showWarningMessage: vi.fn() },
    ConfigurationTarget: { Global: 1 },
    StatusBarAlignment: { Left: 1 },
    ThemeColor: class { constructor(public id: string) {} },
    EventEmitter: class { event = vi.fn(); fire = vi.fn(); dispose = vi.fn(); }
  }
}));
vi.mock('vscode', () => vscodeMock);

import { SfCliService, OrgInfo } from './sfCliService';

const org = (o: Partial<OrgInfo>): OrgInfo => ({
  username: 'u@example.com', orgId: '00D', instanceUrl: '', ...o
});

describe('SfCliService.kindOf / isLikelyProduction', () => {
  it('classifies scratch and sandbox from their bucket flags', () => {
    expect(SfCliService.kindOf(org({ isScratch: true }))).toBe('scratch');
    expect(SfCliService.kindOf(org({ isSandbox: true }))).toBe('sandbox');
    expect(SfCliService.isLikelyProduction(org({ isScratch: true }))).toBe(false);
    expect(SfCliService.isLikelyProduction(org({ isSandbox: true }))).toBe(false);
  });

  it('classifies sandbox / scratch from the My Domain host', () => {
    expect(SfCliService.kindOf(org({ instanceUrl: 'https://acme--dev.sandbox.my.salesforce.com' }))).toBe('sandbox');
    expect(SfCliService.kindOf(org({ instanceUrl: 'https://efficiency-ability-1234.scratch.my.salesforce.com' }))).toBe('scratch');
    expect(SfCliService.kindOf(org({ instanceUrl: 'https://test.salesforce.com' }))).toBe('sandbox');
  });

  it('treats a real non-sandbox/scratch host as production (over-warn)', () => {
    expect(SfCliService.kindOf(org({ instanceUrl: 'https://acme.my.salesforce.com' }))).toBe('prod');
    expect(SfCliService.kindOf(org({ instanceUrl: 'https://ap5.salesforce.com' }))).toBe('prod');
    expect(SfCliService.isLikelyProduction(org({ instanceUrl: 'https://acme.my.salesforce.com' }))).toBe(true);
  });

  it('treats an undefined org as unknown ⇒ PRODUCTION (over-warn root fix)', () => {
    // Was 'other' / false, which silently bypassed the production guard when a
    // palette run fired before the org list loaded. The kit now
    // classifies an unclassifiable org as 'unknown' and counts it as production.
    expect(SfCliService.kindOf(undefined)).toBe('unknown');
    expect(SfCliService.isLikelyProduction(undefined)).toBe(true);
  });
});
