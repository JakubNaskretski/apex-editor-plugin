import * as https from 'https';
import { SfCliService } from './sfCliService';

interface ToolingQueryResult<T> {
  totalSize: number;
  records: T[];
}

export class TraceService {
  constructor(private readonly sf: SfCliService) {}

  /** Per-org "we've ensured a trace flag until this epoch-ms" cache, so we don't
   *  issue 2-3 Tooling API calls on every single execution. */
  private readonly ensuredUntil = new Map<string, number>();

  // Ensures a DEVELOPER_LOG trace flag exists for the current user.
  // Best-effort: swallows all errors so execution is never blocked.
  async ensureTraceFlag(targetOrg: string, apiVersion: string): Promise<void> {
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
        `SELECT Id FROM User WHERE Username = '${username.replace(/'/g, "\\'")}'`
      );
      const userId = userResult.records[0]?.Id;
      if (!userId) {
        return;
      }

      const flagResult = await this.toolingQuery<{ Id: string }>(
        instanceUrl, accessToken, apiVersion,
        `SELECT Id FROM TraceFlag WHERE TracedEntityId = '${userId}' AND LogType = 'DEVELOPER_LOG' AND ExpirationDate > TODAY`
      );
      if (flagResult.records.length > 0) {
        // A flag already exists (expiry > TODAY). Re-verify in ~10 min rather than
        // re-querying on every run, since we don't know its exact expiry here.
        this.ensuredUntil.set(targetOrg, Date.now() + 10 * 60 * 1000);
        return;
      }

      const debugLevelId = await this.getOrCreateDebugLevel(instanceUrl, accessToken, apiVersion);
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
      });
      // Cache until shortly before the flag expires.
      this.ensuredUntil.set(targetOrg, expiry.getTime() - 5 * 60 * 1000);
    } catch {
      // Intentionally swallowed — trace flag setup is best-effort
    }
  }

  private async getOrCreateDebugLevel(
    instanceUrl: string, accessToken: string, apiVersion: string
  ): Promise<string | undefined> {
    const existing = await this.toolingQuery<{ Id: string }>(
      instanceUrl, accessToken, apiVersion,
      `SELECT Id FROM DebugLevel WHERE DeveloperName = 'ApexEditorDefault'`
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
      }
    );
    return created?.id;
  }

  private toolingQuery<T>(
    instanceUrl: string, accessToken: string, apiVersion: string, query: string
  ): Promise<ToolingQueryResult<T>> {
    return this.request<ToolingQueryResult<T>>(
      instanceUrl, accessToken, 'GET',
      `/services/data/v${apiVersion}/tooling/query?q=${encodeURIComponent(query)}`
    );
  }

  private toolingPost<T>(
    instanceUrl: string, accessToken: string, apiVersion: string, sobject: string, body: unknown
  ): Promise<T> {
    return this.request<T>(
      instanceUrl, accessToken, 'POST',
      `/services/data/v${apiVersion}/tooling/sobjects/${sobject}`,
      body
    );
  }

  private request<T>(
    instanceUrl: string, accessToken: string, method: string, path: string, body?: unknown
  ): Promise<T> {
    return new Promise((resolve, reject) => {
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
              // Surface (to the caller's try/catch, which swallows) instead of
              // JSON.parse'ing a Salesforce error array into the wrong shape.
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
      req.on('error', reject);
      if (bodyStr !== undefined) {
        req.write(bodyStr);
      }
      req.end();
    });
  }
}
