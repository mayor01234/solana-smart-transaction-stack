import { Connection } from '@solana/web3.js';
import { v4 as uuidv4 } from 'uuid';
import type { AppConfig } from '../config.js';
import { logger } from '../logger.js';
import type { AgentDecisionTrace, BundleLifecycleRecord, FailureClass, NetworkSnapshot, TipSnapshot } from '../types.js';
import { TransactionDecisionAgent } from '../agents/transaction-decision-agent.js';
import { SlotStream } from '../geyser/slot-stream.js';
import { TransactionStream } from '../geyser/transaction-stream.js';
import { BundleBuilder } from '../jito/bundle-builder.js';
import { DynamicTipEstimator } from '../jito/dynamic-tip-estimator.js';
import type { BundleResultUpdate, JitoBundleClient } from '../jito/jito-bundle-client.js';
import { createJitoClient } from '../jito/jito-client-factory.js';
import { LeaderWindowDetector } from '../jito/leader-window-detector.js';
import { TipAccountFeed } from '../jito/tip-account-feed.js';
import { BlockhashManager } from './blockhash-manager.js';
import { CommitmentTracker } from './commitment-tracker.js';
import { FailureClassifier } from './failure-classifier.js';
import type { FaultMode } from './fault-injection.js';
import { intentFromFault } from './fault-injection.js';
import { LifecycleStore } from './lifecycle-store.js';
import { LifecycleStreamTracker } from './lifecycle-stream-tracker.js';
import { loadKeypair } from './keypair.js';

export interface RunAttemptArgs {
  runId: string;
  index: number;
  fault: FaultMode;
  retryOf?: string;
  previousFailure?: FailureClass;
  previousFailureMessage?: string;
  retryAttempt?: number;
  currentSlotFromStream: number;
}

export class BundleOrchestrator {
  private readonly connection: Connection;
  private readonly tipFeed: TipAccountFeed;
  private readonly tipEstimator: DynamicTipEstimator;
  private readonly decisionAgent: TransactionDecisionAgent;
  private readonly blockhashManager: BlockhashManager;
  private readonly builder = new BundleBuilder();
  private readonly failureClassifier = new FailureClassifier();
  private readonly leaderDetector: LeaderWindowDetector;
  private readonly tracker: LifecycleStreamTracker;
  private readonly bundleResults = new Map<string, BundleResultUpdate[]>();
  private unsubscribeBundleResults?: () => void;
  private readonly payer;

  private constructor(
    private readonly config: AppConfig,
    private readonly txStream: TransactionStream,
    private readonly slotStream: SlotStream,
    private readonly store: LifecycleStore,
    private readonly jito: JitoBundleClient,
  ) {
    this.connection = new Connection(config.SOLANA_RPC_URL, { commitment: 'processed', wsEndpoint: config.SOLANA_WS_URL });
    this.tipFeed = new TipAccountFeed(config, jito);
    this.tipEstimator = new DynamicTipEstimator(config);
    this.decisionAgent = new TransactionDecisionAgent(config);
    this.blockhashManager = new BlockhashManager(this.connection);
    this.leaderDetector = new LeaderWindowDetector(config, jito);
    this.tracker = new LifecycleStreamTracker(config, this.connection, txStream, new CommitmentTracker(slotStream));
    this.payer = loadKeypair(config.KEYPAIR_PATH);

    if (jito.subscribeBundleResult) {
      this.unsubscribeBundleResults = jito.subscribeBundleResult(
        (u) => {
          const list = this.bundleResults.get(u.bundleId) ?? [];
          list.push(u);
          this.bundleResults.set(u.bundleId, list);
        },
        (e) => logger.warn({ error: e }, 'Bundle-result subscription error.'),
      );
    }
  }

  static async create(config: AppConfig, txStream: TransactionStream, slotStream: SlotStream, store: LifecycleStore): Promise<BundleOrchestrator> {
    const jito = await createJitoClient(config);
    return new BundleOrchestrator(config, txStream, slotStream, store, jito);
  }

  close(): void {
    this.unsubscribeBundleResults?.();
    this.jito.close();
  }

