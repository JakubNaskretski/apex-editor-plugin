import { describe, expect, it, vi } from 'vitest';

// TraceService -> SfCliService -> kit/orgs imports `vscode` at module top level.
// Mock it so the import chain resolves under Node (the tests here don't touch
// any vscode API).
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

import { TraceService } from './traceService';

/** A TraceService whose first Tooling step (`getOrgDetails`) is stubbed, so we
 *  can exercise the failure / cancellation / warn-once branches without HTTP. */
function makeService(getOrgDetails: () => Promise<unknown>): TraceService {
  const sf = { getOrgDetails } as unknown as ConstructorParameters<typeof TraceService>[0];
  return new TraceService(sf);
}

describe('TraceService.ensureTraceFlag — non-fatal failures', () => {
  it('never throws when trace setup fails, and warns once', async () => {
    const warn = vi.fn();
    const svc = makeService(() => Promise.reject(new Error('boom')));
    // Two runs against the same org: the failure is swallowed both times, but
    // the warning fires only once (warn-once per org).
    await expect(svc.ensureTraceFlag('u@example.com', '60.0', { onWarn: warn })).resolves.toBeUndefined();
    await expect(svc.ensureTraceFlag('u@example.com', '60.0', { onWarn: warn })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/TraceFlag/i);
    expect(warn.mock.calls[0][0]).toMatch(/boom/);
  });

  it('warns separately for a different org', async () => {
    const warn = vi.fn();
    const svc = makeService(() => Promise.reject(new Error('nope')));
    await svc.ensureTraceFlag('a@example.com', '60.0', { onWarn: warn });
    await svc.ensureTraceFlag('b@example.com', '60.0', { onWarn: warn });
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('does not warn when the failure is a cancellation', async () => {
    const warn = vi.fn();
    const svc = makeService(() => Promise.reject(new Error('Trace request cancelled')));
    await svc.ensureTraceFlag('u@example.com', '60.0', { onWarn: warn });
    expect(warn).not.toHaveBeenCalled();
  });

  it('does not warn when the run signal is already aborted', async () => {
    const warn = vi.fn();
    const svc = makeService(() => Promise.reject(new Error('some network error')));
    const ac = new AbortController();
    ac.abort();
    await svc.ensureTraceFlag('u@example.com', '60.0', { onWarn: warn, signal: ac.signal });
    expect(warn).not.toHaveBeenCalled();
  });
});
