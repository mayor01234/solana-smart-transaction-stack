import { Connection } from '@solana/web3.js';
import type { AppConfig } from '../config.js';
import type { BundleLifecycleRecord } from '../types.js';
import { TransactionStream } from '../geyser/transaction-stream.js';

export class LifecycleStreamTracker {
  constructor(
    private readonly config: AppConfig,
    private readonly connection: Connection,
    private readonly txStream: TransactionStream,
  ) {}

  async track(record: BundleLifecycleRecord): Promise<BundleLifecycleRecord> {
    for (const sig of record.signatures) this.txStream.watch(sig);

    const processedPromise = this.waitForProcessed(record);
    const confirmedPromise = this.waitForSignatureCommitment(record.signatures[0]!, 'confirmed');
    const finalizedPromise = this.waitForSignatureCommitment(record.signatures[0]!, 'finalized');

    const processed = await withTimeout(processedPromise, this.config.LIFECYCLE_TIMEOUT_MS).catch(() => undefined);
    if (processed) {
      record.processedAt = new Date(processed.observedAt).toISOString();
      record.processedSlot = processed.slot;
    }

    const confirmed = await withTimeout(confirmedPromise, this.config.CONFIRMED_TIMEOUT_MS).catch(() => undefined);
    if (confirmed) {
      record.confirmedAt = new Date().toISOString();
      record.confirmedSlot = confirmed.context.slot;
    }

    const finalized = await withTimeout(finalizedPromise, this.config.FINALIZED_TIMEOUT_MS).catch(() => undefined);
    if (finalized) {
      record.finalizedAt = new Date().toISOString();
      record.finalizedSlot = finalized.context.slot;
    }

    for (const sig of record.signatures) this.txStream.unwatch(sig);
    return record;
  }

  private waitForProcessed(record: BundleLifecycleRecord): Promise<{ signature: string; slot: number; observedAt: number }> {
    return new Promise((resolve) => {
      const onTx = (tx: { signature: string; slot: number; observedAt: number }) => {
        if (record.signatures.includes(tx.signature)) {
          this.txStream.off('transaction', onTx);
          resolve(tx);
        }
      };
      this.txStream.on('transaction', onTx);
    });
  }

  private waitForSignatureCommitment(signature: string, commitment: 'confirmed' | 'finalized'): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = this.connection.onSignature(
        signature,
        (result, context) => {
          this.connection.removeSignatureListener(id).catch(() => undefined);
          if (result.err) reject(result.err);
          else resolve({ result, context });
        },
        commitment,
      );
    });
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout ${timeoutMs}ms`)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}
