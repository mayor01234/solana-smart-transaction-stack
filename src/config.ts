import dotenv from 'dotenv';
import fs from 'node:fs';
import { z } from 'zod';

// Make .env the single source of truth: override any stray shell env vars (e.g. a lingering
// ALLOW_DRY_RUN) so the file you edit is always authoritative — critical for the dry-run gate.
dotenv.config({ override: true });

// Treat an empty env value (e.g. `PUBLIC_ARCHITECTURE_URL=`) as unset so optional URLs don't fail
// `.url()` validation before they are filled in.
const optionalUrl = () => z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional());

// z.coerce.boolean() uses JS Boolean(), so the string "false" coerces to TRUE. Parse env booleans
// explicitly so ALLOW_DRY_RUN=false (and friends) behave as written.
const envBool = (def: boolean) =>
  z.preprocess((v) => {
    if (v === undefined || v === null || v === '') return def;
    if (typeof v === 'boolean') return v;
    return ['true', '1', 'yes', 'on'].includes(String(v).trim().toLowerCase());
  }, z.boolean());

/**
 * Configuration for the AgentArena smart transaction stack.
 *
 * Infrastructure is provided by the bounty sponsor SolInfra (RPC nodes + Yellowstone gRPC).
 * Bundles go through Jito. The only non-sponsor dependency is the LLM used by the AI agent;
 * the bounty names no AI provider, so the LLM does not rival any sponsor and is fully optional
 * (the stack degrades to a transparent heuristic engine when no key is configured).
 */
