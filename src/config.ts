import 'dotenv/config';
import fs from 'node:fs';
import { z } from 'zod';

const ConfigSchema = z.object({
  TARGET_CLUSTER: z.string().default('mainnet-beta'),
  SOLANA_RPC_URL: z.string().url(),
  SOLANA_WS_URL: z.string().url().optional(),
  YELLOWSTONE_GRPC_URL: z.string().url(),
  YELLOWSTONE_TOKEN: z.string().optional().default(''),
  YELLOWSTONE_COMMITMENT: z.enum(['processed', 'confirmed', 'finalized']).default('processed'),
  GEYSER_PING_INTERVAL_MS: z.coerce.number().int().positive().default(15_000),
  GEYSER_MAX_BUFFERED_EVENTS: z.coerce.number().int().positive().default(20_000),
  JITO_BLOCK_ENGINE_URL: z.string().url(),
  JITO_TIP_FLOOR_URL: z.string().url().default('https://bundles.jito.wtf/api/v1/bundles/tip_floor'),
  JITO_AUTH_UUID: z.string().optional().default(''),
  JITO_REGION: z.string().default('mainnet'),
  JITO_LEADER_WINDOW_MAX_SLOTS: z.coerce.number().int().positive().default(3),
  JITO_LEADER_HOLD_MAX_MS: z.coerce.number().int().positive().default(15_000),
  KEYPAIR_PATH: z.string(),
  TIP_MIN_LAMPORTS: z.coerce.number().int().nonnegative().default(1_000),
  TIP_MAX_LAMPORTS: z.coerce.number().int().positive().default(5_000_000),
  TIP_PERCENTILE_TARGET: z.coerce.number().int().min(1).max(99).default(75),
  TIP_CONGESTION_MULTIPLIER_MAX: z.coerce.number().positive().default(2.25),
  LIFECYCLE_TIMEOUT_MS: z.coerce.number().int().positive().default(90_000),
  CONFIRMED_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  FINALIZED_TIMEOUT_MS: z.coerce.number().int().positive().default(180_000),
  EVIDENCE_DIR: z.string().default('./evidence'),
  AI_DECISION_MODE: z.enum(['local', 'llm_assisted']).default('local'),
  PUBLIC_ARCHITECTURE_URL: z.string().url().optional().default(''),
  FIRST_PLACE_MIN_SCORE: z.coerce.number().int().min(0).max(100).default(94),
  FIRST_PLACE_TARGET_RECORDS: z.coerce.number().int().min(10).default(25),
  FIRST_PLACE_TARGET_FAILURES: z.coerce.number().int().min(2).default(5),
  AI_RISK_TOLERANCE: z.enum(['conservative', 'balanced', 'aggressive']).default('balanced'),
  AI_MAX_RETRY_ATTEMPTS: z.coerce.number().int().min(0).max(10).default(3),
  AI_ALLOW_HOLD: z.coerce.boolean().default(true),
  AI_MIN_LANDING_PROBABILITY: z.coerce.number().min(0).max(1).default(0.72),
  DEMO_MEMO_PREFIX: z.string().default('AgentArena-Superteam-Bundle'),
  DEMO_BUNDLE_TX_COUNT: z.coerce.number().int().min(1).max(5).default(1),
  ALLOW_DRY_RUN: z.coerce.boolean().default(false),
  ALLOW_EXAMPLE_EVIDENCE: z.coerce.boolean().default(false),
  REQUIRE_PUBLIC_ARCHITECTURE_URL_FOR_SCORE: z.coerce.boolean().default(true),
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
