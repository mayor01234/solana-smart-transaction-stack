import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../config.js';
import type { BundleLifecycleRecord } from '../types.js';

export class LifecycleStore {
  private readonly jsonlPath: string;

  constructor(private readonly config: AppConfig) {
    fs.mkdirSync(config.EVIDENCE_DIR, { recursive: true });
    this.jsonlPath = path.join(config.EVIDENCE_DIR, 'lifecycle-log.jsonl');
  }

  append(record: BundleLifecycleRecord): void {
    this.calculateLatencies(record);
    fs.appendFileSync(this.jsonlPath, JSON.stringify(record) + '\n');
  }

  readAll(): BundleLifecycleRecord[] {
    if (!fs.existsSync(this.jsonlPath)) return [];
    return fs
      .readFileSync(this.jsonlPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as BundleLifecycleRecord);
  }

  exportJson(): string {
    const out = path.join(this.config.EVIDENCE_DIR, 'lifecycle-log.json');
    fs.writeFileSync(out, JSON.stringify(this.readAll(), null, 2));
    return out;
  }

  exportMarkdown(): string {
    const records = this.readAll();
    const out = path.join(this.config.EVIDENCE_DIR, 'lifecycle-log.md');
    const lines = [
      '# Lifecycle Log',
      '',
      '| # | Intent | Bundle ID | Signatures | Submitted Slot | Processed Slot | Confirmed Slot | Finalized Slot | Tip | Failure | AI Action | Explorer |',
      '|---:|---|---|---|---:|---:|---:|---:|---:|---|---|---|',
    ];
    records.forEach((r, i) => {
      lines.push(
        `| ${i + 1} | ${r.intent} | ${r.bundleId ?? ''} | ${r.signatures.join('<br>')} | ${r.submittedSlot ?? ''} | ${r.processedSlot ?? ''} | ${r.confirmedSlot ?? ''} | ${r.finalizedSlot ?? ''} | ${r.tipLamports} | ${r.failureClass ?? ''} | ${r.agentDecision.action} | ${r.explorerLinks.join('<br>')} |`,
      );
    });
    fs.writeFileSync(out, lines.join('\n'));
    return out;
  }

  exportSummary(): string {
    const records = this.readAll();
    const out = path.join(this.config.EVIDENCE_DIR, 'run-summary.json');
    const failures = records.filter((r) => r.failureClass);
    const finalized = records.filter((r) => r.finalizedAt);
    const tips = records.map((r) => r.tipLamports).filter((x): x is number => typeof x === 'number');
    const p2c = records.map((r) => r.latencyMs.processedToConfirmed).filter((x): x is number => typeof x === 'number');
    const s2f = records.map((r) => r.latencyMs.submittedToFinalized).filter((x): x is number => typeof x === 'number');
    const summary = {
      generatedAt: new Date().toISOString(),
      totalRecords: records.length,
      finalizedCount: finalized.length,
      failureCount: failures.length,
      failureClasses: failures.reduce<Record<string, number>>((acc, r) => {
        acc[r.failureClass!] = (acc[r.failureClass!] ?? 0) + 1;
        return acc;
      }, {}),
      averageProcessedToConfirmedMs: average(records.map((r) => r.latencyMs.processedToConfirmed)),
      p50ProcessedToConfirmedMs: percentile(p2c, 50),
      p90ProcessedToConfirmedMs: percentile(p2c, 90),
      averageSubmittedToFinalizedMs: average(records.map((r) => r.latencyMs.submittedToFinalized)),
      p50SubmittedToFinalizedMs: percentile(s2f, 50),
      p90SubmittedToFinalizedMs: percentile(s2f, 90),
      uniqueTipValues: Array.from(new Set(tips)).sort((a,b)=>a-b),
      minTipLamports: tips.length ? Math.min(...tips) : undefined,
      maxTipLamports: tips.length ? Math.max(...tips) : undefined,
      aiDecisionFamilies: Array.from(new Set(records.flatMap((r) => r.agentDecision?.modules?.map((m) => m.module) ?? []))).sort(),
    };
    fs.writeFileSync(out, JSON.stringify(summary, null, 2));
    return out;
  }

  private calculateLatencies(record: BundleLifecycleRecord): void {
    const t = (s?: string) => (s ? new Date(s).getTime() : undefined);
    const submitted = t(record.submittedAt);
    const processed = t(record.processedAt);
    const confirmed = t(record.confirmedAt);
    const finalized = t(record.finalizedAt);
    if (submitted && processed) record.latencyMs.submittedToProcessed = processed - submitted;
    if (processed && confirmed) record.latencyMs.processedToConfirmed = confirmed - processed;
    if (confirmed && finalized) record.latencyMs.confirmedToFinalized = finalized - confirmed;
    if (submitted && finalized) record.latencyMs.submittedToFinalized = finalized - submitted;
  }
}

function average(values: Array<number | undefined>): number | undefined {
  const clean = values.filter((v): v is number => typeof v === 'number');
  if (!clean.length) return undefined;
  return Math.round(clean.reduce((a, b) => a + b, 0) / clean.length);
}

function percentile(values: number[], pct: number): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1));
  return sorted[index];
}
