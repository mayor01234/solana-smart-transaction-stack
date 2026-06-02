import { EventEmitter } from 'node:events';
import type { AppConfig } from '../config.js';
import { logger } from '../logger.js';
import { ReconnectingYellowstoneStream } from './reconnecting-stream.js';
import { YellowstoneClientFactory } from './yellowstone-client.js';

export type SlotCommitment = 'processed' | 'confirmed' | 'finalized';

export interface SlotUpdate {
  slot: number;
  parent?: number;
  status: SlotCommitment;
  observedAt: number;
}

/** Map a Yellowstone slot-status value (numeric CommitmentLevel or string) to a commitment. */
function normalizeStatus(status: unknown): SlotCommitment {
  if (typeof status === 'number') {
    if (status >= 2) return 'finalized';
    if (status === 1) return 'confirmed';
    return 'processed';
  }
  const s = String(status ?? '').toUpperCase();
  if (s.includes('FINAL') || s.includes('ROOT')) return 'finalized';
  if (s.includes('CONFIRM')) return 'confirmed';
  return 'processed';
}

/**
 * Live slot stream over Yellowstone/Geyser. Tracks the highest processed, confirmed, and finalized
 * slots so transaction landing can be confirmed purely from the stream (no RPC polling).
 */
export class SlotStream extends EventEmitter {
  private latestSlot = 0;
  private latestConfirmedSlot = 0;
  private latestFinalizedSlot = 0;
  private stream?: ReconnectingYellowstoneStream;

  constructor(private readonly config: AppConfig) {
    super();
  }

  getLatestSlot(): number {
    return this.latestSlot;
  }
  getLatestConfirmedSlot(): number {
    return this.latestConfirmedSlot;
  }
  getLatestFinalizedSlot(): number {
    return this.latestFinalizedSlot;
  }

  async start(): Promise<void> {
    const factory = new YellowstoneClientFactory(this.config);
    this.stream = new ReconnectingYellowstoneStream(
      this.config,
      factory,
      () => ({ ...factory.baseSubscribeRequest(), slots: { client: { filterByCommitment: false } } }),
      'slot-stream',
    );
    this.stream.on('data', (data: any) => {
      const raw = data?.slot;
      const slot = Number(raw?.slot ?? data?.slots?.slot ?? 0);
      if (!slot) return;
      const status = normalizeStatus(raw?.status);
      this.latestSlot = Math.max(this.latestSlot, slot);
      if (status === 'confirmed') this.latestConfirmedSlot = Math.max(this.latestConfirmedSlot, slot);
      if (status === 'finalized') {
        // finalized implies confirmed
        this.latestFinalizedSlot = Math.max(this.latestFinalizedSlot, slot);
        this.latestConfirmedSlot = Math.max(this.latestConfirmedSlot, slot);
      }
      const update: SlotUpdate = { slot, parent: raw?.parent ? Number(raw.parent) : undefined, status, observedAt: Date.now() };
      this.emit('slot', update);
    });
    this.stream.on('backpressure', (e) => logger.warn(e, 'Slot stream backpressure.'));
    this.stream.on('error', (error) => logger.warn({ error }, 'Slot stream error.'));
    await this.stream.start();
  }

  stop(): void {
    this.stream?.stop();
  }
}
