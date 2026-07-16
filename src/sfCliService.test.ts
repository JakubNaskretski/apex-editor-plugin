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

import { SfCliService, OrgInfo, SfCliError } from './sfCliService';

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

describe('SfCliService.executeAnonymous failure payload', () => {
  const withEnvelope = (envelope: unknown) => {
    const svc = new SfCliService();
    vi.spyOn(svc as unknown as { runJson: () => Promise<unknown> }, 'runJson')
      .mockResolvedValue(envelope);
    return svc;
  };

  it('returns the payload under `data` on a thrown runtime failure (no `result`)', async () => {
    // `apex run --json` THROWS on a runtime failure, so the payload lands under
    // `data` with name `executeRuntimeFailure` and there is no `result`. We must
    // render it, not surface the bare error name.
    const svc = withEnvelope({
      status: 1,
      name: 'executeRuntimeFailure',
      message: 'Execution failed at this code:\n\nSystem.NullPointerException',
      data: { success: false, compiled: true, exceptionMessage: 'boom', exceptionStackTrace: 'AnonymousBlock: line 1', logs: 'USER_DEBUG' }
    });
    const result = await svc.executeAnonymous('x;', 'u@example.com');
    expect(result.compiled).toBe(true);
    expect(result.success).toBe(false);
    expect(result.exceptionMessage).toBe('boom');
  });

  it('throws the envelope message (not the terse name) when neither result nor data is present', async () => {
    const svc = withEnvelope({ status: 1, name: 'NoOrgFound', message: 'No default environment found.' });
    await expect(svc.executeAnonymous('x;', 'u@example.com')).rejects.toThrow(SfCliError);
    await expect(svc.executeAnonymous('x;', 'u@example.com')).rejects.toThrow('No default environment found.');
  });
});
