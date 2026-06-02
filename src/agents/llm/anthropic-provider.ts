import Anthropic from '@anthropic-ai/sdk';
import type { AppConfig } from '../../config.js';
import type { AgentAction } from '../../types.js';
import type { LlmDecision, LlmDecisionResult, LlmProvider } from './llm-provider.js';

const ACTIONS: AgentAction[] = [
  'submit_now',
  'hold_for_leader',
  'retry_refresh_blockhash',
  'retry_increase_tip',
  'retry_same_tip',
  'abort',
];

const DECISION_TOOL = {
  name: 'operational_decision',
  description:
    'Return the single operational decision for this Jito bundle attempt, with explicit reasoning. ' +
    'You own this decision: choose the action, the tip, and explain the tradeoff between cost and landing probability.',
  input_schema: {
    type: 'object' as const,
    properties: {
      action: { type: 'string', enum: ACTIONS, description: 'The operational action to take now.' },
      tipLamports: { type: 'integer', minimum: 0, description: 'Tip to use for this bundle, in lamports.' },
      landingProbability: { type: 'number', minimum: 0, maximum: 1, description: 'Your estimate this bundle lands.' },
      reasoning: {
        type: 'string',
        description:
          'Concrete reasoning grounded in the provided signals: leader window, tip percentiles, prior failure, ' +
          'stream lag, retry attempt. Explain WHY this action and tip, not just what.',
      },
      summary: { type: 'string', description: 'One-line summary of the decision.' },
    },
    required: ['action', 'tipLamports', 'landingProbability', 'reasoning', 'summary'],
  },
};

/** Anthropic Claude implementation of the agent's reasoning engine. */
export class AnthropicProvider implements LlmProvider {
  readonly model: string;
  private readonly client: Anthropic;
  private readonly maxTokens: number;

  constructor(config: AppConfig) {
    if (!config.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is required for llm decision mode.');
    this.model = config.ANTHROPIC_MODEL;
    this.maxTokens = config.AI_LLM_MAX_TOKENS;
    this.client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY, timeout: config.AI_LLM_TIMEOUT_MS, maxRetries: 1 });
  }

  async decide(systemPrompt: string, userPayload: Record<string, unknown>): Promise<LlmDecisionResult> {
    const userText = JSON.stringify(userPayload, null, 2);
    const start = Date.now();
    const resp = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      // cache_control caches the static system prompt across the ~25-50 attempts in a run.
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      tools: [DECISION_TOOL],
      tool_choice: { type: 'tool', name: DECISION_TOOL.name },
      messages: [{ role: 'user', content: userText }],
    });
    const latencyMs = Date.now() - start;

    // Narrow via the discriminated `type` field rather than a named type export.
    let toolInput: unknown;
    for (const block of resp.content) {
      if (block.type === 'tool_use') {
        toolInput = block.input;
        break;
      }
    }
    if (toolInput === undefined) throw new Error('Model did not return a structured operational_decision.');
    const decision = this.validate(toolInput);

    return {
      decision,
      model: this.model,
      latencyMs,
      prompt: `${systemPrompt}\n\n---\n${userText}`,
      raw: { stopReason: resp.stop_reason, usage: resp.usage, toolInput },
    };
  }

  private validate(input: unknown): LlmDecision {
    const o = (input ?? {}) as Record<string, unknown>;
    const action = ACTIONS.includes(o.action as AgentAction) ? (o.action as AgentAction) : 'submit_now';
    const tipLamports = Number.isFinite(Number(o.tipLamports)) ? Math.max(0, Math.floor(Number(o.tipLamports))) : 0;
    const landingProbability = Math.max(0, Math.min(1, Number(o.landingProbability ?? 0.5)));
    const reasoning = typeof o.reasoning === 'string' ? o.reasoning : 'No reasoning returned.';
    const summary = typeof o.summary === 'string' ? o.summary : action;
    return { action, tipLamports, landingProbability, reasoning, summary };
  }
}
