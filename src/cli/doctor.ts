import { Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { loadConfig } from '../config.js';
import { createJitoClient } from '../jito/jito-client-factory.js';
import { TipAccountFeed } from '../jito/tip-account-feed.js';
import { YellowstoneClientFactory } from '../geyser/yellowstone-client.js';
import { loadKeypair } from '../core/keypair.js';

const config = loadConfig();
const checks: Array<{name:string; status:'pass'|'warn'|'fail'; detail:string}> = [];

checks.push({ name: 'Dry-run disabled for submission', status: config.ALLOW_DRY_RUN ? 'fail' : 'pass', detail: `ALLOW_DRY_RUN=${config.ALLOW_DRY_RUN}` });
checks.push({ name: 'Public architecture URL', status: config.PUBLIC_ARCHITECTURE_URL ? 'pass' : 'warn', detail: config.PUBLIC_ARCHITECTURE_URL || 'Set PUBLIC_ARCHITECTURE_URL after publishing docs/ARCHITECTURE_PUBLIC.md' });
checks.push({ name: 'Yellowstone URL configured', status: config.YELLOWSTONE_GRPC_URL ? 'pass' : 'fail', detail: config.YELLOWSTONE_GRPC_URL });
checks.push({ name: 'Jito block engine URL configured', status: config.JITO_BLOCK_ENGINE_URL ? 'pass' : 'fail', detail: config.JITO_BLOCK_ENGINE_URL });
checks.push({ name: 'AI decision mode', status: config.AI_DECISION_MODE === 'llm' && !config.ANTHROPIC_API_KEY ? 'warn' : 'pass', detail: config.AI_DECISION_MODE === 'llm' ? (config.ANTHROPIC_API_KEY ? `llm (${config.ANTHROPIC_MODEL})` : 'llm mode set but ANTHROPIC_API_KEY missing; will fall back to heuristic') : 'heuristic (no external LLM)' });

try {
  const jito = await createJitoClient(config);
  checks.push({ name: 'Jito transport', status: 'pass', detail: jito.transport });
  const accounts = await jito.getTipAccounts();
  checks.push({ name: 'Jito tip accounts reachable', status: accounts.length ? 'pass' : 'fail', detail: `${accounts.length} accounts returned` });
  const feed = new TipAccountFeed(config, jito);
  const snap = await feed.fetch();
  checks.push({ name: 'Live tip-floor data reachable', status: Object.keys(snap.percentileLamports).length ? 'pass' : 'fail', detail: JSON.stringify(snap.percentileLamports) });
  const leader = await jito.getNextScheduledLeader().catch((e) => ({ error: String(e) }));
  checks.push({ name: 'Jito leader schedule reachable', status: 'error' in leader ? 'warn' : 'pass', detail: JSON.stringify(leader) });
} catch (e) {
  checks.push({ name: 'Jito connectivity', status: 'fail', detail: String(e) });
}

try {
  const factory = new YellowstoneClientFactory(config);
  factory.create();
  checks.push({ name: 'Yellowstone client constructible', status: 'pass', detail: 'Client object created. Run npm run watch:slots for stream validation.' });
} catch (e) {
  checks.push({ name: 'Yellowstone client constructible', status: 'fail', detail: String(e) });
}

// RPC + WebSocket (RPC Key) and payer funding — required for the funded run.
try {
  const conn = new Connection(config.SOLANA_RPC_URL, { commitment: 'processed', wsEndpoint: config.SOLANA_WS_URL });
  const slot = await conn.getSlot();
  checks.push({ name: 'RPC reachable (RPC Key)', status: slot > 0 ? 'pass' : 'fail', detail: `current slot ${slot}` });
  try {
    const payer = loadKeypair(config.KEYPAIR_PATH);
    const lamports = await conn.getBalance(payer.publicKey);
    const sol = lamports / LAMPORTS_PER_SOL;
    checks.push({
      name: 'Payer funded',
      status: lamports <= 0 ? 'fail' : sol >= 0.05 ? 'pass' : 'warn',
      detail: `${payer.publicKey.toBase58()} = ${sol} SOL`,
    });
  } catch (e) {
    checks.push({ name: 'Payer keypair loadable', status: 'fail', detail: String(e) });
  }
} catch (e) {
  checks.push({ name: 'RPC reachable (RPC Key)', status: 'fail', detail: String(e) });
}

for (const c of checks) console.log(`${c.status === 'pass' ? '✅' : c.status === 'warn' ? '⚠️' : '❌'} ${c.name}: ${c.detail}`);
// Force exit: the gRPC searcher client keeps a connection open that would otherwise hang the process.
process.exit(checks.some((c) => c.status === 'fail') ? 1 : 0);