const ConfigSchema = z.object({
  TARGET_CLUSTER: z.string().default('mainnet-beta'),

  // SolInfra (sponsor) RPC + WebSocket endpoints.
  SOLANA_RPC_URL: z.string().url(),
  SOLANA_WS_URL: optionalUrl(),

  // SolInfra (sponsor) Yellowstone/Geyser gRPC stream.
  YELLOWSTONE_GRPC_URL: z.string().url(),
  YELLOWSTONE_TOKEN: z.string().optional().default(''),
  YELLOWSTONE_COMMITMENT: z.enum(['processed', 'confirmed', 'finalized']).default('processed'),
  GEYSER_PING_INTERVAL_MS: z.coerce.number().int().positive().default(15_000),
  GEYSER_MAX_BUFFERED_EVENTS: z.coerce.number().int().positive().default(20_000),

  // Jito block engine. JSON-RPC base URL is also used to derive the gRPC host when the
  // dedicated gRPC URL is not set explicitly.
  JITO_BLOCK_ENGINE_URL: z.string().url(),
  JITO_BLOCK_ENGINE_GRPC_URL: z.string().optional().default(''),
  // JSON-RPC is the default: it lands bundles on the public endpoint with no searcher auth. The
  // official jito-ts gRPC transport is implemented and selectable, but requires a Jito-approved
  // searcher auth keypair (JITO_AUTH_KEYPATH) to actually forward bundles.
  JITO_TRANSPORT: z.enum(['grpc', 'jsonrpc']).default('jsonrpc'),
  JITO_TIP_FLOOR_URL: z.string().url().default('https://bundles.jito.wtf/api/v1/bundles/tip_floor'),
  JITO_AUTH_UUID: z.string().optional().default(''),
  JITO_AUTH_KEYPATH: z.string().optional().default(''),
  JITO_REGION: z.string().default('mainnet'),
  JITO_LEADER_WINDOW_MAX_SLOTS: z.coerce.number().int().positive().default(3),
  JITO_LEADER_HOLD_MAX_MS: z.coerce.number().int().positive().default(15_000),

  // Payer.
  KEYPAIR_PATH: z.string(),

  // Tip policy. Final tips are dynamically selected from live data and network state;
  // these are guardrails only, never hardcoded submitted values.
  TIP_MIN_LAMPORTS: z.coerce.number().int().nonnegative().default(2_000_000),
  TIP_MAX_LAMPORTS: z.coerce.number().int().positive().default(5_000_000),
  TIP_PERCENTILE_TARGET: z.coerce.number().int().min(1).max(99).default(99),
  TIP_CONGESTION_MULTIPLIER_MAX: z.coerce.number().positive().default(2.25),
  // Small priority fee (compute-unit price) in addition to the Jito tip, to aid inclusion.
  PRIORITY_FEE_MICROLAMPORTS: z.coerce.number().int().nonnegative().default(50_000),
  // Blockhash commitment for built bundles. 'confirmed' is fresh yet recognized by the Jito leader's
  // bank (a too-fresh 'processed' blockhash can be rejected); never 'finalized' (too old).
  BLOCKHASH_COMMITMENT: z.enum(['processed', 'confirmed', 'finalized']).default('confirmed'),

  // Lifecycle windows.
  LIFECYCLE_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
  CONFIRMED_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  FINALIZED_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  // Confirm landing from the Yellowstone slot-status stream (true) in addition to the
  // RPC signature subscription. RPC polling is never used.
  USE_STREAM_COMMITMENT: envBool(true),
  EVIDENCE_DIR: z.string().default('./evidence'),

  // AI agent. The agent owns the operational decision; the LLM produces the reasoning and
  // the action, and deterministic guardrails enforce safety (tip clamps, retry caps).
  AI_DECISION_MODE: z.enum(['heuristic', 'llm']).default('llm'),
  ANTHROPIC_API_KEY: z.string().optional().default(''),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-6'),
  AI_LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
  AI_LLM_MAX_TOKENS: z.coerce.number().int().positive().default(1_024),
  AI_RISK_TOLERANCE: z.enum(['conservative', 'balanced', 'aggressive']).default('balanced'),
  AI_MAX_RETRY_ATTEMPTS: z.coerce.number().int().min(0).max(10).default(3),
  AI_ALLOW_HOLD: envBool(true),
  AI_MIN_LANDING_PROBABILITY: z.coerce.number().min(0).max(1).default(0.72),

  // First-place scoring gate.
  PUBLIC_ARCHITECTURE_URL: optionalUrl().default(''),
  FIRST_PLACE_MIN_SCORE: z.coerce.number().int().min(0).max(100).default(94),
  FIRST_PLACE_TARGET_RECORDS: z.coerce.number().int().min(10).default(25),
  FIRST_PLACE_TARGET_FAILURES: z.coerce.number().int().min(2).default(5),
  REQUIRE_PUBLIC_ARCHITECTURE_URL_FOR_SCORE: envBool(true),

  // Real live-event source: decode pump.fun trades from the Yellowstone stream and use them to
  // trigger bundle submissions (read-only; we never trade). REACT_TO_LIVE_EVENTS=false reverts to a
  // self-driven loop.
  REACT_TO_LIVE_EVENTS: envBool(true),
  PUMPFUN_PROGRAM_ID: z.string().default('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'),
  PUMPFUN_EVENT_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),

  // Demo payload.
  DEMO_MEMO_PREFIX: z.string().default('AgentArena-Superteam-Bundle'),
  DEMO_BUNDLE_TX_COUNT: z.coerce.number().int().min(1).max(5).default(1),

  // Local testing only. Do not submit dry-run evidence.
  ALLOW_DRY_RUN: envBool(false),
  ALLOW_EXAMPLE_EVIDENCE: envBool(false),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(): AppConfig {
  const parsed = ConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${message}`);
  }
  fs.mkdirSync(parsed.data.EVIDENCE_DIR, { recursive: true });
  return parsed.data;
}

/** Derive the Jito gRPC host (no scheme) used by the jito-ts searcher client. */
export function jitoGrpcEndpoint(config: AppConfig): string {
  const explicit = config.JITO_BLOCK_ENGINE_GRPC_URL.trim();
  const raw = explicit || config.JITO_BLOCK_ENGINE_URL;
  return raw.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}
