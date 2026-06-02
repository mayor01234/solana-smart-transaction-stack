import type { AppConfig } from '../config.js';
import type { NetworkSnapshot } from '../types.js';
import { JitoRpcClient } from './jito-rpc-client.js';

export class LeaderWindowDetector {
  constructor(private readonly config: AppConfig, private readonly jito: JitoRpcClient) {}

  async snapshot(currentSlotFromStream: number): Promise<NetworkSnapshot> {
    let slotsUntilJitoLeader: number | null = null;
    try {
      const leader = await this.jito.getNextScheduledLeader();
      const current = Number(leader.currentSlot ?? currentSlotFromStream);
      const next = Number(leader.nextLeaderSlot ?? 0);
      if (current && next) slotsUntilJitoLeader = Math.max(0, next - current);
    } catch {
      slotsUntilJitoLeader = null;
    }
    return {
      observedAt: new Date().toISOString(),
      currentSlot: currentSlotFromStream,
      slotsUntilJitoLeader,
      isJitoLeaderWindow: slotsUntilJitoLeader !== null && slotsUntilJitoLeader <= this.config.JITO_LEADER_WINDOW_MAX_SLOTS,
    };
  }
}
