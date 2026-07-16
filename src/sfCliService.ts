import * as os from 'os';
import { SfCliService as KitSfCliService, SfCliError, SfCliCancelledError } from './kit/sfCli';
import type { OrgInfo } from './kit/sfCli';
import { kindOf, isLikelyProduction, type OrgKind } from './kit/orgs';

// Re-export the kit types/classes the rest of the plugin imports from here, so
// adopting the kit didn't ripple import paths across the codebase. `OrgKind`'s
// unknown-bucket is now 'unknown' (was 'other') — the root fix:
// an org we can't classify counts as PRODUCTION for the run guard.
export { SfCliError, SfCliCancelledError };
export type { OrgInfo, OrgKind };

export interface ApexExecuteResult {
  success: boolean;
  compiled: boolean;
  compileProblem: string;
  exceptionMessage: string;
  exceptionStackTrace: string;
  logs: string;
  line: number;
  column: number;
}

export interface OrgDetails {
  id: string;
  accessToken: string;
  instanceUrl: string;
  username: string;
  alias?: string;
}

/**
 * Apex-editor's Salesforce CLI facade. The spawn/timeout/JSON plumbing (and the
 * Windows `sf.cmd` resolution fix) now lives in the shared kit `SfCliService`;
 * this subclass keeps only the two apex-specific commands (`org display` for the
 * Tooling access token, `apex run` for anonymous execution) and re-surfaces the
 * org classification helpers as statics for call-site compatibility.
 */
export class SfCliService extends KitSfCliService {
  constructor() {
    // Keep apex-editor's historical 60s default (the family kit defaults to 180s
    // for slower deploy/retrieve work); anonymous Apex is interactive and short.
    super({ defaultTimeoutMs: 60_000 });
  }

  /** Production unless we can positively tell it's a sandbox/scratch. Unknown
   *  (undefined) orgs count as production — over-warn. Delegates to kit orgs.ts. */
  static kindOf(org: OrgInfo | undefined): OrgKind {
    return kindOf(org);
  }

  static isLikelyProduction(org: OrgInfo | undefined): boolean {
    return isLikelyProduction(org);
  }

  async getOrgDetails(targetOrg: string): Promise<OrgDetails> {
    const json = await this.runJson<{ result?: OrgDetails; status?: number; name?: string; message?: string }>(
      ['org', 'display', '--target-org', targetOrg, '--json']
    );
    if (!json.result) {
      const msg = json.name || json.message || `sf org display returned no result (status ${json.status ?? '?'})`;
      throw new SfCliError(String(msg));
    }
    return json.result;
  }

  async executeAnonymous(apexCode: string, targetOrg: string, timeoutMs?: number, signal?: AbortSignal): Promise<ApexExecuteResult> {
    const fs = await import('fs/promises');
    const path = await import('path');
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apex-editor-'));
    const tmpFile = path.join(tmpDir, 'script.apex');
    try {
      await fs.writeFile(tmpFile, apexCode, 'utf8');
      // On success `apex run --json` returns the payload under `result`. On a
      // compile OR runtime failure it THROWS an SfError, so the same structured
      // payload (exceptionMessage/stack/compileProblem/logs) lands under `data`
      // with name `executeCompileFailure`/`executeRuntimeFailure` — there is no
      // `result`. We render either, so a thrown failure flows back through the
      // normal success=false / compiled=false path instead of surfacing as a
      // bare error name. runJson already returns the parsed envelope on non-zero
      // exit, so we DON'T use the envelope-unwrapping runResult() here.
      const json = await this.runJson<{ result?: ApexExecuteResult; data?: ApexExecuteResult; status?: number; name?: string; message?: string }>(
        ['apex', 'run', '--file', tmpFile, '--target-org', targetOrg, '--json'],
        { timeoutMs, signal }
      );
      const payload = json.result ?? json.data;
      if (!payload) {
        // Neither result nor data means a CLI-level failure (bad/expired org,
        // bad project) with nothing structured to render — surface the envelope
        // message (which carries detail), falling back to the terse name.
        const msg = json.message || json.name || 'sf apex run returned no result payload';
        throw new SfCliError(String(msg));
      }
      return payload;
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