  async runAttempt(args: RunAttemptArgs): Promise<BundleLifecycleRecord> {
    const retryAttempt = args.retryAttempt ?? 0;
    const attemptId = uuidv4();
    const network = await this.leaderDetector.snapshot(args.currentSlotFromStream);
    const tipSnapshot = await this.tipFeed.fetch();
    const tipEstimate = this.tipEstimator.estimate(tipSnapshot, network, retryAttempt);
    const decision = await this.decisionAgent.decide({
      network,
      tipSnapshot,
      tipEstimate,
      retryAttempt,
      previousFailure: args.previousFailure,
      previousFailureMessage: args.previousFailureMessage,
    });

    if (decision.action === 'hold_for_leader') {
      logger.info({ attemptId, reason: decision.reasonSummary }, 'AI agent chose to hold before submission.');
      await new Promise((resolve) => setTimeout(resolve, Math.min(this.config.JITO_LEADER_HOLD_MAX_MS, 3000)));
    }

    if (decision.action === 'abort') {
      const record = this.createBaseRecord(args, attemptId, network, decision, [], decision.selectedTipLamports);
      record.failureClass = args.previousFailure ?? 'unknown';
      record.failureMessage = `AI agent aborted: ${decision.reasonSummary}`;
      this.store.append(record);
      return record;
    }

    const tipAccount = this.tipFeed.chooseTipAccount(tipSnapshot);
    const blockhashData =
      args.fault === 'expired_blockhash'
        ? await this.blockhashManager.getIntentionallyExpiredBlockhash()
        : await this.blockhashManager.getFreshBlockhash('processed');

    const selectedTipLamports = args.fault === 'low_tip' ? Math.max(1, Math.floor(decision.selectedTipLamports * 0.01)) : decision.selectedTipLamports;

    const build = this.builder.buildDemoBundle({
      payer: this.payer,
      memo: `${this.config.DEMO_MEMO_PREFIX} run=${args.runId} index=${args.index} attempt=${attemptId}`,
      blockhash: blockhashData.blockhash,
      lastValidBlockHeight: blockhashData.lastValidBlockHeight,
      tipLamports: selectedTipLamports,
      tipAccount,
      faultComputeExceeded: args.fault === 'compute_exceeded',
    });

    const record = this.createBaseRecord(args, attemptId, network, decision, build.signatures, selectedTipLamports, tipAccount);

    try {
      if (this.config.ALLOW_DRY_RUN) {
        record.bundleId = `dry-run-${attemptId}`;
      } else {
        record.bundleId = await this.jito.sendBundle(build.transactions);
      }
      record.submittedAt = new Date().toISOString();
      record.submittedSlot = network.currentSlot;
      record.raw = {
        ...(record.raw ?? {}),
        tipSnapshotPercentiles: tipSnapshot.percentileLamports,
        selectedTipPercentile: tipSnapshot.selectedPercentile,
        dynamicTipReason: tipEstimate.reasonSummary,
        jitoLeaderWindow: network,
        jitoTransport: this.jito.transport,
        aiEngine: decision.engine,
        aiModel: decision.model,
      };
      logger.info({ bundleId: record.bundleId, signatures: record.signatures, tip: record.tipLamports, engine: decision.engine }, 'Bundle submitted.');

      if (!this.config.ALLOW_DRY_RUN) {
        await this.tracker.track(record);
      } else {
        this.applyDryRunLifecycle(record);
      }

      this.attachBundleResults(record);
      this.classifyOutcome(record, network, args.fault);
    } catch (error) {
      const classified = this.failureClassifier.classify(error);
      record.failureClass = classified.failureClass;
      record.failureMessage = classified.normalizedMessage;
      logger.warn({ attemptId, failureClass: record.failureClass, error }, 'Bundle attempt failed.');
    }

    this.store.append(record);

    if (record.failureClass) {
      return this.maybeRetry(args, record, network, tipSnapshot, retryAttempt);
    }
    return record;
  }

