import type { AppConfig } from '../config.js';
import type { NetworkSnapshot } from '../types.js';
import type { JitoBundleClient } from './jito-bundle-client.js';

export class LeaderWindowDetector {
  constructor(private readonly config: AppConfig, private readonly jito: JitoBundleClient) {}

  async snapshot(currentSlotFromStream: number): Promise<NetworkSnapshot> {
    let slotsUntilJitoLeader: number | null = null;
    let nextLeaderIdentity: string | undefined;
    try {
      const leader = await this.jito.getNextScheduledLeader();
      const current = Number(leader.currentSlot ?? currentSlotFromStream);
      const next = Number(leader.nextLeaderSlot ?? 0);
      nextLeaderIdentity = leader.nextLeaderIdentity;
      if (current && next) slotsUntilJitoLeader = Math.max(0, next - current);
    } catch {
      slotsUntilJitoLeader = null;
    }
    return {
      observedAt: new Date().toISOString(),
      currentSlot: currentSlotFromStream,
      slotsUntilJitoLeader,
      nextLeaderIdentity,
      isJitoLeaderWindow: slotsUntilJitoLeader !== null && slotsUntilJitoLeader <= this.config.JITO_LEADER_WINDOW_MAX_SLOTS,
    };
  }
}
