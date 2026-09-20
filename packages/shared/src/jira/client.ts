export interface JiraClientConfig {
  baseUrl?: string;
  apiToken?: string;
  email?: string;
  edgeUrl?: string;
  fetchFn?: typeof fetch;
  maxRetries?: number;
}

export class JiraClient {
  private baseUrl: string;
  private authHeader: string;
  private fetchFn: typeof fetch;
  private maxRetries: number;

  constructor(config: JiraClientConfig = {}) {
    this.baseUrl = config.baseUrl || "https://api.atlassian.com";
    this.fetchFn = config.fetchFn || globalThis.fetch;
    this.maxRetries = config.maxRetries ?? 3;

    if (config.email && config.apiToken) {
      const basic = Buffer.from(`${config.email}:${config.apiToken}`).toString("base64");
      this.authHeader = `Basic ${basic}`;
    } else if (config.apiToken) {
      this.authHeader = `Bearer ${config.apiToken}`;
    } else {
      this.authHeader = "";
    }
  }

  private async request(path: string, options: RequestInit = {}): Promise<any> {
    const url = `${this.baseUrl}${path}`;
    let attempt = 0;

    while (attempt <= this.maxRetries) {
      try {
        const headers: Record<string, string> = {
          "Accept": "application/json",
          "Content-Type": "application/json",
          ...(options.headers as Record<string, string> || {}),
        };

        if (this.authHeader && !headers["Authorization"]) {
          headers["Authorization"] = this.authHeader;
        }

        const response = await this.fetchFn(url, {
          ...options,
          headers,
        });

        if (response.status === 429) {
          attempt++;
          if (attempt > this.maxRetries) {
            throw new Error(`Jira API rate limited (429) after ${this.maxRetries} retries`);
          }
          const retryAfterSec = parseInt(response.headers.get("Retry-After") || "1", 10);
          const jitterMs = Math.floor(Math.random() * 200);
          const delayMs = (retryAfterSec * 1000) + jitterMs;
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }

        if (!response.ok) {
          const errorBody = await response.text();
          throw new Error(`Jira API error ${response.status} ${response.statusText}: ${errorBody}`);
        }

        if (response.status === 204) {
          return null;
        }

        return await response.json();
      } catch (err: any) {
        if (attempt >= this.maxRetries || err.message?.includes("Jira API error 4")) {
          throw err;
        }
        attempt++;
        const backoffMs = Math.pow(2, attempt) * 100 + Math.floor(Math.random() * 50);
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }
  }

  /**
   * Introspect project create metadata (SHD-SYNC-005)
   */
  public async getCreateMeta(projectKey: string): Promise<any> {
    return this.request(
      `/rest/api/3/issue/createmeta?projectKeys=${encodeURIComponent(projectKey)}&expand=projects.issuetypes.fields`
    );
  }

  /**
   * Create an issue in Jira
   */
  public async createIssue(fields: Record<string, any>): Promise<{ id: string; key: string; self: string }> {
    return this.request("/rest/api/3/issue", {
      method: "POST",
      body: JSON.stringify({ fields }),
    });
  }

  /**
   * Update an existing issue in Jira
   */
  public async updateIssue(issueKey: string, fields: Record<string, any>): Promise<void> {
    return this.request(`/rest/api/3/issue/${encodeURIComponent(issueKey)}`, {
      method: "PUT",
      body: JSON.stringify({ fields }),
    });
  }

  /**
   * Add a comment to an issue
   */
  public async addComment(issueKey: string, bodyADF: any): Promise<any> {
    return this.request(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`, {
      method: "POST",
      body: JSON.stringify({ body: bodyADF }),
    });
  }

  /**
   * Fetch available transitions for an issue
   */
  public async getTransitions(issueKey: string): Promise<Array<{ id: string; name: string; to: { name: string } }>> {
    const res = await this.request(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`);
    return res.transitions || [];
  }

  /**
   * Execute a status transition
   */
  public async transitionIssue(issueKey: string, transitionId: string): Promise<void> {
    return this.request(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`, {
      method: "POST",
      body: JSON.stringify({
        transition: { id: transitionId },
      }),
    });
  }
}
