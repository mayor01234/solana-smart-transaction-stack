import { EventEmitter } from 'node:events';
import bs58 from 'bs58';
import type { AppConfig } from '../config.js';
import { logger } from '../logger.js';
import { ReconnectingYellowstoneStream } from './reconnecting-stream.js';
import { YellowstoneClientFactory } from './yellowstone-client.js';
import { normalizeStatus, type SlotUpdate } from './slot-stream.js';
import type { ObservedTransaction } from './transaction-stream.js';
import { decodePumpfunTradeFromLogs, type PumpfunTradeEvent } from './pumpfun-event-stream.js';

/**
 * A single Yellowstone/Geyser subscription that multiplexes everything the stack needs:
 *  - slot updates (processed/confirmed/finalized) for commitment tracking,
 *  - our payer's transactions (to observe processed landing of submitted bundles),
 *  - pump.fun program transactions (decoded into live trade events).
 *
 * Many providers (incl. SolInfra tiers) cap concurrent gRPC streams to 1, so consolidating into one
 * subscription with multiple filters is both required there and more efficient everywhere. Exposes
 * the slot, transaction, and trade APIs the consumers previously got from three separate streams.
 */
export class UnifiedYellowstoneStream extends EventEmitter {
  private latestSlot = 0;
  private latestConfirmedSlot = 0;
  private latestFinalizedSlot = 0;
  private readonly watched = new Set<string>();
  private lastTrade?: PumpfunTradeEvent;
  private stream?: ReconnectingYellowstoneStream;

  constructor(private readonly config: AppConfig, private readonly payerAddress: string) {
    super();
  }

  // ---- slot API ----
  getLatestSlot(): number {
    return this.latestSlot;
  }
  getLatestConfirmedSlot(): number {
    return this.latestConfirmedSlot;
  }
  getLatestFinalizedSlot(): number {
    return this.latestFinalizedSlot;
  }

  // ---- transaction watch API ----
  watch(signature: string): void {
    this.watched.add(signature);
  }
  unwatch(signature: string): void {
    this.watched.delete(signature);
  }

  // ---- pump.fun trade API ----
  getLastTrade(): PumpfunTradeEvent | undefined {
    return this.lastTrade;
  }
  nextTrade(timeoutMs: number): Promise<PumpfunTradeEvent | undefined> {
    return new Promise((resolve) => {
      const onTrade = (t: PumpfunTradeEvent) => {
        clearTimeout(timer);
        resolve(t);
      };
      const timer = setTimeout(() => {
        this.off('trade', onTrade);
        resolve(undefined);
      }, timeoutMs);
      this.once('trade', onTrade);
    });
  }

  async start(): Promise<void> {
    const factory = new YellowstoneClientFactory(this.config);
    this.stream = new ReconnectingYellowstoneStream(this.config, factory, () => this.buildRequest(factory), 'unified-stream');
    this.stream.on('data', (data: any) => this.onData(data));
    this.stream.on('backpressure', (e) => logger.warn(e, 'Unified stream backpressure.'));
    this.stream.on('error', (error) => logger.warn({ error }, 'Unified stream error.'));
    await this.stream.start();
  }

  stop(): void {
    this.stream?.stop();
  }

  private buildRequest(factory: YellowstoneClientFactory): any {
    const transactions: Record<string, unknown> = {
      // Our bundle's transactions — include both successful and failed (compute-exceeded fault lands
      // but fails), so `failed` is left unset (Yellowstone treats unset as "include both").
      payer: { vote: false, accountInclude: [this.payerAddress], accountExclude: [], accountRequired: [] },
    };
    if (this.config.REACT_TO_LIVE_EVENTS) {
      transactions.pumpfun = { vote: false, failed: false, accountInclude: [this.config.PUMPFUN_PROGRAM_ID], accountExclude: [], accountRequired: [] };
    }
    return {
      ...factory.baseSubscribeRequest(),
      slots: { client: { filterByCommitment: false } },
      transactions,
    };
  }

  private onData(data: any): void {
    // Slot status update.
    const rawSlot = data?.slot;
    if (rawSlot) {
      const slot = Number(rawSlot.slot ?? 0);
      if (slot) {
        const status = normalizeStatus(rawSlot.status);
        this.latestSlot = Math.max(this.latestSlot, slot);
        if (status === 'confirmed') this.latestConfirmedSlot = Math.max(this.latestConfirmedSlot, slot);
        if (status === 'finalized') {
          this.latestFinalizedSlot = Math.max(this.latestFinalizedSlot, slot);
          this.latestConfirmedSlot = Math.max(this.latestConfirmedSlot, slot);
        }
        this.emit('slot', { slot, parent: rawSlot.parent ? Number(rawSlot.parent) : undefined, status, observedAt: Date.now() } satisfies SlotUpdate);
      }
      return;
    }

    // Transaction update — either our payer's tx (watched) or a pump.fun trade.
    const txu = data?.transaction;
    if (!txu) return;
    const info = txu.transaction ?? txu;
    const slot = Number(txu.slot ?? 0);
    const logs: string[] = info?.meta?.logMessages ?? [];
    const rawSig = info?.signature ?? info?.transaction?.signatures?.[0];
    const signature = rawSig ? (typeof rawSig === 'string' ? rawSig : bs58.encode(Buffer.from(rawSig))) : '';

    // pump.fun trade event (read-only live-event source).
    if (this.config.REACT_TO_LIVE_EVENTS && logs.length) {
      const trade = decodePumpfunTradeFromLogs(logs);
      if (trade) {
        const event: PumpfunTradeEvent = { ...trade, signature, slot, observedAt: Date.now() };
        this.lastTrade = event;
        this.emit('trade', event);
        return;
      }
    }

    // Our submitted bundle's transaction (processed observation).
    if (signature && this.watched.has(signature)) {
      this.emit('transaction', { signature, slot, err: info?.meta?.err, observedAt: Date.now() } satisfies ObservedTransaction);
    }
  }
}
