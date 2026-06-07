import { EventEmitter } from 'node:events';
import bs58 from 'bs58';
import type { AppConfig } from '../config.js';
import { logger } from '../logger.js';
import { ReconnectingYellowstoneStream } from './reconnecting-stream.js';
import { YellowstoneClientFactory } from './yellowstone-client.js';

/** A decoded pump.fun trade event observed live on-chain via Yellowstone gRPC. */
export interface PumpfunTradeEvent {
  signature: string;
  slot: number;
  mint: string;
  solLamports: string; // u64 as string
  tokenAmount: string; // u64 as string
  isBuy: boolean;
  user: string;
  observedAt: number;
}

// pump.fun bonding-curve program and the Anchor self-CPI "TradeEvent" discriminator, as used in the
// SolInfra/SuperteamNG Yellowstone gRPC training (livestream-grpc-intro).
const PUMPFUN_TRADE_DISCRIMINATOR = Buffer.from([189, 219, 127, 211, 78, 230, 97, 238]);
export const PROGRAM_DATA_PREFIX = 'Program data: ';

export type DecodedPumpfunTrade = Omit<PumpfunTradeEvent, 'signature' | 'slot' | 'observedAt'>;

/** Decode a base64 `Program data:` payload into a pump.fun trade, or undefined if it isn't one. */
export function decodePumpfunTrade(b64: string): DecodedPumpfunTrade | undefined {
  let buf: Buffer;
  try {
    buf = Buffer.from(b64, 'base64');
  } catch {
    return undefined;
  }
  if (buf.length < 8 + 89) return undefined;
  if (!buf.subarray(0, 8).equals(PUMPFUN_TRADE_DISCRIMINATOR)) return undefined;
  const d = buf.subarray(8);
  try {
    return {
      mint: bs58.encode(d.subarray(0, 32)),
      solLamports: d.readBigUInt64LE(32).toString(),
      tokenAmount: d.readBigUInt64LE(40).toString(),
      isBuy: d.readUInt8(48) === 1,
      user: bs58.encode(d.subarray(49, 81)),
    };
  } catch {
    return undefined;
  }
}

/** Scan a transaction's log messages and return the first decoded pump.fun trade, if any. */
export function decodePumpfunTradeFromLogs(logs: string[]): DecodedPumpfunTrade | undefined {
  for (const log of logs) {
    if (!log.startsWith(PROGRAM_DATA_PREFIX)) continue;
    const trade = decodePumpfunTrade(log.slice(PROGRAM_DATA_PREFIX.length));
    if (trade) return trade;
  }
  return undefined;
}

/**
 * Streams and decodes REAL pump.fun trade events from the Yellowstone/Geyser transaction stream —
 * the live-data-decoding skill demonstrated in the training, applied as a real-event source for the
 * smart transaction stack. Read-only: this never sends a transaction.
 */
export class PumpfunEventStream extends EventEmitter {
  private stream?: ReconnectingYellowstoneStream;
  private lastTrade?: PumpfunTradeEvent;

  constructor(private readonly config: AppConfig) {
    super();
  }

  getLastTrade(): PumpfunTradeEvent | undefined {
    return this.lastTrade;
  }

  /** Resolve with the next observed trade, or undefined after timeoutMs (so a run never stalls). */
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
    this.stream = new ReconnectingYellowstoneStream(
      this.config,
      factory,
      () => ({
        ...factory.baseSubscribeRequest(),
        transactions: {
          pumpfun: {
            vote: false,
            failed: false,
            accountInclude: [this.config.PUMPFUN_PROGRAM_ID],
            accountExclude: [],
            accountRequired: [],
          },
        },
      }),
      'pumpfun-event-stream',
    );
    this.stream.on('data', (data: any) => this.onData(data));
    this.stream.on('backpressure', (e) => logger.warn(e, 'pump.fun stream backpressure.'));
    this.stream.on('error', (error) => logger.warn({ error }, 'pump.fun stream error.'));
    await this.stream.start();
  }

  stop(): void {
    this.stream?.stop();
  }

  private onData(data: any): void {
    const txu = data?.transaction;
    if (!txu) return;
    const info = txu.transaction ?? txu;
    const logs: string[] = info?.meta?.logMessages ?? [];
    if (!logs.length) return;
    const trade = decodePumpfunTradeFromLogs(logs);
    if (!trade) return;
    const rawSig = info?.signature ?? info?.transaction?.signatures?.[0];
    const signature = rawSig ? (typeof rawSig === 'string' ? rawSig : bs58.encode(Buffer.from(rawSig))) : '';
    const event: PumpfunTradeEvent = {
      ...trade,
      signature,
      slot: Number(txu.slot ?? data?.slot ?? 0),
      observedAt: Date.now(),
    };
    this.lastTrade = event;
    this.emit('trade', event);
  }
}
