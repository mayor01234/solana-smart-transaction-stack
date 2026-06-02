import type { AppConfig } from '../config.js';
import type { TipSnapshot } from '../types.js';
import type { JitoBundleClient } from './jito-bundle-client.js';

function numeric(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export class TipAccountFeed {
  private lastSnapshot?: TipSnapshot;
  constructor(private readonly config: AppConfig, private readonly jito: JitoBundleClient) {}

  async fetch(): Promise<TipSnapshot> {
    const [tipAccounts, tipFloor] = await Promise.all([this.jito.getTipAccounts(), this.fetchTipFloor()]);
    const percentileLamports = this.normalizeTipFloor(tipFloor);
    const snapshot: TipSnapshot = {
      fetchedAt: new Date().toISOString(),
      tipAccounts,
      percentileLamports,
      selectedPercentile: this.config.TIP_PERCENTILE_TARGET,
      source: this.config.JITO_TIP_FLOOR_URL,
    };
    this.lastSnapshot = snapshot;
    return snapshot;
  }

  chooseTipAccount(snapshot: TipSnapshot): string {
    if (!snapshot.tipAccounts.length) throw new Error('No live Jito tip accounts returned.');
    return snapshot.tipAccounts[Math.floor(Math.random() * snapshot.tipAccounts.length)]!;
  }

  private async fetchTipFloor(): Promise<unknown> {
    const res = await fetch(this.config.JITO_TIP_FLOOR_URL, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`Jito tip floor HTTP ${res.status}: ${await res.text()}`);
    return res.json();
  }

  private normalizeTipFloor(raw: any): Record<string, number> {
    const row = Array.isArray(raw) ? raw[0] : raw;
    if (!row || typeof row !== 'object') throw new Error(`Unexpected tip floor response: ${JSON.stringify(raw).slice(0, 200)}`);
    const candidates: Record<string, number> = {};
    for (const [k, v] of Object.entries(row)) {
      const n = numeric(v);
      if (n === undefined) continue;
      const lower = k.toLowerCase();
      let lamports = n;
      if (lamports > 0 && lamports < 1) lamports = lamports * 1_000_000_000;
      if (lower.includes('25')) candidates['25'] = Math.max(1, Math.round(lamports));
      if (lower.includes('50') || lower.includes('median')) candidates['50'] = Math.max(1, Math.round(lamports));
      if (lower.includes('75')) candidates['75'] = Math.max(1, Math.round(lamports));
      if (lower.includes('95')) candidates['95'] = Math.max(1, Math.round(lamports));
      if (lower.includes('99')) candidates['99'] = Math.max(1, Math.round(lamports));
    }
    if (!Object.keys(candidates).length) throw new Error(`No numeric tip percentiles found: ${JSON.stringify(row).slice(0, 300)}`);
    return candidates;
  }
}