  /** Determine failure (if any) for a submitted bundle from observed lifecycle + bundle results. */
  private classifyOutcome(record: BundleLifecycleRecord, network: NetworkSnapshot, fault: FaultMode): void {
    // 1. Landed in a block but failed execution (e.g. compute exceeded).
    const observedErr = (record.raw ?? {})['observedTransactionError'];
    if (record.processedAt && observedErr !== undefined && observedErr !== null) {
      const classified = this.failureClassifier.classify(`transaction error: ${JSON.stringify(observedErr)}`);
      record.failureClass = fault === 'compute_exceeded' ? 'compute_exceeded' : classified.failureClass;
      record.failureMessage = `Transaction landed but failed execution: ${JSON.stringify(observedErr)}`;
      return;
    }

    // 2. Successful progression — no failure.
    if (record.processedAt) return;

    // 3. Never landed. Use the known injected cause first, then bundle-result state, then timeout.
    if (fault === 'expired_blockhash') {
      record.failureClass = 'expired_blockhash';
      record.failureMessage = 'Intentionally expired blockhash never produced a processed observation.';
      return;
    }
    if (fault === 'low_tip') {
      record.failureClass = 'fee_too_low';
      record.failureMessage = 'Intentionally low tip lost the Jito auction; bundle did not land.';
      return;
    }

    const resultsText = JSON.stringify(record.raw?.['bundleResults'] ?? '').toLowerCase();
    if (resultsText.includes('rejected') || resultsText.includes('dropped')) {
      const classified = this.failureClassifier.classify(`bundle ${resultsText}`);
      record.failureClass = classified.failureClass;
      record.failureMessage = classified.normalizedMessage;
      return;
    }

    const classified = this.failureClassifier.classifyTimeout(network.slotsUntilJitoLeader);
    record.failureClass = classified.failureClass;
    record.failureMessage = classified.normalizedMessage;
  }

  private attachBundleResults(record: BundleLifecycleRecord): void {
    if (!record.bundleId) return;
    const results = this.bundleResults.get(record.bundleId);
    if (results?.length) {
      record.raw = { ...(record.raw ?? {}), bundleResults: results };
      this.bundleResults.delete(record.bundleId);
    }
  }

  private async maybeRetry(
    args: RunAttemptArgs,
    record: BundleLifecycleRecord,
    network: NetworkSnapshot,
    tipSnapshot: TipSnapshot,
    retryAttempt: number,
  ): Promise<BundleLifecycleRecord> {
    if (retryAttempt >= this.config.AI_MAX_RETRY_ATTEMPTS) return record;

    const next = await this.decisionAgent.decide({
      network,
      tipSnapshot,
      tipEstimate: this.tipEstimator.estimate(tipSnapshot, network, retryAttempt + 1),
      retryAttempt: retryAttempt + 1,
      previousFailure: record.failureClass,
      previousFailureMessage: record.failureMessage,
    });

    const retryActions = ['retry_refresh_blockhash', 'retry_increase_tip', 'retry_same_tip', 'hold_for_leader'];
    if (!retryActions.includes(next.action)) return record;

    logger.info({ from: record.attemptId, action: next.action, engine: next.engine }, 'AI agent authorized autonomous retry.');
    // Use the freshest slot from the stream for the retry attempt.
    return this.runAttempt({
      ...args,
      fault: 'none',
      retryOf: record.attemptId,
      previousFailure: record.failureClass,
      previousFailureMessage: record.failureMessage,
      retryAttempt: retryAttempt + 1,
      currentSlotFromStream: this.slotStream.getLatestSlot() || args.currentSlotFromStream,
    });
  }

  private createBaseRecord(
    args: RunAttemptArgs,
    attemptId: string,
    network: NetworkSnapshot,
    decision: AgentDecisionTrace,
    signatures: string[],
    tipLamports: number,
    tipAccount?: string,
  ): BundleLifecycleRecord {
    return {
      runId: args.runId,
      attemptId,
      parentAttemptId: args.retryOf,
      retryOf: args.retryOf,
      intent: intentFromFault(args.fault),
      signatures,
      latencyMs: {},
      tipLamports,
      tipAccount,
      leaderWindow: network,
      agentDecision: decision,
      explorerLinks: signatures.map((s) => `https://explorer.solana.com/tx/${s}?cluster=${this.config.TARGET_CLUSTER}`),
    };
  }

  private applyDryRunLifecycle(record: BundleLifecycleRecord): void {
    const now = Date.now();
    record.processedAt = new Date(now + 250).toISOString();
    record.confirmedAt = new Date(now + 1300).toISOString();
    record.finalizedAt = new Date(now + 7800).toISOString();
    record.processedSlot = record.submittedSlot;
    record.confirmedSlot = (record.submittedSlot ?? 0) + 1;
    record.finalizedSlot = (record.submittedSlot ?? 0) + 32;
    record.commitmentSource = { processed: 'dry_run', confirmed: 'dry_run', finalized: 'dry_run' };
  }
}
