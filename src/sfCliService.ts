import { spawn } from 'child_process';
import * as os from 'os';

export interface OrgInfo {
  username: string;
  alias?: string;
  orgId: string;
  instanceUrl: string;
  isDefaultUsername?: boolean;
  isDefaultDevHubUsername?: boolean;
  connectedStatus?: string;
  /** Tagged from the `sf org list` bucket the org came from. */
  isSandbox?: boolean;
  isScratch?: boolean;
}

export type OrgKind = 'prod' | 'sandbox' | 'scratch' | 'other';

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

export class SfCliError extends Error {
  constructor(message: string, public readonly stderr?: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'SfCliError';
  }
}

export class SfCliCancelledError extends SfCliError {
  constructor() {
    super('Execution cancelled');
    this.name = 'SfCliCancelledError';
  }
}

interface RunOptions {
  timeoutMs?: number;
  stdin?: string;
  signal?: AbortSignal;
}

interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

export class SfCliService {
  private readonly defaultTimeoutMs = 60_000;

  async getOrgDetails(targetOrg: string): Promise<OrgDetails> {
    const json = await this.runJson<{ result: OrgDetails }>(
      ['org', 'display', '--target-org', targetOrg, '--json']
    );
    return json.result;
  }

  async listOrgs(): Promise<OrgInfo[]> {
    const result = await this.runJson<{
      result: {
        nonScratchOrgs?: OrgInfo[];
        scratchOrgs?: OrgInfo[];
        sandboxes?: OrgInfo[];
        other?: OrgInfo[];
      };
    }>(['org', 'list', '--json']);

    const buckets = result.result ?? {};
    // Merge by username, tagging scratch/sandbox from the bucket each org came from
    // (the most reliable signal) so production can be detected for the run guard.
    const byUser = new Map<string, OrgInfo>();
    const add = (orgs: OrgInfo[] | undefined, extra: Partial<OrgInfo>): void => {
      for (const o of orgs ?? []) {
        if (!o?.username) { continue; }
        const prev = byUser.get(o.username) ?? ({} as OrgInfo);
        byUser.set(o.username, {
          ...prev,
          ...o,
          isSandbox: extra.isSandbox || o.isSandbox || prev.isSandbox,
          isScratch: extra.isScratch || o.isScratch || prev.isScratch
        });
      }
    };
    add(buckets.nonScratchOrgs, {});
    add(buckets.scratchOrgs, { isScratch: true });
    add(buckets.sandboxes, { isSandbox: true });
    add(buckets.other, {});
    return [...byUser.values()];
  }

  /** Production unless we can tell it's a sandbox/scratch. Errs toward "prod"
   *  (over-warn) so a live run isn't fired silently against a production org. */
  static kindOf(org: OrgInfo | undefined): OrgKind {
    if (!org) { return 'other'; }
    if (org.isScratch) { return 'scratch'; }
    if (org.isSandbox) { return 'sandbox'; }
    const url = (org.instanceUrl ?? '').toLowerCase();
    if (/\.scratch\./.test(url)) { return 'scratch'; }
    if (/\.sandbox\.|\.cs\d+\.|test\.salesforce\.com/.test(url)) { return 'sandbox'; }
    return 'prod';
  }

  static isLikelyProduction(org: OrgInfo | undefined): boolean {
    return SfCliService.kindOf(org) === 'prod';
  }

  async executeAnonymous(apexCode: string, targetOrg: string, timeoutMs?: number, signal?: AbortSignal): Promise<ApexExecuteResult> {
    const fs = await import('fs/promises');
    const path = await import('path');
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apex-editor-'));
    const tmpFile = path.join(tmpDir, 'script.apex');
    try {
      await fs.writeFile(tmpFile, apexCode, 'utf8');
      const json = await this.runJson<{ result?: ApexExecuteResult; status?: number }>(
        ['apex', 'run', '--file', tmpFile, '--target-org', targetOrg, '--json'],
        { timeoutMs, signal }
      );
      if (!json.result) {
        throw new SfCliError('sf apex run returned no result payload');
      }
      return json.result;
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async runJson<T>(args: string[], options: RunOptions = {}): Promise<T> {
    const { stdout, stderr, code } = await this.run(args, options);
    if (/\bENOENT\b/.test(stderr) || /spawn sf\b/i.test(stderr)) {
      throw new SfCliError('Salesforce CLI (sf) not found on PATH. Install it and reload VS Code.', stderr);
    }
    const trimmed = stdout.trim();
    if (!trimmed) {
      throw new SfCliError(`sf ${args.join(' ')} produced no output (exit ${code})`, stderr);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      throw new SfCliError(`Failed to parse JSON from sf ${args.join(' ')}`, stderr, err);
    }
    // `sf --json` writes an error envelope ({status!=0, message/name}) to stdout
    // even on failure — surface it instead of returning it as a success result.
    // BUT some commands (notably `apex run`) return a populated `result` even on a
    // non-zero status (compile errors / uncaught exceptions); the caller needs that
    // structured payload, so only treat the envelope as a hard failure when there
    // is no `result` to interpret.
    const env = parsed as { status?: number; message?: unknown; name?: unknown; result?: unknown };
    const hasResult = env && env.result !== undefined && env.result !== null;
    if (env && typeof env.status === 'number' && env.status !== 0 && !hasResult) {
      const msg = (typeof env.message === 'string' && env.message)
        || (typeof env.name === 'string' && env.name)
        || `sf ${args.join(' ')} failed (status ${env.status})`;
      throw new SfCliError(String(msg), stderr);
    }
    if (code !== 0 && !hasResult && (!env || env.status === undefined)) {
      throw new SfCliError(`sf ${args.join(' ')} exited with code ${code}`, stderr);
    }
    return parsed as T;
  }

  private run(args: string[], options: RunOptions = {}): Promise<RunResult> {
    return new Promise((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(new SfCliCancelledError());
        return;
      }
      const child = spawn('sf', args, { shell: false });
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) { return; }
        settled = true;
        child.kill('SIGTERM');
        reject(new SfCliError(`sf ${args.join(' ')} timed out after ${options.timeoutMs ?? this.defaultTimeoutMs}ms`));
      }, options.timeoutMs ?? this.defaultTimeoutMs);

      // User-initiated cancellation: kill the child and reject distinctly so the
      // caller can show "Cancelled" rather than a scary error.
      const onAbort = (): void => {
        if (settled) { return; }
        settled = true;
        clearTimeout(timeout);
        child.kill('SIGTERM');
        reject(new SfCliCancelledError());
      };
      options.signal?.addEventListener('abort', onAbort, { once: true });

      // Collect raw Buffers and decode once so multi-byte UTF-8 sequences split
      // across stream chunks (common in large debug logs) aren't corrupted.
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      child.stdout.on('data', chunk => { stdoutChunks.push(Buffer.from(chunk)); });
      child.stderr.on('data', chunk => { stderrChunks.push(Buffer.from(chunk)); });

      child.on('error', err => {
        if (settled) { return; }
        settled = true;
        clearTimeout(timeout);
        reject(new SfCliError(`Failed to launch sf CLI: ${(err as Error).message}`, undefined, err));
      });

      child.on('close', code => {
        if (settled) { return; }
        settled = true;
        clearTimeout(timeout);
        resolve({
          stdout: Buffer.concat(stdoutChunks).toString('utf8'),
          stderr: Buffer.concat(stderrChunks).toString('utf8'),
          code: code ?? -1
        });
      });

      if (options.stdin) {
        child.stdin.write(options.stdin);
        child.stdin.end();
      }
    });
  }
}
