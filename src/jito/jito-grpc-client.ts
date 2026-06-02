import type { Keypair, VersionedTransaction } from '@solana/web3.js';
// Official Jito TypeScript SDK (recommended bounty resource). jito-ts 4.2.1 ships CommonJS
// with no "exports" map, so these canonical deep subpath imports resolve under NodeNext.
import { searcherClient, type SearcherClient } from 'jito-ts/dist/sdk/block-engine/searcher.js';
import { Bundle } from 'jito-ts/dist/sdk/block-engine/types.js';
import type { AppConfig } from '../config.js';
import { jitoGrpcEndpoint } from '../config.js';
import { loadKeypair } from '../core/keypair.js';
import { logger } from '../logger.js';
import type { BundleResultUpdate, JitoBundleClient, NextLeaderInfo } from './jito-bundle-client.js';

const MAX_BUNDLE_TX = 5;

/**
 * gRPC adapter over the official jito-ts searcher client.
 * Provides the deepest Jito integration: streamed tip accounts, native bundle submission,
 * scheduled-leader lookups, and real-time bundle-result subscriptions.
 */
export class JitoGrpcClient implements JitoBundleClient {
  readonly transport = 'grpc' as const;
  private readonly client: SearcherClient;

  constructor(private readonly config: AppConfig) {
    const endpoint = jitoGrpcEndpoint(config);
    let authKeypair: Keypair | undefined;
    if (config.JITO_AUTH_KEYPATH) {
      authKeypair = loadKeypair(config.JITO_AUTH_KEYPATH);
    }
    // `as any` bridges the web3.js version jito-ts pins (~1.77) and ours (^1.98); the Keypair
    // shape is identical, only the nominal type differs across the duplicated dependency.
    this.client = searcherClient(endpoint, authKeypair as any);
    logger.info({ endpoint, authenticated: Boolean(authKeypair) }, 'Initialised Jito gRPC searcher client.');
  }

  async getTipAccounts(): Promise<string[]> {
    const res = await this.client.getTipAccounts();
    if (!res.ok) throw new Error(`getTipAccounts failed: ${String(res.error)}`);
    return res.value;
  }

  async sendBundle(transactions: VersionedTransaction[]): Promise<string> {
    // Cross-version web3.js bridge (see constructor note): VersionedTransaction is structurally
    // identical between the duplicated web3.js copies.
    const bundle = new Bundle(transactions as any, MAX_BUNDLE_TX);
    const res = await this.client.sendBundle(bundle);
    if (!res.ok) throw new Error(`sendBundle failed: ${String(res.error)}`);
    return res.value;
  }

  async getNextScheduledLeader(): Promise<NextLeaderInfo> {
    const res = await this.client.getNextScheduledLeader();
    if (!res.ok) throw new Error(`getNextScheduledLeader failed: ${String(res.error)}`);
    return {
      currentSlot: res.value.currentSlot,
      nextLeaderSlot: res.value.nextLeaderSlot,
      nextLeaderIdentity: res.value.nextLeaderIdentity,
    };
  }

  subscribeBundleResult(onUpdate: (u: BundleResultUpdate) => void, onError: (e: Error) => void): () => void {
    return this.client.onBundleResult(
      (result: any) => {
        const bundleId = String(result?.bundleId ?? '');
        let state: BundleResultUpdate['state'] = 'unknown';
        let slot: number | undefined;
        if (result?.accepted) {
          state = 'accepted';
          slot = Number(result.accepted.slot ?? undefined) || undefined;
        } else if (result?.processed) {
          state = 'processed';
          slot = Number(result.processed.slot ?? undefined) || undefined;
        } else if (result?.finalized) {
          state = 'finalized';
        } else if (result?.rejected) {
          state = 'rejected';
        } else if (result?.dropped) {
          state = 'dropped';
        }
        onUpdate({ bundleId, state, slot, raw: result });
      },
      onError,
    );
  }

  // The JSON-RPC status endpoints are not part of the gRPC searcher surface. Bundle landing is
  // observed via subscribeBundleResult and the Yellowstone lifecycle tracker instead.
  async getBundleStatuses(): Promise<unknown> {
    return undefined;
  }

  async getInflightBundleStatuses(): Promise<unknown> {
    return undefined;
  }

  close(): void {
    try {
      (this.client as any)?.client?.close?.();
    } catch {
      /* best effort */
    }
  }
}
