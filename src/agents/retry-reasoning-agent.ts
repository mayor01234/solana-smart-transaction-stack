import type { AgentDecisionModuleTrace, FailureClass } from '../types.js';

export class RetryReasoningAgent {
  decide(input: { previousFailure?: FailureClass; previousFailureMessage?: string; retryAttempt: number; maxRetryAttempts: number }): AgentDecisionModuleTrace {
    if (!input.previousFailure) {
      return {
        module: 'retry',
        recommendation: 'no_retry_needed',
        confidence: 0.9,
        evidence: { retryAttempt: input.retryAttempt, previousFailure: null },
        rationale: 'No previous failure was observed for this attempt, so retry logic is inactive.',
      };
    }

    if (input.retryAttempt > input.maxRetryAttempts) {
      return {
        module: 'retry',
        recommendation: 'abort_retry_limit',
        confidence: 0.96,
        evidence: { retryAttempt: input.retryAttempt, maxRetryAttempts: input.maxRetryAttempts, previousFailure: input.previousFailure },
        rationale: 'Retry limit has been reached; aborting protects the payer from uncontrolled spend and repeated stale submissions.',
      };
    }

    const table: Record<FailureClass, { recommendation: string; confidence: number; rationale: string }> = {
      expired_blockhash: { recommendation: 'retry_refresh_blockhash', confidence: 0.95, rationale: 'Expired blockhash means the original validity window is gone; retry must rebuild with a fresh processed blockhash.' },
      fee_too_low: { recommendation: 'retry_increase_tip', confidence: 0.88, rationale: 'Failure suggests the auction/tip level was insufficient; retry should reprice from live tip data and current leader distance.' },
      compute_exceeded: { recommendation: 'abort', confidence: 0.92, rationale: 'Compute exceeded is deterministic for the current payload; resubmitting unchanged wastes tips and should be aborted.' },
      bundle_failure: { recommendation: 'retry_same_tip', confidence: 0.68, rationale: 'Generic bundle failure may be transient; retry only if the timing agent still sees a favorable leader window.' },
      leader_skipped_or_bundle_not_forwarded: { recommendation: 'hold_for_leader', confidence: 0.8, rationale: 'The bundle likely missed its intended leader path; hold until the next favorable Jito leader window before resubmitting.' },
      confirmation_timeout: { recommendation: 'retry_refresh_blockhash', confidence: 0.72, rationale: 'No commitment progression was observed in the timeout window; rebuild with a fresh blockhash and updated tip.' },
      simulation_failed: { recommendation: 'abort', confidence: 0.86, rationale: 'Simulation failure usually indicates payload invalidity; abort unless the operator explicitly fixes the transaction.' },
      stream_disconnected: { recommendation: 'hold_for_leader', confidence: 0.78, rationale: 'Landing cannot be verified while stream health is poor; hold until Geyser stream reconnects and timing can be trusted.' },
      unknown: { recommendation: 'retry_same_tip', confidence: 0.52, rationale: 'Unknown failure gets one cautious retry only when timing and tip agents agree conditions are acceptable.' },
    };
    const selected = table[input.previousFailure];
    return {
      module: 'retry',
      recommendation: selected.recommendation,
      confidence: selected.confidence,
      evidence: {
        retryAttempt: input.retryAttempt,
        maxRetryAttempts: input.maxRetryAttempts,
        previousFailure: input.previousFailure,
        previousFailureMessage: input.previousFailureMessage,
      },
      rationale: selected.rationale,
    };
  }
}
