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
}

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

interface RunOptions {
  timeoutMs?: number;
  stdin?: string;
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
    const all = [
      ...(buckets.nonScratchOrgs ?? []),
      ...(buckets.scratchOrgs ?? []),
      ...(buckets.sandboxes ?? []),
      ...(buckets.other ?? [])
    ];

    const seen = new Set<string>();
    return all.filter(org => {
      if (!org?.username || seen.has(org.username)) {
        return false;
      }
      seen.add(org.username);
      return true;
    });
  }

  async executeAnonymous(apexCode: string, targetOrg: string, timeoutMs?: number): Promise<ApexExecuteResult> {
    const fs = await import('fs/promises');
    const path = await import('path');
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apex-editor-'));
    const tmpFile = path.join(tmpDir, 'script.apex');
    try {
      await fs.writeFile(tmpFile, apexCode, 'utf8');
      const json = await this.runJson<{ result?: ApexExecuteResult; status?: number }>(
        ['apex', 'run', '--file', tmpFile, '--target-org', targetOrg, '--json'],
        { timeoutMs }
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
    if (code !== 0 && !stdout) {
      throw new SfCliError(`sf ${args.join(' ')} exited with code ${code}`, stderr);
    }
    try {
      return JSON.parse(stdout) as T;
    } catch (err) {
      throw new SfCliError(`Failed to parse JSON from sf ${args.join(' ')}`, stderr, err);
    }
  }

  private run(args: string[], options: RunOptions = {}): Promise<RunResult> {
    return new Promise((resolve, reject) => {
      const child = spawn('sf', args, { shell: false });
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new SfCliError(`sf ${args.join(' ')} timed out after ${options.timeoutMs ?? this.defaultTimeoutMs}ms`));
      }, options.timeoutMs ?? this.defaultTimeoutMs);

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', chunk => { stdout += chunk.toString(); });
      child.stderr.on('data', chunk => { stderr += chunk.toString(); });

      child.on('error', err => {
        clearTimeout(timeout);
        reject(new SfCliError(`Failed to launch sf CLI: ${(err as Error).message}`, undefined, err));
      });

      child.on('close', code => {
        clearTimeout(timeout);
        resolve({ stdout, stderr, code: code ?? -1 });
      });

      if (options.stdin) {
        child.stdin.write(options.stdin);
        child.stdin.end();
      }
    });
  }
}
