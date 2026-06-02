import type { AgentDecisionModuleTrace, NetworkSnapshot } from '../types.js';

export class SubmissionTimingAgent {
  decide(input: { network: NetworkSnapshot; allowHold: boolean; minLandingProbability: number; landingProbabilityEstimate: number }): AgentDecisionModuleTrace {
    const slots = input.network.slotsUntilJitoLeader;
    let recommendation = 'submit_now';
    let rationale = 'Current slot is inside or near the configured Jito leader window.';
    let confidence = 0.82;

    if (!input.network.isJitoLeaderWindow && input.allowHold) {
      recommendation = 'hold_for_leader';
      rationale = 'Current slot is outside the favorable Jito leader window; holding improves landing probability and avoids overpaying tips too early.';
      confidence = slots === null ? 0.58 : 0.78;
    }
    if (input.landingProbabilityEstimate < input.minLandingProbability) {
      recommendation = input.allowHold ? 'hold_for_leader' : 'abort';
      rationale = `Estimated landing probability ${input.landingProbabilityEstimate.toFixed(2)} is below configured minimum ${input.minLandingProbability}.`;
      confidence = 0.8;
    }

    return {
      module: 'timing',
      recommendation,
      confidence,
      evidence: {
        currentSlot: input.network.currentSlot,
        slotsUntilJitoLeader: slots,
        isJitoLeaderWindow: input.network.isJitoLeaderWindow,
        streamLagMs: input.network.streamLagMs,
        landingProbabilityEstimate: input.landingProbabilityEstimate,
      },
      rationale,
    };
  }
}
