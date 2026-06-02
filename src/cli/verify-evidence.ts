import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../config.js';
import { LifecycleStore } from '../core/lifecycle-store.js';
import { evidenceDiagnostics, scoreEvidence } from '../quality/evidence-policy.js';

const config = loadConfig();
const store = new LifecycleStore(config);
const records = store.readAll();
const diagnostics = evidenceDiagnostics(records, config.PUBLIC_ARCHITECTURE_URL);
const score = scoreEvidence(records, config.PUBLIC_ARCHITECTURE_URL);
const lines = ['# Evidence Verification Report', '', `Generated: ${new Date().toISOString()}`, '', `Score: **${score}/100**`, '', '| Status | Check | Detail |', '|---|---|---|'];
for (const d of diagnostics) lines.push(`| ${d.level === 'pass' ? 'PASS' : d.level === 'warn' ? 'WARN' : 'FAIL'} | ${d.name} | ${d.detail.replaceAll('|','/')} |`);

const outMd = path.join(config.EVIDENCE_DIR, 'verification-report.md');
const outJson = path.join(config.EVIDENCE_DIR, 'scorecard.json');
fs.writeFileSync(outMd, lines.join('\n'));
fs.writeFileSync(outJson, JSON.stringify({ generatedAt: new Date().toISOString(), score, diagnostics }, null, 2));
console.log(lines.join('\n'));
console.log(`\nWrote ${outMd}`);
if (score < config.FIRST_PLACE_MIN_SCORE) {
  console.error(`\nScore ${score} is below configured first-place gate ${config.FIRST_PLACE_MIN_SCORE}.`);
  process.exitCode = 1;
}
