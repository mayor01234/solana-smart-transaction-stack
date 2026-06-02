import crypto from 'node:crypto';
import type { AppConfig } from '../config.js';
import { logger } from '../logger.js';
import type { AgentAction, AgentDecisionModuleTrace, AgentDecisionTrace, FailureClass, NetworkSnapshot, TipSnapshot } from '../types.js';
import type { TipEstimate } from '../jito/dynamic-tip-estimator.js';
import { TipIntelligenceAgent } from './tip-intelligence-agent.js';
import { SubmissionTimingAgent } from './submission-timing-agent.js';
import { RetryReasoningAgent } from './retry-reasoning-agent.js';
import type { LlmProvider } from './llm/llm-provider.js';
import { AnthropicProvider } from './llm/anthropic-provider.js';

export interface DecisionInput {
  network: NetworkSnapshot;
  tipSnapshot: TipSnapshot;
  tipEstimate: TipEstimate;
  retryAttempt: number;
  previousFailure?: FailureClass;
  previousFailureMessage?: string;
}

export const AGENT_SYSTEM_PROMPT = `You are the operational decision agent inside a production Solana smart-transaction stack.
You own ONE real decision per attempt: what to do with a Jito bundle right now, and how much to tip.

Context you must reason over:
- Solana transactions move through commitment stages: processed -> confirmed -> finalized. Jito bundles
  land only when submitted into the correct Jito-connected leader's window.
- Tips are paid to Jito tip accounts and decide the bundle's place in the auction. Tip from live tip-floor
  percentiles; overpaying wastes capital, underpaying loses the auction and the bundle does not land.
- A blockhash has a limited validity window. An expired blockhash CANNOT land; it must be refreshed.
- After a failure you must reason about the CAUSE before retrying. Retrying an unchanged, deterministically
  failing payload (e.g. compute budget exceeded) wastes tips and should be aborted.

Actions:
- submit_now: build and submit immediately.
- hold_for_leader: wait for a favorable Jito leader window before submitting.
- retry_refresh_blockhash: rebuild with a fresh processed blockhash, then resubmit (use after blockhash expiry).
- retry_increase_tip: reprice from live tip data and resubmit (use when the tip/auction was too low).
- retry_same_tip: resubmit without raising the tip (use for transient, non-economic failures).
- abort: stop (use when retrying cannot help, or the retry budget is exhausted).

Decide using the provided live signals, not assumptions. Balance cost against landing probability and explain
your reasoning concretely. Your tip will be clamped to the configured guardrail range after you decide.`;

export class TransactionDecisionAgent {
  private readonly tipAgent = new TipIntelligenceAgent();
  private readonly timingAgent = new SubmissionTimingAgent();
  private readonly retryAgent = new RetryReasoningAgent();
  private readonly llm?: LlmProvider;

  constructor(private readonly config: AppConfig) {
    if (config.AI_DECISION_MODE === 'llm') {
      try {
        this.llm = new AnthropicProvider(config);
        logger.info({ model: config.ANTHROPIC_MODEL }, 'AI agent: LLM reasoning engine enabled.');
      } catch (error) {
        logger.warn({ error }, 'AI agent: LLM unavailable; using deterministic heuristic engine.');
      }
    } else {
      logger.info('AI agent: heuristic reasoning engine (llm disabled by config).');
    }
  }

  async decide(input: DecisionInput): Promise<AgentDecisionTrace> {
    const landingHeuristic = this.estimateLandingProbability(input);
    const modules: AgentDecisionModuleTrace[] = [
      this.tipAgent.decide({ tipSnapshot: input.tipSnapshot, tipEstimate: input.tipEstimate, network: input.network, retryAttempt: input.retryAttempt }),
      this.timingAgent.decide({ network: input.network, allowHold: this.config.AI_ALLOW_HOLD, minLandingProbability: this.config.AI_MIN_LANDING_PROBABILITY, landingProbabilityEstimate: landingHeuristic }),
      this.retryAgent.decide({ previousFailure: input.previousFailure, previousFailureMessage: input.previousFailureMessage, retryAttempt: input.retryAttempt, maxRetryAttempts: this.config.AI_MAX_RETRY_ATTEMPTS }),
    ];
    const signals = this.buildSignals(input, modules);

    if (this.llm) {
      try {
        const result = await this.llm.decide(AGENT_SYSTEM_PROMPT, {
          riskTolerance: this.config.AI_RISK_TOLERANCE,
          tipGuardrailLamports: { min: this.config.TIP_MIN_LAMPORTS, max: this.config.TIP_MAX_LAMPORTS },
          maxRetryAttempts: this.config.AI_MAX_RETRY_ATTEMPTS,
          signals,
          heuristicSignalProviders: modules,
        });
        return this.fromLlm(result, input, modules, signals);
      } catch (error) {
        logger.warn({ error }, 'LLM decision failed; falling back to heuristic engine for this attempt.');
      }
    }
    return this.heuristicDecision(input, modules, signals, landingHeuristic);
  }

  // ---- LLM path + deterministic guardrails -------------------------------------------------

