import type { AgentAction } from '../../types.js';

/** Structured, machine-checkable decision the model must return. */
export interface LlmDecision {
  action: AgentAction;
  /** Tip the agent wants to use, in lamports (clamped by guardrails afterwards). */
  tipLamports: number;
  /** 0..1 estimate that this bundle lands at the chosen commitment. */
  landingProbability: number;
  /** Concise, human-readable reasoning that explains WHY (visible to judges). */
  reasoning: string;
  /** Short one-line summary of the decision. */
  summary: string;
}

export interface LlmDecisionResult {
  decision: LlmDecision;
  model: string;
  latencyMs: number;
  /** The exact prompt sent (for evidence / promptHash). */
  prompt: string;
  /** Raw model output text, for auditability. */
  raw: unknown;
}

/**
 * Pluggable LLM provider. The stack ships an Anthropic implementation; the interface keeps the
 * agent vendor-agnostic so the reasoning engine can be swapped without touching execution logic.
 */
export interface LlmProvider {
  readonly model: string;
  decide(systemPrompt: string, userPayload: Record<string, unknown>): Promise<LlmDecisionResult>;
}
