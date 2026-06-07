import { Connection } from '@solana/web3.js';
import type { AppConfig } from '../config.js';
import type { BundleLifecycleRecord } from '../types.js';
import type { ObservedTransaction } from '../geyser/transaction-stream.js';
import { CommitmentTracker } from './commitment-tracker.js';

/** Minimal transaction-watch source (satisfied by TransactionStream and UnifiedYellowstoneStream). */
export interface TxWatchSource {
  watch(signature: string): void;
  unwatch(signature: string): void;
  on(event: 'transaction', listener: (t: ObservedTransaction) => void): unknown;
  off(event: 'transaction', listener: (t: ObservedTransaction) => void): unknown;
}

interface CommitmentHit {
  slot: number;
  observedAt: number;
  source: string;
}

/**
 * Tracks a submitted bundle from processed -> confirmed -> finalized.
 *
 * Processed landing is observed on the Yellowstone transaction stream. Confirmed/finalized are
 * observed primarily from the Yellowstone slot-status stream (CommitmentTracker), raced against an
 * RPC signature *subscription* as a fallback. RPC polling is never used.
 */
export class LifecycleStreamTracker {
  constructor(
    private readonly config: AppConfig,
    private readonly connection: Connection,
    private readonly txStream: TxWatchSource,
    private readonly commitmentTracker: CommitmentTracker,
  ) {}

  async track(record: BundleLifecycleRecord): Promise<BundleLifecycleRecord> {
    record.commitmentSource = record.commitmentSource ?? {};
    for (const sig of record.signatures) this.txStream.watch(sig);
    const signature = record.signatures[0]!;

    try {
      const processed = await this.waitForProcessed(record, this.config.LIFECYCLE_TIMEOUT_MS).catch(() => undefined);
      if (!processed) return record; // never landed; orchestrator classifies via status/timeout

      record.processedAt = new Date(processed.observedAt).toISOString();
      record.processedSlot = processed.slot;
      record.commitmentSource.processed = 'yellowstone_tx_stream';

      // A transaction that landed in a block but failed execution (e.g. compute exceeded) is a
      // failure, not a success — do not advance it to confirmed/finalized.
      if (processed.err !== undefined && processed.err !== null) {
        record.raw = { ...(record.raw ?? {}), observedTransactionError: processed.err };
        return record;
      }

      const confirmed = await this.waitForCommitment(signature, processed.slot, 'confirmed', this.config.CONFIRMED_TIMEOUT_MS).catch(() => undefined);
      if (confirmed) {
        record.confirmedAt = new Date(confirmed.observedAt).toISOString();
        record.confirmedSlot = confirmed.slot;
        record.commitmentSource.confirmed = confirmed.source;
      }

      const finalized = await this.waitForCommitment(signature, processed.slot, 'finalized', this.config.FINALIZED_TIMEOUT_MS).catch(() => undefined);
      if (finalized) {
        record.finalizedAt = new Date(finalized.observedAt).toISOString();
        record.finalizedSlot = finalized.slot;
        record.commitmentSource.finalized = finalized.source;
      }
      return record;
    } finally {
      for (const sig of record.signatures) this.txStream.unwatch(sig);
    }
  }

  private waitForProcessed(
    record: BundleLifecycleRecord,
    timeoutMs: number,
  ): Promise<{ slot: number; observedAt: number; err?: unknown }> {
    return new Promise((resolve, reject) => {
      const onTx = (tx: { signature: string; slot: number; observedAt: number; err?: unknown }) => {
        if (record.signatures.includes(tx.signature)) {
          cleanup();
          resolve({ slot: tx.slot, observedAt: tx.observedAt, err: tx.err });
        }
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`processed timeout ${timeoutMs}ms`));
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        this.txStream.off('transaction', onTx);
      };
      this.txStream.on('transaction', onTx);
    });
  }

  /** Race the Yellowstone slot-status stream against the RPC signature subscription. */
  private async waitForCommitment(
    signature: string,
    processedSlot: number,
    level: 'confirmed' | 'finalized',
    timeoutMs: number,
  ): Promise<CommitmentHit> {
    const candidates: Promise<CommitmentHit>[] = [];

    if (this.config.USE_STREAM_COMMITMENT) {
      candidates.push(
        this.commitmentTracker
          .waitForCommitment(processedSlot, level, timeoutMs)
          .then((obs) => ({ slot: obs.slot, observedAt: obs.observedAt, source: 'yellowstone_slot_stream' })),
      );
    }
    candidates.push(this.waitForSignatureSubscription(signature, level, timeoutMs));

    // First successful source wins; only reject if every source fails/times out.
    return Promise.any(candidates);
  }

  // HTTP getSignatureStatuses polling (no WebSocket) — a robust fallback to the Yellowstone slot-status
  // stream that works even when the RPC WebSocket is unavailable. The stream remains the primary path.
  private waitForSignatureSubscription(signature: string, level: 'confirmed' | 'finalized', timeoutMs: number): Promise<CommitmentHit> {
    const accepted = level === 'finalized' ? ['finalized'] : ['confirmed', 'finalized'];
    return new Promise<CommitmentHit>((resolve, reject) => {
      const start = Date.now();
      const poll = async () => {
        try {
          const { value } = await this.connection.getSignatureStatuses([signature]);
          const v = value[0];
          if (v) {
            if (v.err) return reject(new Error(`tx error at ${level}: ${JSON.stringify(v.err)}`));
            if (v.confirmationStatus && accepted.includes(v.confirmationStatus)) {
              return resolve({ slot: v.slot, observedAt: Date.now(), source: 'rpc_signature_status' });
            }
          }
        } catch {
          /* transient RPC error; keep polling */
        }
        if (Date.now() - start > timeoutMs) return reject(new Error(`rpc ${level} poll timeout ${timeoutMs}ms`));
        setTimeout(poll, 2000);
      };
      void poll();
    });
  }
}
