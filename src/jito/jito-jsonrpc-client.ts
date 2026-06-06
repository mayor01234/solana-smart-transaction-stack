import type { VersionedTransaction } from '@solana/web3.js';
import type { AppConfig } from '../config.js';
import type { JitoBundleClient, NextLeaderInfo } from './jito-bundle-client.js';
import { RateLimiter } from './rate-limiter.js';

/**
 * Jito JSON-RPC adapter (over fetch). Zero extra dependencies; always available.
 * Used when JITO_TRANSPORT=jsonrpc, or as a fallback if the gRPC client fails to initialise.
 */
export class JitoJsonRpcClient implements JitoBundleClient {
  readonly transport = 'jsonrpc' as const;
  // Public Jito endpoint allows ~1 request/second; pace calls to stay under it.
  private readonly limiter = new RateLimiter(1100);
  constructor(private readonly config: AppConfig) {}

  private request<T>(method: string, params: unknown[] = []): Promise<T> {
    return this.limiter.run(async () => {
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
    });
  }

  async getTipAccounts(): Promise<string[]> {
    return this.request<string[]>('getTipAccounts');
  }

  async sendBundle(transactions: VersionedTransaction[]): Promise<string> {
    const serialized = transactions.map((tx) => Buffer.from(tx.serialize()).toString('base64'));
    return this.request<string>('sendBundle', [serialized, { encoding: 'base64' }]);
  }

  async getInflightBundleStatuses(bundleIds: string[]): Promise<unknown> {
    return this.request('getInflightBundleStatuses', [bundleIds]);
  }

  async getBundleStatuses(bundleIds: string[]): Promise<unknown> {
    return this.request('getBundleStatuses', [bundleIds]);
  }

  async getNextScheduledLeader(): Promise<NextLeaderInfo> {
    return this.request<NextLeaderInfo>('getNextScheduledLeader');
  }

  close(): void {
    /* no persistent connection */
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
