# AgentArena Superteam Infra v3

First-place-focused Solana smart transaction stack for the **Superteam Advanced Infrastructure Challenge**.

This repo is built around one operational promise:

```text
Yellowstone/Geyser stream → Jito leader window → AI timing/tip/retry decision → dynamic Jito bundle → stream-confirmed lifecycle evidence → failure-classified autonomous retry
```

It is intentionally not just a happy-path demo. It includes controlled failures, AI decision traces, live tip repricing, stream-based landing observation, evidence export, and a first-place scoring gate.

## What this implements

- Yellowstone/Geyser live slot stream
- Yellowstone/Geyser transaction stream for processed landing observation
- Reconnection, ping, and backpressure controls
- Jito leader-window detection
- Jito tip account discovery
- Jito tip-floor ingestion
- Dynamic tip estimator from live data + network conditions
- Versioned transaction bundle builder with Jito tip transfer
- Jito `sendBundle`
- Jito `getInflightBundleStatuses` / `getBundleStatuses` fallback status checks
- Lifecycle tracking: submitted → processed → confirmed → finalized
- Slot numbers, timestamps, and latency deltas
- Failure classification: expired blockhash, fee too low, compute exceeded, bundle failure, leader skip/not forwarded, confirmation timeout, stream disconnect
- AI decision agent with three decision families:
  - tip intelligence
  - submission timing
  - autonomous retry/failure reasoning
- Fault injection:
  - expired blockhash
  - intentionally low tip
  - compute exceeded
- Evidence exporter: JSONL, JSON, Markdown, run summary, scorecard
- First-place gate: target 25 real bundle records and 5 failure cases, not just the minimum 10/2

## Folder structure

```text
src/geyser/      Yellowstone/Geyser stream clients
src/jito/        Jito RPC, bundle builder, tip estimator, leader window detector
src/agents/      AI operational decision agents
src/core/        Orchestrator, lifecycle tracker, failure classifier, blockhash manager
src/quality/     First-place evidence scoring policy
src/cli/         Challenge runner, preflight, evidence verifier, self-score tools
docs/            Architecture, diagrams, requirement mapping, scorecard, checklist
evidence/        Generated lifecycle logs and submission evidence
```

## Requirements

- Node.js 20.11+
- Solana CLI
- A funded keypair
- Premium Solana RPC + WebSocket endpoint
- Yellowstone/Geyser gRPC endpoint and token
- Jito block-engine endpoint
- Access to live Jito tip-floor data

## Quick start in VS Code

```bash
cd agentarena-superteam-infra-v3
cp .env.example .env
npm install
```

Edit `.env`:

```text
SOLANA_RPC_URL=https://...
SOLANA_WS_URL=wss://...
YELLOWSTONE_GRPC_URL=https://...
YELLOWSTONE_TOKEN=...
JITO_BLOCK_ENGINE_URL=https://mainnet.block-engine.jito.wtf
JITO_TIP_FLOOR_URL=https://bundles.jito.wtf/api/v1/bundles/tip_floor
KEYPAIR_PATH=./keys/payer.json
PUBLIC_ARCHITECTURE_URL=https://your-public-doc-url
ALLOW_DRY_RUN=false
```

Create/fund a keypair:

```bash
mkdir -p keys
solana-keygen new --outfile keys/payer.json
solana balance --keypair keys/payer.json
```

## Preflight

```bash
npm run challenge:doctor
npm run watch:slots
```

## First-place evidence run

This intentionally exceeds the minimum challenge requirement. It targets **25 real bundle attempts** and **5 controlled failures** by default.

```bash
npm run challenge:first-place
```

Equivalent manual commands:

```bash
npm run challenge:reset-evidence
npm run challenge:run -- --count 25 --failures 5
npm run challenge:export-evidence
npm run challenge:verify-evidence
npm run challenge:score
```

Generated evidence:

```text
evidence/lifecycle-log.jsonl
evidence/lifecycle-log.json
evidence/lifecycle-log.md
evidence/run-summary.json
evidence/scorecard.json
evidence/verification-report.md
```

## Valid versus invalid evidence

Valid challenge evidence must be generated with live infrastructure:

```text
ALLOW_DRY_RUN=false
```

Dry-run logs are useful for local development only. Do not submit dry-run bundle IDs.

## Public architecture document

The challenge requires a public architecture document hosted separately from GitHub. Publish this file publicly:

```text
docs/ARCHITECTURE_PUBLIC.md
```

Use Notion, Google Docs, Figma, or a static public URL. Then add that URL to:

```text
PUBLIC_ARCHITECTURE_URL=
```

## README Question 1

### What does the delta between `processed_at` and `confirmed_at` tell you about network health at the time of submission?

The `processed_at → confirmed_at` delta measures how quickly a transaction moves from first observed execution in a processed slot to a commitment level where the cluster has voted sufficiently on the block. A small delta usually indicates healthy leader execution, fast propagation, low congestion, and normal vote progress. A large delta can indicate congestion, delayed votes, fork uncertainty, leader instability, poor propagation, or a transaction that was initially observed but took longer to accumulate confirmation weight.

This stack records `processed_to_confirmed_ms` per bundle and summarizes p50/p90 values in `evidence/run-summary.json`, so the README answer can be backed by actual run observations rather than theory.

## README Question 2

### Why should you never use finalized commitment when fetching a blockhash for a time-sensitive transaction?

A finalized blockhash is older than the freshest processed or confirmed blockhash because finalization intentionally lags behind the head of the chain. For a time-sensitive Jito bundle, that delay consumes part of the transaction validity window before the bundle is even built or submitted. This increases expiry risk, especially if the stack waits for a Jito leader window or needs a retry. This repo fetches blockhashes at `processed` by default and lets the AI retry agent rebuild with a fresh blockhash when expiry is detected.

## README Question 3

### What happens to your bundle if the Jito leader skips their slot?

If the intended Jito leader skips its slot, the bundle may be accepted by the block engine but fail to land in the expected slot. The bundle can then remain unprocessed, appear as failed/not landed in bundle status checks, or miss the validity/timing window. This stack treats missing commitment progression around the intended leader window as `leader_skipped_or_bundle_not_forwarded`, records the failure, and lets the AI agent decide whether to hold for the next Jito leader, refresh the blockhash, recalculate the tip, retry, or abort.

## Submission package

Submit:

- GitHub repo URL
- Public architecture document URL
- `evidence/lifecycle-log.json`
- `evidence/lifecycle-log.md`
- `evidence/run-summary.json`
- `evidence/verification-report.md`
- Explorer links/signatures/slot numbers from the evidence files
- Short demo video or screenshots showing the live run, if possible

## First-place benchmark

Minimum challenge target:

```text
10 real bundle records
2 failure cases
1 AI operational decision
```

This repo's first-place target:

```text
25 real bundle records
5 controlled failure cases
3 AI decision families: tip, timing, retry
No dry-run evidence
Dynamic tips with multiple observed values
Explorer-verifiable signatures
Public architecture URL
p50/p90 latency observations in run summary
```
