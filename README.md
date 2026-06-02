# AgentArena Superteam Infra v3

First-place-focused Solana smart transaction stack for the **Superteam Advanced Infrastructure Challenge**.

This repo is built around one operational promise:

```text
Yellowstone/Geyser stream → Jito leader window → AI timing/tip/retry decision → dynamic Jito bundle → stream-confirmed lifecycle evidence → failure-classified autonomous retry
```

It is intentionally not just a happy-path demo. It includes controlled failures, AI decision traces, live tip repricing, stream-based landing observation, evidence export, and a first-place scoring gate.

## Infrastructure (bounty sponsors)

- **SolInfra** — RPC nodes + Yellowstone/Geyser gRPC access (the live infrastructure this stack runs on).
- **Jito** — block engine + tip floor, accessed through the official **jito-ts** TypeScript SDK.
- **Anthropic Claude** — the LLM that powers the AI agent's reasoning. No AI vendor is named by the
  bounty, so this rivals no sponsor; it is fully optional and the stack degrades to a transparent
  deterministic engine when no key is set.

## What this implements

- Yellowstone/Geyser live slot stream (tracks processed, confirmed, and finalized slot status)
- Yellowstone/Geyser transaction stream for processed landing observation
- Reconnection, ping, and backpressure controls
- Jito leader-window detection via `getNextScheduledLeader`
- Jito tip account discovery + tip-floor ingestion
- Dynamic tip estimator from live data + network conditions (no hardcoded tips)
- Versioned transaction bundle builder with Jito tip transfer
- Bundle submission through the **official jito-ts searcher SDK** (gRPC), with a JSON-RPC fallback transport
- Real-time **bundle-result subscription** (gRPC) plus inflight/final status fallbacks
- **Stream-based commitment confirmation**: processed via the Yellowstone tx stream; confirmed/finalized
  via the Yellowstone slot-status stream, raced against an RPC signature *subscription* (never RPC polling)
- Lifecycle tracking: submitted → processed → confirmed → finalized, with slots, timestamps, latency deltas
- Failure classification: expired blockhash, fee too low, compute exceeded, bundle failure, leader skip/not forwarded, confirmation timeout, stream disconnect
- **LLM-backed AI agent** that owns the operational decision (action + tip) with visible reasoning,
  fed by three deterministic signal providers and bounded by safety guardrails:
  - tip intelligence
  - submission timing
  - autonomous retry / failure reasoning
- Fault injection: expired blockhash (mandated showcase), intentionally low tip, compute exceeded
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

Edit `.env` (RPC + Yellowstone credentials come from **SolInfra**):

```text
SOLANA_RPC_URL=https://YOUR_SOLINFRA_RPC
SOLANA_WS_URL=wss://YOUR_SOLINFRA_WS
YELLOWSTONE_GRPC_URL=https://YOUR_SOLINFRA_YELLOWSTONE_GRPC
YELLOWSTONE_TOKEN=...
JITO_TRANSPORT=grpc
JITO_BLOCK_ENGINE_URL=https://mainnet.block-engine.jito.wtf
JITO_TIP_FLOOR_URL=https://bundles.jito.wtf/api/v1/bundles/tip_floor
KEYPAIR_PATH=./keys/payer.json
AI_DECISION_MODE=llm
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-6
PUBLIC_ARCHITECTURE_URL=https://your-public-doc-url
ALLOW_DRY_RUN=false
```

The AI agent uses Claude when `AI_DECISION_MODE=llm` and a key is present; otherwise it transparently
falls back to the deterministic heuristic engine (`AI_DECISION_MODE=heuristic`). If the jito-ts gRPC
transport is unavailable in your environment, set `JITO_TRANSPORT=jsonrpc`.

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

This stack records `latencyMs.processedToConfirmed` per bundle and summarizes p50/p90 values in
`evidence/run-summary.json` (`p50ProcessedToConfirmedMs`, `p90ProcessedToConfirmedMs`), so this answer
is backed by actual run observations rather than theory.

> **Measured in our run:** p50 `processed→confirmed` = `<paste p50ProcessedToConfirmedMs>` ms,
> p90 = `<paste p90ProcessedToConfirmedMs>` ms. _(Fill these in from `evidence/run-summary.json` after
> the live run — judges score real observations highest.)_

## README Question 2

### Why should you never use finalized commitment when fetching a blockhash for a time-sensitive transaction?

A finalized blockhash is older than the freshest processed or confirmed blockhash because finalization intentionally lags behind the head of the chain. For a time-sensitive Jito bundle, that delay consumes part of the transaction validity window before the bundle is even built or submitted. This increases expiry risk, especially if the stack waits for a Jito leader window or needs a retry. This repo fetches blockhashes at `processed` by default and lets the AI retry agent rebuild with a fresh blockhash when expiry is detected.

## README Question 3

### What happens to your bundle if the Jito leader skips their slot?

If the intended Jito leader skips its slot, the bundle may be accepted by the block engine but fail to land in the expected slot. The bundle can then remain unprocessed, appear as failed/not landed in bundle-result updates, or miss the validity/timing window. This stack detects the absence of commitment progression from the Yellowstone slot-status stream around the intended leader window, classifies it as `leader_skipped_or_bundle_not_forwarded`, records the failure, and hands the live signals to the AI agent. The agent — the LLM when enabled — reasons about the cause and decides whether to hold for the next Jito leader, refresh the blockhash, recalculate the tip, retry, or abort. The retry is not a hardcoded flow; the action comes from the agent's reasoning and is captured in each record's `agentDecision` trace.

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
