import type { VersionedTransaction } from '@solana/web3.js';

/** Next Jito-connected leader as reported by the block engine. */
export interface NextLeaderInfo {
  currentSlot?: number;
  nextLeaderSlot?: number;
  nextLeaderIdentity?: string;
}

/** A landing/status update for a previously submitted bundle. */
export interface BundleResultUpdate {
  bundleId: string;
  /** High-level state: accepted, processed, finalized, rejected, dropped. */
  state: 'accepted' | 'processed' | 'finalized' | 'rejected' | 'dropped' | 'unknown';
  slot?: number;
  /** Raw provider payload for evidence. */
  raw: unknown;
}

/**
 * Transport-agnostic Jito block-engine client.
 *
 * Two adapters implement this:
 *  - `JitoGrpcClient`  : official jito-ts searcher SDK (gRPC) — used by default for depth.
 *  - `JitoJsonRpcClient`: Jito JSON-RPC over fetch — zero-extra-dependency fallback.
 *
 * The orchestrator depends only on this interface, so the transport can be switched with a
 * single env var (`JITO_TRANSPORT`) without touching execution logic.
 */
export interface JitoBundleClient {
  readonly transport: 'grpc' | 'jsonrpc';

  /** Live Jito tip accounts. */
  getTipAccounts(): Promise<string[]>;

  /** Submit a bundle of signed transactions. Returns the Jito bundle id. */
  sendBundle(transactions: VersionedTransaction[]): Promise<string>;

  /** Next scheduled Jito-connected leader (for leader-window timing). */
  getNextScheduledLeader(): Promise<NextLeaderInfo>;

  /**
   * Subscribe to landing/status updates for submitted bundles, if the transport supports it
   * (gRPC streams these; JSON-RPC returns undefined and the orchestrator polls statuses).
   * Returns an unsubscribe function.
   */
  subscribeBundleResult?(onUpdate: (u: BundleResultUpdate) => void, onError: (e: Error) => void): () => void;

  /** Poll inflight/final bundle status (fallback path, mainly for JSON-RPC). */
  getBundleStatuses(bundleIds: string[]): Promise<unknown>;
  getInflightBundleStatuses(bundleIds: string[]): Promise<unknown>;

  /** Release any underlying connections. */
  close(): void;
}
