import * as https from 'https';
import { SfCliService } from './sfCliService';

interface ToolingQueryResult<T> {
  totalSize: number;
  records: T[];
}

export interface TraceOptions {
  /** Aborting cancels the in-flight Tooling HTTP request (threads the run's
   *  AbortController through). */
  signal?: AbortSignal;
  /** Per-request timeout in ms — the same `executeTimeoutMs` the run uses. Guards
   *  against an unreachable instance URL wedging the UI for the OS TCP timeout. */
  timeoutMs?: number;
  /** Called (at most once per org) when trace setup fails, so the caller can
   *  surface a non-fatal warning. Execution still proceeds. */
  onWarn?: (message: string) => void;
}

export class TraceService {
  constructor(private readonly sf: SfCliService) {}

  /** Per-org "we've ensured a trace flag until this epoch-ms" cache, so we don't
   *  issue 2-3 Tooling API calls on every single execution. */
  private readonly ensuredUntil = new Map<string, number>();
  /** Orgs we've already warned about a trace-setup failure for, so the warning
   *  fires once rather than on every run. */
  private readonly warned = new Set<string>();

  // Ensures a DEVELOPER_LOG trace flag exists for the current user.
  // Best-effort: a failure is non-fatal (execution still proceeds) but is now
  // surfaced once via opts.onWarn instead of being swallowed silently. The run's
  // AbortSignal + per-request timeout thread through opts into every HTTP call.
  async ensureTraceFlag(targetOrg: string, apiVersion: string, opts: TraceOptions = {}): Promise<void> {
    // Skip the Tooling round-trips if we already ensured a flag for this org
    // recently (re-verify periodically in case it was deleted/expired).
    if ((this.ensuredUntil.get(targetOrg) ?? 0) > Date.now()) {
      return;
    }
    try {
      const org = await this.sf.getOrgDetails(targetOrg);
      const { accessToken, instanceUrl, username } = org;

      const userResult = await this.toolingQuery<{ Id: string }>(
        instanceUrl, accessToken, apiVersion,
        `SELECT Id FROM User WHERE Username = '${username.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`,
        opts
      );
      const userId = userResult.records[0]?.Id;
      if (!userId) {
        return;
      }

      const flagResult = await this.toolingQuery<{ Id: string }>(
        instanceUrl, accessToken, apiVersion,
        `SELECT Id FROM TraceFlag WHERE TracedEntityId = '${userId}' AND LogType = 'DEVELOPER_LOG' AND ExpirationDate > TODAY`,
        opts
      );
      if (flagResult.records.length > 0) {
        // A flag already exists (expiry > TODAY). Re-verify in ~10 min rather than
        // re-querying on every run, since we don't know its exact expiry here.
        this.ensuredUntil.set(targetOrg, Date.now() + 10 * 60 * 1000);
        return;
      }

      const debugLevelId = await this.getOrCreateDebugLevel(instanceUrl, accessToken, apiVersion, opts);
      if (!debugLevelId) {
        return;
      }

      const now = new Date();
      const expiry = new Date(now.getTime() + 30 * 60 * 1000);
      await this.toolingPost(instanceUrl, accessToken, apiVersion, 'TraceFlag', {
        TracedEntityId: userId,
        DebugLevelId: debugLevelId,
        LogType: 'DEVELOPER_LOG',
        StartDate: now.toISOString(),
        ExpirationDate: expiry.toISOString(),
      }, opts);
      // Cache until shortly before the flag expires.
      this.ensuredUntil.set(targetOrg, expiry.getTime() - 5 * 60 * 1000);
      // A prior transient failure cleared — allow a future warning again.
      this.warned.delete(targetOrg);
    } catch (err) {
      // Non-fatal: the anonymous Apex still runs, it just may not capture a debug
      // log. Cancellation is not a failure. Warn at most once per org.
      const message = err instanceof Error ? err.message : String(err);
      const cancelled = /cancel/i.test(message) || (opts.signal?.aborted ?? false);
      if (!cancelled && opts.onWarn && !this.warned.has(targetOrg)) {
        this.warned.add(targetOrg);
        opts.onWarn(`could not set a debug TraceFlag (${message}). Running anyway; the debug log may be empty.`);
      }
    }
  }

