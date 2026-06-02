import type { VersionedTransaction } from '@solana/web3.js';

export type FailureClass =
  | 'expired_blockhash'
  | 'fee_too_low'
  | 'compute_exceeded'
  | 'bundle_failure'
  | 'leader_skipped_or_bundle_not_forwarded'
  | 'confirmation_timeout'
  | 'simulation_failed'
  | 'stream_disconnected'
  | 'unknown';

export type AgentAction =
  | 'submit_now'
  | 'hold_for_leader'
  | 'retry_refresh_blockhash'
  | 'retry_increase_tip'
  | 'retry_same_tip'
  | 'abort';

/** Evidence contributed by a single deterministic signal provider feeding the AI agent. */
export interface AgentDecisionModuleTrace {
  module: 'tip' | 'timing' | 'retry' | 'failure_reasoning';
  recommendation: string;
  confidence: number;
  evidence: Record<string, unknown>;
  rationale: string;
}

export interface TipSnapshot {
  fetchedAt: string;
  tipAccounts: string[];
  percentileLamports: Record<string, number>;
  selectedPercentile: number;
  source: string;
}

export interface NetworkSnapshot {
  observedAt: string;
  currentSlot: number;
  slotsUntilJitoLeader: number | null;
  isJitoLeaderWindow: boolean;
  nextLeaderIdentity?: string;
  recentProcessedToConfirmedMsP50?: number;
  recentFailureRate?: number;
  streamLagMs?: number;
}

/**
 * The AI agent's operational decision. When `engine` is `llm`, `action`/`reasoning` come from the
 * model and `promptHash` identifies the exact prompt (stored in the record's raw payload). When the
 * LLM is unavailable, `engine` is `heuristic` and the deterministic guardrail engine decides.
 */
export interface AgentDecisionTrace {
  decidedAt: string;
  engine: 'llm' | 'heuristic';
  model?: string;
  action: AgentAction;
  selectedTipLamports: number;
  landingProbabilityEstimate: number;
  riskScore: number;
  /** Natural-language reasoning from the agent (visible reasoning for judges). */
  reasoning: string;
  reasonSummary: string;
  signals: Record<string, unknown>;
  modules?: AgentDecisionModuleTrace[];
  promptHash?: string;
  llmLatencyMs?: number;
  /** True when the model's proposed action/tip were overridden by deterministic guardrails. */
  guardrailAdjusted?: boolean;
}

export interface BundleLifecycleRecord {
  runId: string;
  attemptId: string;
  parentAttemptId?: string;
  intent: 'normal' | 'fault_expired_blockhash' | 'fault_low_tip' | 'fault_compute_exceeded';
  bundleId?: string;
  signatures: string[];
  submittedAt?: string;
  processedAt?: string;
  confirmedAt?: string;
  finalizedAt?: string;
  submittedSlot?: number;
  processedSlot?: number;
  confirmedSlot?: number;
  finalizedSlot?: number;
  /** Commitment source for processed/confirmed/finalized observations (stream vs rpc subscription). */
  commitmentSource?: { processed?: string; confirmed?: string; finalized?: string };
  latencyMs: {
    submittedToProcessed?: number;
    processedToConfirmed?: number;
    confirmedToFinalized?: number;
    submittedToFinalized?: number;
  };
  tipLamports: number;
  tipAccount?: string;
  leaderWindow: NetworkSnapshot;
  agentDecision: AgentDecisionTrace;
  failureClass?: FailureClass;
  failureMessage?: string;
  retryOf?: string;
  explorerLinks: string[];
  raw?: Record<string, unknown>;
}

export interface BundleBuildResult {
  transactions: VersionedTransaction[];
  signatures: string[];
  tipLamports: number;
  tipAccount: string;
  recentBlockhash: string;
  lastValidBlockHeight: number;
}
