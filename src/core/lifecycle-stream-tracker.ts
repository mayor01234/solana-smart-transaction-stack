import { Connection } from '@solana/web3.js';
import type { AppConfig } from '../config.js';
import type { BundleLifecycleRecord } from '../types.js';
import { TransactionStream } from '../geyser/transaction-stream.js';
import { CommitmentTracker } from './commitment-tracker.js';

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
    private readonly txStream: TransactionStream,
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

  private waitForSignatureSubscription(signature: string, level: 'confirmed' | 'finalized', timeoutMs: number): Promise<CommitmentHit> {
    return new Promise<CommitmentHit>((resolve, reject) => {
      let id: number | undefined;
      const timer = setTimeout(() => {
        if (id !== undefined) this.connection.removeSignatureListener(id).catch(() => undefined);
        reject(new Error(`rpc ${level} subscription timeout ${timeoutMs}ms`));
      }, timeoutMs);
      id = this.connection.onSignature(
        signature,
        (result, context) => {
          clearTimeout(timer);
          if (result.err) reject(new Error(`tx error at ${level}: ${JSON.stringify(result.err)}`));
          else resolve({ slot: context.slot, observedAt: Date.now(), source: 'rpc_signature_subscription' });
        },
        level,
      );
    });
  }
}