  private async getOrCreateDebugLevel(
    instanceUrl: string, accessToken: string, apiVersion: string, opts: TraceOptions
  ): Promise<string | undefined> {
    const existing = await this.toolingQuery<{ Id: string }>(
      instanceUrl, accessToken, apiVersion,
      `SELECT Id FROM DebugLevel WHERE DeveloperName = 'ApexEditorDefault'`,
      opts
    );
    if (existing.records.length > 0) {
      return existing.records[0].Id;
    }
    const created = await this.toolingPost<{ id: string }>(
      instanceUrl, accessToken, apiVersion, 'DebugLevel', {
        MasterLabel: 'ApexEditorDefault',
        DeveloperName: 'ApexEditorDefault',
        ApexCode: 'DEBUG',
        ApexProfiling: 'INFO',
        Callout: 'INFO',
        Database: 'INFO',
        System: 'DEBUG',
        Validation: 'INFO',
        Visualforce: 'INFO',
        Workflow: 'INFO',
        NBA: 'INFO',
        Wave: 'INFO',
      },
      opts
    );
    return created?.id;
  }

  private toolingQuery<T>(
    instanceUrl: string, accessToken: string, apiVersion: string, query: string, opts: TraceOptions
  ): Promise<ToolingQueryResult<T>> {
    return this.request<ToolingQueryResult<T>>(
      instanceUrl, accessToken, 'GET',
      `/services/data/v${apiVersion}/tooling/query?q=${encodeURIComponent(query)}`,
      undefined, opts
    );
  }

  private toolingPost<T>(
    instanceUrl: string, accessToken: string, apiVersion: string, sobject: string, body: unknown, opts: TraceOptions
  ): Promise<T> {
    return this.request<T>(
      instanceUrl, accessToken, 'POST',
      `/services/data/v${apiVersion}/tooling/sobjects/${sobject}`,
      body, opts
    );
  }

  private request<T>(
    instanceUrl: string, accessToken: string, method: string, path: string, body: unknown, opts: TraceOptions
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      // Fail fast if the run was already cancelled before this call started.
      if (opts.signal?.aborted) {
        reject(new Error('Trace request cancelled'));
        return;
      }
      const url = new URL(path, instanceUrl);
      const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;
      const req = https.request(
        {
          hostname: url.hostname,
          path: url.pathname + url.search,
          method,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            ...(bodyStr !== undefined ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
          },
        },
        res => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => { chunks.push(Buffer.from(chunk)); });
          res.on('end', () => {
            const data = Buffer.concat(chunks).toString('utf8');
            const status = res.statusCode ?? 0;
            if (status < 200 || status >= 300) {
              // Surface to the caller's try/catch (which warns non-fatally)
              // instead of JSON.parse'ing a Salesforce error array into the
              // wrong shape.
              reject(new Error(`Tooling API ${status}: ${data.slice(0, 300)}`));
              return;
            }
            try {
              resolve(JSON.parse(data) as T);
            } catch (e) {
              reject(e);
            }
          });
        }
      );

      // Timeout: an unreachable instance URL used to wedge the UI for the OS TCP
      // timeout with no way to cancel. Bound the socket to the
      // run's own executeTimeoutMs and destroy it on expiry.
      const timeoutMs = opts.timeoutMs;
      if (timeoutMs && timeoutMs > 0) {
        req.setTimeout(timeoutMs, () => {
          req.destroy(new Error(`Tooling API request timed out after ${timeoutMs}ms`));
        });
      }

      // Cancellation: thread the run's AbortSignal so Cancel also aborts an
      // in-flight TraceFlag request.
      const onAbort = (): void => { req.destroy(new Error('Trace request cancelled')); };
      if (opts.signal) {
        opts.signal.addEventListener('abort', onAbort, { once: true });
        req.on('close', () => opts.signal?.removeEventListener('abort', onAbort));
      }

      req.on('error', reject);
      if (bodyStr !== undefined) {
        req.write(bodyStr);
      }
      req.end();
    });
  }
}
