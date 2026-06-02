import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../config.js';

const config = loadConfig();
fs.mkdirSync(config.EVIDENCE_DIR, { recursive: true });
for (const f of ['lifecycle-log.jsonl','lifecycle-log.json','lifecycle-log.md','run-summary.json','scorecard.json','verification-report.md']) {
  const p = path.join(config.EVIDENCE_DIR, f);
  if (fs.existsSync(p)) fs.rmSync(p);
}
console.log(`Evidence reset in ${config.EVIDENCE_DIR}`);
