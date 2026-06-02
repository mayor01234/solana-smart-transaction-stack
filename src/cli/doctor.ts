import { loadConfig } from '../config.js';
import { JitoRpcClient } from '../jito/jito-rpc-client.js';
import { TipAccountFeed } from '../jito/tip-account-feed.js';
import { YellowstoneClientFactory } from '../geyser/yellowstone-client.js';

const config = loadConfig();
const checks: Array<{name:string; status:'pass'|'warn'|'fail'; detail:string}> = [];

checks.push({ name: 'Dry-run disabled for submission', status: config.ALLOW_DRY_RUN ? 'fail' : 'pass', detail: `ALLOW_DRY_RUN=${config.ALLOW_DRY_RUN}` });
checks.push({ name: 'Public architecture URL', status: config.PUBLIC_ARCHITECTURE_URL ? 'pass' : 'warn', detail: config.PUBLIC_ARCHITECTURE_URL || 'Set PUBLIC_ARCHITECTURE_URL after publishing docs/ARCHITECTURE_PUBLIC.md' });
checks.push({ name: 'Yellowstone URL configured', status: config.YELLOWSTONE_GRPC_URL ? 'pass' : 'fail', detail: config.YELLOWSTONE_GRPC_URL });
checks.push({ name: 'Jito block engine URL configured', status: config.JITO_BLOCK_ENGINE_URL ? 'pass' : 'fail', detail: config.JITO_BLOCK_ENGINE_URL });

try {
  const jito = new JitoRpcClient(config);
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

for (const c of checks) console.log(`${c.status === 'pass' ? '✅' : c.status === 'warn' ? '⚠️' : '❌'} ${c.name}: ${c.detail}`);
if (checks.some((c) => c.status === 'fail')) process.exitCode = 1;
