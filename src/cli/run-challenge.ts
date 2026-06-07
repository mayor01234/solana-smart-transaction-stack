import { Command } from 'commander';
import { v4 as uuidv4 } from 'uuid';
import { loadConfig } from '../config.js';
import { logger } from '../logger.js';
import { BundleOrchestrator } from '../core/orchestrator.js';
import { LifecycleStore } from '../core/lifecycle-store.js';
import { shouldInjectFailure, type FaultMode } from '../core/fault-injection.js';

const program = new Command();
program
  .option('--count <number>', 'number of bundle submissions', '25')
  .option('--failures <number>', 'number of intentional failure cases', '5')
  .option('--fault <mode>', 'force a single fault mode: none|expired_blockhash|low_tip|compute_exceeded', 'none');
program.parse(process.argv);

// Safety net for a long run: a stray transient rejection (RPC/Jito network blip) must not crash it.
process.on('unhandledRejection', (reason) => logger.warn({ reason: reason instanceof Error ? reason.message : String(reason) }, 'Unhandled rejection ignored to keep the run alive.'));

const options = program.opts<{ count: string; failures: string; fault: FaultMode }>();
const count = Number(options.count);
const failures = Number(options.failures);
const config = loadConfig();
const runId = uuidv4();

const store = new LifecycleStore(config);
const orchestrator = await BundleOrchestrator.create(config, store);

// One multiplexed Yellowstone stream (slots + our tx + pump.fun). Reconnects internally.
orchestrator.startStreams();

logger.info({ runId, count, failures, dryRun: config.ALLOW_DRY_RUN, reactToLiveEvents: config.REACT_TO_LIVE_EVENTS }, 'Starting challenge run.');
await orchestrator.waitForFirstSlot(30_000);

for (let i = 0; i < count; i += 1) {
  try {
    const fault = options.fault !== 'none' ? options.fault : shouldInjectFailure(i, failures);
    // React to a real on-chain pump.fun trade when enabled; fall back to self-driven if none arrives.
    const triggerEvent = config.REACT_TO_LIVE_EVENTS ? await orchestrator.nextTrigger(config.PUMPFUN_EVENT_TIMEOUT_MS) : undefined;
    if (config.REACT_TO_LIVE_EVENTS && !triggerEvent) logger.warn({ i }, 'No pump.fun event within timeout; proceeding self-driven.');
    logger.info({ i, fault, latestSlot: orchestrator.getLatestSlot(), triggerMint: triggerEvent?.mint }, 'Running bundle attempt.');
    await orchestrator.runAttempt({ runId, index: i, fault, currentSlotFromStream: orchestrator.getLatestSlot(), triggerEvent });
  } catch (e) {
    // One attempt's transient error (e.g. an RPC/Jito timeout) must not end the whole run.
    logger.error({ i, error: e instanceof Error ? e.message : String(e) }, 'Bundle attempt errored; continuing to next.');
  }
}

store.exportJson();
store.exportMarkdown();
store.exportSummary();
orchestrator.close();
logger.info({ runId }, 'Challenge run complete.');
process.exit(0);
