import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../config.js';
import { LifecycleStore } from '../core/lifecycle-store.js';
import { evidenceDiagnostics, scoreEvidence } from '../quality/evidence-policy.js';

const config = loadConfig();
const store = new LifecycleStore(config);
const records = store.readAll();

const hasFile = (p: string) => fs.existsSync(path.join(process.cwd(), p));
const staticChecks = [
  { name: 'Public architecture document source exists', weight: 6, pass: hasFile('docs/ARCHITECTURE_PUBLIC.md') },
  { name: 'Requirement mapping exists', weight: 4, pass: hasFile('docs/SUPERTEAM_REQUIREMENT_MAPPING.md') },
  { name: 'README includes required answers', weight: 5, pass: hasFile('README.md') && fs.readFileSync('README.md','utf8').includes('README Question 1') },
  { name: 'Yellowstone implementation exists', weight: 10, pass: hasFile('src/geyser/yellowstone-client.ts') && hasFile('src/geyser/reconnecting-stream.ts') && hasFile('src/geyser/slot-stream.ts') },
  { name: 'Jito bundle implementation exists', weight: 10, pass: hasFile('src/jito/jito-rpc-client.ts') && hasFile('src/jito/bundle-builder.ts') },
  { name: 'Dynamic tip implementation exists', weight: 10, pass: hasFile('src/jito/tip-account-feed.ts') && hasFile('src/jito/dynamic-tip-estimator.ts') },
  { name: 'AI tip/timing/retry agents exist', weight: 10, pass: hasFile('src/agents/tip-intelligence-agent.ts') && hasFile('src/agents/submission-timing-agent.ts') && hasFile('src/agents/retry-reasoning-agent.ts') },
  { name: 'Failure classifier exists', weight: 7, pass: hasFile('src/core/failure-classifier.ts') },
  { name: 'Stream lifecycle tracker exists', weight: 8, pass: hasFile('src/core/lifecycle-stream-tracker.ts') },
  { name: 'First-place evidence verifier exists', weight: 5, pass: hasFile('src/cli/verify-evidence.ts') && hasFile('src/quality/evidence-policy.ts') },
];

const staticTotal = staticChecks.reduce((a, b) => a + b.weight, 0);
const staticEarned = staticChecks.filter((c) => c.pass).reduce((a, b) => a + b.weight, 0);
const staticScore = Math.round((staticEarned / staticTotal) * 100);
const evidenceScore = scoreEvidence(records, config.PUBLIC_ARCHITECTURE_URL);
const blended = records.length ? Math.round(staticScore * 0.35 + evidenceScore * 0.65) : Math.round(staticScore * 0.7);

console.log(`\nStatic implementation score: ${staticScore}/100`);
for (const c of staticChecks) console.log(`${c.pass ? '✅' : '❌'} ${c.name} (${c.weight})`);

console.log(`\nEvidence score: ${records.length ? evidenceScore : 'not generated yet'}/100`);
for (const d of evidenceDiagnostics(records, config.PUBLIC_ARCHITECTURE_URL)) console.log(`${d.level === 'pass' ? '✅' : d.level === 'warn' ? '⚠️' : '❌'} ${d.name}: ${d.detail}`);

console.log(`\nBlended first-place readiness score: ${blended}/100\n`);
if (!records.length) {
  console.log('Run `npm run challenge:first-place` with live credentials to generate final evidence. Static code alone cannot win this challenge.');
} else if (blended < config.FIRST_PLACE_MIN_SCORE) {
  console.log(`Below first-place gate ${config.FIRST_PLACE_MIN_SCORE}. Generate more real logs, failures, public URL, or stronger AI traces.`);
  process.exitCode = 1;
} else {
  console.log('First-place gate passed. Review evidence manually before submitting.');
}
