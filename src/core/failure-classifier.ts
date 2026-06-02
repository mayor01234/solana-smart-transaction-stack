import type { FailureClass } from '../types.js';
export class FailureClassifier {
  classify(messageOrError: unknown): { failureClass: FailureClass; normalizedMessage: string } {
    const normalizedMessage = this.normalize(messageOrError); const msg = normalizedMessage.toLowerCase();
    if (msg.includes('blockhash not found') || msg.includes('expired') || msg.includes('block height exceeded')) return { failureClass: 'expired_blockhash', normalizedMessage };
    if (msg.includes('tip too low') || msg.includes('fee too low') || msg.includes('priority fee') || msg.includes('insufficient tip')) return { failureClass: 'fee_too_low', normalizedMessage };
    if (msg.includes('compute') && (msg.includes('exceeded') || msg.includes('budget'))) return { failureClass: 'compute_exceeded', normalizedMessage };
    if (msg.includes('leader') && (msg.includes('skipped') || msg.includes('not forwarded') || msg.includes('missed'))) return { failureClass: 'leader_skipped_or_bundle_not_forwarded', normalizedMessage };
    if (msg.includes('stream') && (msg.includes('disconnect') || msg.includes('unavailable') || msg.includes('reset'))) return { failureClass: 'stream_disconnected', normalizedMessage };
    if (msg.includes('bundle') && (msg.includes('rejected') || msg.includes('failed') || msg.includes('dropped') || msg.includes('invalid'))) return { failureClass: 'bundle_failure', normalizedMessage };
    if (msg.includes('timeout') || msg.includes('not finalized') || msg.includes('not confirmed')) return { failureClass: 'confirmation_timeout', normalizedMessage };
    return { failureClass: 'unknown', normalizedMessage };
  }
  classifyTimeout(slotsUntilLeader: number | null): { failureClass: FailureClass; normalizedMessage: string } {
    if (slotsUntilLeader !== null && slotsUntilLeader <= 1) return { failureClass: 'leader_skipped_or_bundle_not_forwarded', normalizedMessage: 'No stream commitment progression after intended Jito leader window; possible leader skip or bundle not forwarded.' };
    return { failureClass: 'confirmation_timeout', normalizedMessage: 'No commitment progression before lifecycle timeout.' };
  }
  private normalize(value: unknown): string { if (value instanceof Error) return value.message; if (typeof value === 'string') return value; try { return JSON.stringify(value); } catch { return String(value); } }
}
