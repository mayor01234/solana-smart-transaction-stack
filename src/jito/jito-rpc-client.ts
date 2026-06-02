import type { AppConfig } from '../config.js';

export class JitoRpcClient {
  constructor(private readonly config: AppConfig) {}

  async request<T>(method: string, params: unknown[] = []): Promise<T> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.config.JITO_AUTH_UUID) headers['x-jito-auth'] = this.config.JITO_AUTH_UUID;
    const res = await fetch(this.urlForMethod(method), {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
    });
    if (!res.ok) throw new Error(`Jito ${method} HTTP ${res.status}: ${await res.text()}`);
    const json: any = await res.json();
    if (json.error) throw new Error(`Jito ${method} error: ${JSON.stringify(json.error)}`);
    return json.result as T;
  }

  async getTipAccounts(): Promise<string[]> {
    return this.request<string[]>('getTipAccounts');
  }

  async sendBundle(serializedTransactions: string[]): Promise<string> {
    return this.request<string>('sendBundle', [serializedTransactions, { encoding: 'base64' }]);
  }

  async getInflightBundleStatuses(bundleIds: string[]): Promise<any> {
    return this.request<any>('getInflightBundleStatuses', [bundleIds]);
  }

  async getBundleStatuses(bundleIds: string[]): Promise<any> {
    return this.request<any>('getBundleStatuses', [bundleIds]);
  }

  async getNextScheduledLeader(): Promise<{ currentSlot?: number; nextLeaderSlot?: number; nextLeaderIdentity?: string }> {
    return this.request('getNextScheduledLeader');
  }

  private urlForMethod(method: string): string {
    const base = this.config.JITO_BLOCK_ENGINE_URL.replace(/\/api\/v1\/.*$/, '');
    switch (method) {
      case 'sendBundle':
        return `${base}/api/v1/bundles`;
      case 'getTipAccounts':
        return `${base}/api/v1/getTipAccounts`;
      case 'getBundleStatuses':
        return `${base}/api/v1/getBundleStatuses`;
      case 'getInflightBundleStatuses':
        return `${base}/api/v1/getInflightBundleStatuses`;
      case 'getNextScheduledLeader':
        return `${base}/api/v1/getNextScheduledLeader`;
      default:
        return this.config.JITO_BLOCK_ENGINE_URL;
    }
  }
}
