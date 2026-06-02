import { Command } from 'commander';
import { v4 as uuidv4 } from 'uuid';
import { loadConfig } from '../config.js';
import { logger } from '../logger.js';
import { SlotStream } from '../geyser/slot-stream.js';
import { TransactionStream } from '../geyser/transaction-stream.js';
import { BundleOrchestrator } from '../core/orchestrator.js';
import { LifecycleStore } from '../core/lifecycle-store.js';
import { shouldInjectFailure, type FaultMode } from '../core/fault-injection.js';

const program = new Command();
program
  .option('--count <number>', 'number of bundle submissions', '25')
  .option('--failures <number>', 'number of intentional failure cases', '5')
  .option('--fault <mode>', 'force a single fault mode: none|expired_blockhash|low_tip|compute_exceeded', 'none');
program.parse(process.argv);

const options = program.opts<{ count: string; failures: string; fault: FaultMode }>();
const count = Number(options.count);
const failures = Number(options.failures);
const config = loadConfig();
const runId = uuidv4();

const slotStream = new SlotStream(config);
const txStream = new TransactionStream(config);
const store = new LifecycleStore(config);
const orchestrator = new BundleOrchestrator(config, txStream, store);

let latestSlot = 0;
slotStream.on('slot', (slot) => (latestSlot = slot.slot));

// Start long-lived streams. They reconnect internally.
slotStream.start().catch((e) => logger.error({ e }, 'Slot stream stopped.'));
txStream.start().catch((e) => logger.error({ e }, 'Transaction stream stopped.'));

logger.info({ runId, count, failures, dryRun: config.ALLOW_DRY_RUN }, 'Starting challenge run.');
await waitFor(() => latestSlot > 0, 30_000, 'Timed out waiting for Yellowstone slot stream.');

for (let i = 0; i < count; i += 1) {
  const fault = options.fault !== 'none' ? options.fault : shouldInjectFailure(i, failures);
  logger.info({ i, fault, latestSlot }, 'Running bundle attempt.');
  await orchestrator.runAttempt({ runId, index: i, fault, currentSlotFromStream: latestSlot });
}

store.exportJson();
store.exportMarkdown();
store.exportSummary();
logger.info({ runId }, 'Challenge run complete.');
process.exit(0);

async function waitFor(predicate: () => boolean, timeoutMs: number, message: string): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
