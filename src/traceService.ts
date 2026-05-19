import * as https from 'https';
import { SfCliService } from './sfCliService';

interface ToolingQueryResult<T> {
  totalSize: number;
  records: T[];
}

export class TraceService {
  constructor(private readonly sf: SfCliService) {}

  // Ensures a DEVELOPER_LOG trace flag exists for the current user.
  // Best-effort: swallows all errors so execution is never blocked.
  async ensureTraceFlag(targetOrg: string, apiVersion: string): Promise<void> {
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
          let data = '';
          res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
          res.on('end', () => {
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
