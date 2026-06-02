export type FaultMode = 'none' | 'expired_blockhash' | 'low_tip' | 'compute_exceeded';

export function intentFromFault(fault: FaultMode): 'normal' | 'fault_expired_blockhash' | 'fault_low_tip' | 'fault_compute_exceeded' {
  switch (fault) {
    case 'expired_blockhash':
      return 'fault_expired_blockhash';
    case 'low_tip':
      return 'fault_low_tip';
    case 'compute_exceeded':
      return 'fault_compute_exceeded';
    default:
      return 'normal';
  }
}

export function shouldInjectFailure(index: number, totalFailures: number): FaultMode {
  if (index >= totalFailures) return 'none';
  const cycle: FaultMode[] = ['expired_blockhash', 'low_tip', 'compute_exceeded', 'expired_blockhash', 'low_tip'];
  return cycle[index % cycle.length]!;
}
