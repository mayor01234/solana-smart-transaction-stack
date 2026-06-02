import type { AgentDecisionModuleTrace, NetworkSnapshot, TipSnapshot } from '../types.js';
import type { TipEstimate } from '../jito/dynamic-tip-estimator.js';

export class TipIntelligenceAgent {
  decide(input: { tipSnapshot: TipSnapshot; tipEstimate: TipEstimate; network: NetworkSnapshot; retryAttempt: number }): AgentDecisionModuleTrace {
    const percentiles = input.tipSnapshot.percentileLamports;
    const selected = input.tipSnapshot.selectedPercentile;
    const liveBase = input.tipEstimate.baseLamports;
    const retryBoost = input.retryAttempt > 0;
    const confidence = liveBase > 0 && Object.keys(percentiles).length >= 2 ? 0.86 : 0.62;
    const recommendation = retryBoost ? 'use_repriced_tip_for_retry' : 'use_dynamic_tip';
    return {
      module: 'tip',
      recommendation,
      confidence,
      evidence: {
        source: input.tipSnapshot.source,
        selectedPercentile: selected,
        livePercentilesLamports: percentiles,
        selectedTipLamports: input.tipEstimate.lamports,
        congestionMultiplier: input.tipEstimate.congestionMultiplier,
        leaderUrgencyMultiplier: input.tipEstimate.leaderUrgencyMultiplier,
      },
      rationale: `Tip chosen from live p${selected} tip data, adjusted for failure rate, stream lag, retry attempt, and distance to the next Jito leader.`,
    };
  }
}
