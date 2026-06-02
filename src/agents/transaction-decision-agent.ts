import crypto from 'node:crypto';
import type { AppConfig } from '../config.js';
import type { AgentDecisionTrace, FailureClass, NetworkSnapshot, TipSnapshot } from '../types.js';
import type { TipEstimate } from '../jito/dynamic-tip-estimator.js';
import { TipIntelligenceAgent } from './tip-intelligence-agent.js';
import { SubmissionTimingAgent } from './submission-timing-agent.js';
import { RetryReasoningAgent } from './retry-reasoning-agent.js';

export interface DecisionInput {
  network: NetworkSnapshot;
  tipSnapshot: TipSnapshot;
  tipEstimate: TipEstimate;
  retryAttempt: number;
  previousFailure?: FailureClass;
  previousFailureMessage?: string;
}

export class TransactionDecisionAgent {
  private readonly tipAgent = new TipIntelligenceAgent();
  private readonly timingAgent = new SubmissionTimingAgent();
  private readonly retryAgent = new RetryReasoningAgent();

  constructor(private readonly config: AppConfig) {}

  decide(input: DecisionInput): AgentDecisionTrace {
    const landingProbabilityEstimate = this.estimateLandingProbability(input);
    const riskScore = 1 - landingProbabilityEstimate;

    const tipModule = this.tipAgent.decide({ tipSnapshot: input.tipSnapshot, tipEstimate: input.tipEstimate, network: input.network, retryAttempt: input.retryAttempt });
    const timingModule = this.timingAgent.decide({ network: input.network, allowHold: this.config.AI_ALLOW_HOLD, minLandingProbability: this.config.AI_MIN_LANDING_PROBABILITY, landingProbabilityEstimate });
    const retryModule = this.retryAgent.decide({ previousFailure: input.previousFailure, previousFailureMessage: input.previousFailureMessage, retryAttempt: input.retryAttempt, maxRetryAttempts: this.config.AI_MAX_RETRY_ATTEMPTS });

    let action: AgentDecisionTrace['action'] = 'submit_now';
    const reasons: string[] = [];

    // Retry agent has priority after failures because it owns fault recovery decisions.
    if (input.previousFailure) {
      const retryRecommendation = retryModule.recommendation;
      if (retryRecommendation === 'abort_retry_limit') action = 'abort';
      else if (retryRecommendation === 'no_retry_needed') action = 'submit_now';
      else action = retryRecommendation as AgentDecisionTrace['action'];
      reasons.push(retryModule.rationale);
    } else if (timingModule.recommendation === 'hold_for_leader') {
      action = 'hold_for_leader';
      reasons.push(timingModule.rationale);
    } else if (timingModule.recommendation === 'abort') {
      action = 'abort';
      reasons.push(timingModule.rationale);
    } else {
      action = 'submit_now';
      reasons.push('Timing agent accepted current leader/slot conditions for immediate submission.');
    }

    if (input.retryAttempt > this.config.AI_MAX_RETRY_ATTEMPTS) {
      action = 'abort';
      reasons.push('Retry limit exceeded; aborting to preserve capital.');
    }

    if (action === 'retry_increase_tip') {
      reasons.push('Tip agent repriced the bundle using fresh live tip-floor data before retry.');
    }
    if (action === 'retry_refresh_blockhash') {
      reasons.push('Blockhash manager will rebuild the bundle with a fresh processed blockhash before retry.');
    }
    if (action === 'retry_same_tip') {
      reasons.push('Retry is allowed without forcing a higher tip because failure classification is non-economic or unknown.');
    }

    const signals = {
      currentSlot: input.network.currentSlot,
      slotsUntilJitoLeader: input.network.slotsUntilJitoLeader,
      isJitoLeaderWindow: input.network.isJitoLeaderWindow,
      liveTipPercentiles: input.tipSnapshot.percentileLamports,
      baseTipLamports: input.tipEstimate.baseLamports,
      estimatedTipLamports: input.tipEstimate.lamports,
      retryAttempt: input.retryAttempt,
      previousFailure: input.previousFailure,
      streamLagMs: input.network.streamLagMs,
      recentFailureRate: input.network.recentFailureRate,
      aiDecisionMode: this.config.AI_DECISION_MODE,
    };
    const promptHash = crypto.createHash('sha256').update(JSON.stringify({ signals, modules: [tipModule, timingModule, retryModule] })).digest('hex');

    return {
      decidedAt: new Date().toISOString(),
      mode: this.config.AI_DECISION_MODE,
      action,
      selectedTipLamports: input.tipEstimate.lamports,
      landingProbabilityEstimate,
      riskScore,
      reasonSummary: `${reasons.join(' ')} ${tipModule.rationale}`,
      signals,
      modules: [tipModule, timingModule, retryModule],
      promptHash,
    };
  }

  private estimateLandingProbability(input: DecisionInput): number {
    let p = 0.64;
    if (input.network.isJitoLeaderWindow) p += 0.18;
    if (input.network.slotsUntilJitoLeader !== null && input.network.slotsUntilJitoLeader <= 1) p += 0.06;
    if ((input.network.recentFailureRate ?? 0) > 0.25) p -= 0.12;
    if ((input.network.streamLagMs ?? 0) > 1200) p -= 0.08;
    if (input.retryAttempt > 0) p -= Math.min(0.12, input.retryAttempt * 0.04);
    if (input.previousFailure === 'fee_too_low') p -= 0.03;
    if (input.previousFailure === 'expired_blockhash') p -= 0.02;
    if (input.previousFailure === 'stream_disconnected') p -= 0.1;
    return Math.max(0.05, Math.min(0.97, p));
  }
}
