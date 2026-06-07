import type { AppConfig } from '../config.js';
import type { NetworkSnapshot, TipSnapshot } from '../types.js';

export interface TipEstimate {
  lamports: number;
  baseLamports: number;
  congestionMultiplier: number;
  leaderUrgencyMultiplier: number;
  reasonSummary: string;
}

function pickPercentile(snapshot: TipSnapshot, target: number): number {
  const available = Object.keys(snapshot.percentileLamports).map(Number).sort((a, b) => a - b);
  if (!available.length) throw new Error('Cannot estimate tip without live percentile data.');
  const closest = available.reduce((best, p) => (Math.abs(p - target) < Math.abs(best - target) ? p : best), available[0]!);
  return snapshot.percentileLamports[String(closest)]!;
}

export class DynamicTipEstimator {
  constructor(private readonly config: AppConfig) {}

  estimate(snapshot: TipSnapshot, network: NetworkSnapshot, retryAttempt = 0): TipEstimate {
    const baseLamports = pickPercentile(snapshot, snapshot.selectedPercentile);
    const failureRate = network.recentFailureRate ?? 0;
    const streamLagMs = network.streamLagMs ?? 0;
    const congestionMultiplier = Math.min(
      this.config.TIP_CONGESTION_MULTIPLIER_MAX,
      1 + failureRate * 1.5 + Math.min(streamLagMs / 1000, 1.0) * 0.2 + retryAttempt * 0.15,
    );
    const slots = network.slotsUntilJitoLeader;
    const leaderUrgencyMultiplier = slots === null ? 1.15 : slots <= 1 ? 1.25 : slots <= 3 ? 1.1 : 0.95;
    const raw = Math.round(baseLamports * congestionMultiplier * leaderUrgencyMultiplier);
    // Escalate the floor each retry so repeated misses outbid a competitive auction (3M -> 6M -> 8M...).
    const retryFloor = this.config.TIP_MIN_LAMPORTS * (1 + retryAttempt);
    const lamports = Math.max(this.config.TIP_MIN_LAMPORTS, Math.min(this.config.TIP_MAX_LAMPORTS, Math.max(raw, retryFloor)));
    return {
      lamports,
      baseLamports,
      congestionMultiplier,
      leaderUrgencyMultiplier,
      reasonSummary: `Tip derived from live p${snapshot.selectedPercentile} tip data (${baseLamports} lamports), congestion x${congestionMultiplier.toFixed(2)}, leader urgency x${leaderUrgencyMultiplier.toFixed(2)}.`,
    };
  }
}