  private fromLlm(
    result: Awaited<ReturnType<LlmProvider['decide']>>,
    input: DecisionInput,
    modules: AgentDecisionModuleTrace[],
    signals: Record<string, unknown>,
  ): AgentDecisionTrace {
    const d = result.decision;
    let action = this.coerceActionToContext(d.action, input);
    let adjusted = action !== d.action;

    // Guardrail: never exceed the retry budget regardless of model choice.
    if (input.retryAttempt > this.config.AI_MAX_RETRY_ATTEMPTS && action !== 'abort') {
      action = 'abort';
      adjusted = true;
    }

    // Guardrail: clamp tip to configured range; never trust an unbounded model value.
    const clampedTip = Math.max(this.config.TIP_MIN_LAMPORTS, Math.min(this.config.TIP_MAX_LAMPORTS, Math.floor(d.tipLamports || input.tipEstimate.lamports)));
    if (clampedTip !== d.tipLamports) adjusted = true;

    const landing = d.landingProbability;
    return {
      decidedAt: new Date().toISOString(),
      engine: 'llm',
      model: result.model,
      action,
      selectedTipLamports: clampedTip,
      landingProbabilityEstimate: landing,
      riskScore: 1 - landing,
      reasoning: d.reasoning,
      reasonSummary: d.summary,
      signals,
      modules,
      promptHash: crypto.createHash('sha256').update(result.prompt).digest('hex'),
      llmLatencyMs: result.latencyMs,
      guardrailAdjusted: adjusted,
    };
  }

  /** Keep the action coherent with attempt state without dictating the substantive choice. */
  private coerceActionToContext(action: AgentAction, input: DecisionInput): AgentAction {
    const retryActions: AgentAction[] = ['retry_refresh_blockhash', 'retry_increase_tip', 'retry_same_tip'];
    if (!input.previousFailure && retryActions.includes(action)) return 'submit_now';
    if (input.previousFailure && action === 'submit_now') return 'retry_same_tip';
    return action;
  }

  // ---- Heuristic fallback engine -----------------------------------------------------------

  private heuristicDecision(
    input: DecisionInput,
    modules: AgentDecisionModuleTrace[],
    signals: Record<string, unknown>,
    landing: number,
  ): AgentDecisionTrace {
    const [tipModule, timingModule, retryModule] = modules;
    let action: AgentAction = 'submit_now';
    const reasons: string[] = [];

    if (input.previousFailure) {
      const rec = retryModule!.recommendation;
      if (rec === 'abort_retry_limit' || rec === 'abort') action = 'abort';
      else if (rec === 'no_retry_needed') action = 'submit_now';
      else action = rec as AgentAction;
      reasons.push(retryModule!.rationale);
    } else if (timingModule!.recommendation === 'hold_for_leader') {
      action = 'hold_for_leader';
      reasons.push(timingModule!.rationale);
    } else if (timingModule!.recommendation === 'abort') {
      action = 'abort';
      reasons.push(timingModule!.rationale);
    } else {
      reasons.push('Timing provider accepted current leader/slot conditions for immediate submission.');
    }

    if (input.retryAttempt > this.config.AI_MAX_RETRY_ATTEMPTS) {
      action = 'abort';
      reasons.push('Retry budget exhausted; aborting to preserve capital.');
    }

    const tip = Math.max(this.config.TIP_MIN_LAMPORTS, Math.min(this.config.TIP_MAX_LAMPORTS, input.tipEstimate.lamports));
    return {
      decidedAt: new Date().toISOString(),
      engine: 'heuristic',
      action,
      selectedTipLamports: tip,
      landingProbabilityEstimate: landing,
      riskScore: 1 - landing,
      reasoning: `${reasons.join(' ')} ${tipModule!.rationale}`,
      reasonSummary: `Heuristic engine chose ${action} at ${tip} lamports.`,
      signals,
      modules,
      promptHash: crypto.createHash('sha256').update(JSON.stringify({ signals, modules })).digest('hex'),
    };
  }

  private buildSignals(input: DecisionInput, modules: AgentDecisionModuleTrace[]): Record<string, unknown> {
    return {
      currentSlot: input.network.currentSlot,
      slotsUntilJitoLeader: input.network.slotsUntilJitoLeader,
      isJitoLeaderWindow: input.network.isJitoLeaderWindow,
      nextLeaderIdentity: input.network.nextLeaderIdentity,
      liveTipPercentilesLamports: input.tipSnapshot.percentileLamports,
      selectedTipPercentile: input.tipSnapshot.selectedPercentile,
      dynamicTipBaseLamports: input.tipEstimate.baseLamports,
      dynamicTipEstimateLamports: input.tipEstimate.lamports,
      congestionMultiplier: input.tipEstimate.congestionMultiplier,
      leaderUrgencyMultiplier: input.tipEstimate.leaderUrgencyMultiplier,
      retryAttempt: input.retryAttempt,
      previousFailure: input.previousFailure ?? null,
      previousFailureMessage: input.previousFailureMessage ?? null,
      streamLagMs: input.network.streamLagMs,
      recentFailureRate: input.network.recentFailureRate,
      recentProcessedToConfirmedMsP50: input.network.recentProcessedToConfirmedMsP50,
      moduleRecommendations: modules.map((m) => ({ module: m.module, recommendation: m.recommendation, confidence: m.confidence })),
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
