import type { SlotStream } from '../geyser/slot-stream.js';

export interface CommitmentObservation {
  slot: number;
  observedAt: number;
}

/**
 * Confirms transaction landing purely from the Yellowstone slot-status stream.
 *
 * A transaction first observed in processed slot S is treated as confirmed once the cluster confirms
 * a slot >= S on the canonical chain, and finalized once a slot >= S is rooted. Optimistic
 * confirmation and rooting are monotonic along the canonical fork, so "highest confirmed/finalized
 * slot has advanced past S" is a sound, stream-only landing signal — no RPC polling involved.
 */
export class CommitmentTracker {
  constructor(private readonly slotStream: SlotStream) {}

  waitForCommitment(slot: number, level: 'confirmed' | 'finalized', timeoutMs: number): Promise<CommitmentObservation> {
    const reached = () => (level === 'finalized' ? this.slotStream.getLatestFinalizedSlot() : this.slotStream.getLatestConfirmedSlot());

    return new Promise<CommitmentObservation>((resolve, reject) => {
      if (reached() >= slot) {
        resolve({ slot: reached(), observedAt: Date.now() });
        return;
      }
      const onSlot = () => {
        const current = reached();
        if (current >= slot) {
          cleanup();
          resolve({ slot: current, observedAt: Date.now() });
        }
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`stream commitment timeout ${timeoutMs}ms (${level} slot >= ${slot})`));
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        this.slotStream.off('slot', onSlot);
      };
      this.slotStream.on('slot', onSlot);
    });
  }
}
