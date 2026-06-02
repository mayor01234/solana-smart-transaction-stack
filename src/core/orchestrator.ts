import { Connection } from '@solana/web3.js';
import { v4 as uuidv4 } from 'uuid';
import type { AppConfig } from '../config.js';
import { logger } from '../logger.js';
import type { BundleLifecycleRecord, FailureClass } from '../types.js';
import { TransactionDecisionAgent } from '../agents/transaction-decision-agent.js';
import { TransactionStream } from '../geyser/transaction-stream.js';
import { BundleBuilder } from '../jito/bundle-builder.js';
import { DynamicTipEstimator } from '../jito/dynamic-tip-estimator.js';
import { JitoRpcClient } from '../jito/jito-rpc-client.js';
import { LeaderWindowDetector } from '../jito/leader-window-detector.js';
import { TipAccountFeed } from '../jito/tip-account-feed.js';
import { BlockhashManager } from './blockhash-manager.js';
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
  private readonly jito: JitoRpcClient;
  private readonly tipFeed: TipAccountFeed;
  private readonly tipEstimator: DynamicTipEstimator;
  private readonly decisionAgent: TransactionDecisionAgent;
  private readonly blockhashManager: BlockhashManager;
  private readonly builder = new BundleBuilder();
  private readonly failureClassifier = new FailureClassifier();
  private readonly leaderDetector: LeaderWindowDetector;
  private readonly tracker: LifecycleStreamTracker;
  private readonly payer;

  constructor(
    private readonly config: AppConfig,
    private readonly txStream: TransactionStream,
    private readonly store: LifecycleStore,
  ) {
    this.connection = new Connection(config.SOLANA_RPC_URL, {
      commitment: 'processed',
      wsEndpoint: config.SOLANA_WS_URL,
    });
    this.jito = new JitoRpcClient(config);
    this.tipFeed = new TipAccountFeed(config, this.jito);
    this.tipEstimator = new DynamicTipEstimator(config);
    this.decisionAgent = new TransactionDecisionAgent(config);
    this.blockhashManager = new BlockhashManager(this.connection);
    this.leaderDetector = new LeaderWindowDetector(config, this.jito);
    this.tracker = new LifecycleStreamTracker(config, this.connection, txStream);
    this.payer = loadKeypair(config.KEYPAIR_PATH);
  }

  async runAttempt(args: RunAttemptArgs): Promise<BundleLifecycleRecord> {
    const retryAttempt = args.retryAttempt ?? 0;
    const attemptId = uuidv4();
    const network = await this.leaderDetector.snapshot(args.currentSlotFromStream);
    const tipSnapshot = await this.tipFeed.fetch();
    const tipEstimate = this.tipEstimator.estimate(tipSnapshot, network, retryAttempt);
    const decision = this.decisionAgent.decide({
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
    let blockhashData =
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
        record.bundleId = await this.jito.sendBundle(build.serializedTransactions);
      }
      record.submittedAt = new Date().toISOString();
      record.raw = { ...(record.raw ?? {}), tipSnapshotPercentiles: tipSnapshot.percentileLamports, selectedTipPercentile: tipSnapshot.selectedPercentile, dynamicTipReason: tipEstimate.reasonSummary, jitoLeaderWindow: network };
      record.submittedSlot = network.currentSlot;
      logger.info({ bundleId: record.bundleId, signatures: record.signatures, tip: record.tipLamports }, 'Bundle submitted.');

      if (!this.config.ALLOW_DRY_RUN) {
        await this.tracker.track(record);
      } else {
        this.applyDryRunLifecycle(record);
      }

      if (!record.processedAt) {
        if (record.bundleId) {
          try {
            const status = await this.jito.getInflightBundleStatuses([record.bundleId]);
            record.raw = { ...(record.raw ?? {}), inflightBundleStatus: status, tipSnapshotPercentiles: tipSnapshot.percentileLamports, selectedTipPercentile: tipSnapshot.selectedPercentile, dynamicTipReason: tipEstimate.reasonSummary };
            const statusText = JSON.stringify(status).toLowerCase();
            if (statusText.includes('failed') || statusText.includes('invalid')) {
              const classifiedStatus = this.failureClassifier.classify(`bundle failure: ${statusText}`);
              record.failureClass = classifiedStatus.failureClass;
              record.failureMessage = classifiedStatus.normalizedMessage;
            }
          } catch (statusError) {
            record.raw = { ...(record.raw ?? {}), bundleStatusError: String(statusError) };
          }
        }
        if (!record.failureClass) {
          const classified = this.failureClassifier.classifyTimeout(network.slotsUntilJitoLeader);
          record.failureClass = classified.failureClass;
          record.failureMessage = classified.normalizedMessage;
        }
      }
    } catch (error) {
      const classified = this.failureClassifier.classify(error);
      record.failureClass = classified.failureClass;
      record.failureMessage = classified.normalizedMessage;
      logger.warn({ attemptId, failureClass: record.failureClass, error }, 'Bundle attempt failed.');
    }

    this.store.append(record);

    if (record.failureClass && retryAttempt < this.config.AI_MAX_RETRY_ATTEMPTS) {
      const next = this.decisionAgent.decide({
        network,
        tipSnapshot,
        tipEstimate: this.tipEstimator.estimate(tipSnapshot, network, retryAttempt + 1),
        retryAttempt: retryAttempt + 1,
        previousFailure: record.failureClass,
        previousFailureMessage: record.failureMessage,
      });
      if (next.action === 'retry_refresh_blockhash' || next.action === 'retry_increase_tip' || next.action === 'retry_same_tip' || next.action === 'hold_for_leader') {
        logger.info({ from: attemptId, action: next.action }, 'AI agent authorized autonomous retry.');
        return this.runAttempt({
          ...args,
          fault: 'none',
          retryOf: attemptId,
          previousFailure: record.failureClass,
          previousFailureMessage: record.failureMessage,
          retryAttempt: retryAttempt + 1,
          currentSlotFromStream: args.currentSlotFromStream,
        });
      }
    }

    return record;
  }

  private createBaseRecord(
    args: RunAttemptArgs,
    attemptId: string,
    network: any,
    decision: any,
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
  }
}
