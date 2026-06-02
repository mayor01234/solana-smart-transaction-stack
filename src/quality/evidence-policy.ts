import type { BundleLifecycleRecord } from '../types.js';

export interface EvidencePolicy {
  minimumRecords: number;
  targetRecords: number;
  minimumFailures: number;
  targetFailures: number;
  minimumFinalizedSuccessful: number;
  requireNoDryRun: boolean;
  requireExplorerLinks: boolean;
  requireDynamicTips: boolean;
  requireAiReasoningForAll: boolean;
  requireThreeAiDecisionFamilies: boolean;
  requirePublicArchitectureUrl: boolean;
}

export const FIRST_PLACE_POLICY: EvidencePolicy = {
  minimumRecords: 10,
  targetRecords: 25,
  minimumFailures: 2,
  targetFailures: 5,
  minimumFinalizedSuccessful: 8,
  requireNoDryRun: true,
  requireExplorerLinks: true,
  requireDynamicTips: true,
  requireAiReasoningForAll: true,
  requireThreeAiDecisionFamilies: true,
  requirePublicArchitectureUrl: true,
};

export function classifyDecisionFamilies(records: BundleLifecycleRecord[]): Set<string> {
  const families = new Set<string>();
  for (const r of records) {
    const modules = r.agentDecision?.modules ?? [];
    for (const m of modules) families.add(m.module);
    if (r.agentDecision?.action?.includes('retry')) families.add('retry');
    if (r.agentDecision?.action === 'hold_for_leader' || r.agentDecision?.action === 'submit_now') families.add('timing');
    if ((r.agentDecision?.selectedTipLamports ?? 0) > 0) families.add('tip');
  }
  return families;
}

export function evidenceDiagnostics(records: BundleLifecycleRecord[], publicArchitectureUrl?: string): Array<{level:'pass'|'warn'|'fail'; name:string; detail:string}> {
  const failures = records.filter((r) => r.failureClass);
  const finalized = records.filter((r) => r.finalizedAt);
  const dryRun = records.filter((r) => String(r.bundleId ?? '').startsWith('dry-run-'));
  const tips = new Set(records.map((r) => r.tipLamports).filter(Boolean));
  const withAi = records.filter((r) => r.agentDecision?.reasonSummary && r.agentDecision?.signals);
  const withExplorer = records.filter((r) => r.explorerLinks?.length && r.explorerLinks.every((x) => x.includes('explorer.solana.com/tx/')));
  const families = classifyDecisionFamilies(records);
  return [
    { level: records.length >= FIRST_PLACE_POLICY.targetRecords ? 'pass' : records.length >= FIRST_PLACE_POLICY.minimumRecords ? 'warn' : 'fail', name: 'Evidence volume', detail: `${records.length} records; target ${FIRST_PLACE_POLICY.targetRecords}, minimum ${FIRST_PLACE_POLICY.minimumRecords}.` },
    { level: failures.length >= FIRST_PLACE_POLICY.targetFailures ? 'pass' : failures.length >= FIRST_PLACE_POLICY.minimumFailures ? 'warn' : 'fail', name: 'Failure cases', detail: `${failures.length} classified failures; target ${FIRST_PLACE_POLICY.targetFailures}, minimum ${FIRST_PLACE_POLICY.minimumFailures}.` },
    { level: finalized.length >= FIRST_PLACE_POLICY.minimumFinalizedSuccessful ? 'pass' : 'fail', name: 'Finalized successful records', detail: `${finalized.length} finalized records.` },
    { level: dryRun.length === 0 && records.length > 0 ? 'pass' : 'fail', name: 'No dry-run evidence', detail: `${dryRun.length} dry-run records detected.` },
    { level: tips.size > 1 ? 'pass' : 'fail', name: 'Dynamic tips', detail: `${tips.size} unique tip values.` },
    { level: withAi.length === records.length && records.length > 0 ? 'pass' : 'fail', name: 'AI reasoning traces', detail: `${withAi.length}/${records.length} records include AI reasoning.` },
    { level: withExplorer.length === records.length && records.length > 0 ? 'pass' : 'fail', name: 'Explorer-verifiable links', detail: `${withExplorer.length}/${records.length} records include explorer links.` },
    { level: families.has('tip') && families.has('timing') && families.has('retry') ? 'pass' : 'warn', name: 'AI decision families', detail: `Observed families: ${[...families].sort().join(', ') || 'none'}.` },
    { level: publicArchitectureUrl ? 'pass' : 'warn', name: 'Public architecture URL', detail: publicArchitectureUrl ? publicArchitectureUrl : 'Publish docs/ARCHITECTURE_PUBLIC.md and set PUBLIC_ARCHITECTURE_URL.' },
  ];
}

export function scoreEvidence(records: BundleLifecycleRecord[], publicArchitectureUrl?: string): number {
  const diagnostics = evidenceDiagnostics(records, publicArchitectureUrl);
  const weights: Record<string, number> = {
    'Evidence volume': 16,
    'Failure cases': 10,
    'Finalized successful records': 10,
    'No dry-run evidence': 10,
    'Dynamic tips': 12,
    'AI reasoning traces': 14,
    'Explorer-verifiable links': 10,
    'AI decision families': 10,
    'Public architecture URL': 8,
  };
  let earned = 0;
  let total = 0;
  for (const d of diagnostics) {
    const w = weights[d.name] ?? 0;
    total += w;
    if (d.level === 'pass') earned += w;
    if (d.level === 'warn') earned += w * 0.55;
  }
  return Math.round((earned / Math.max(1, total)) * 100);
}
