# Solana Smart Transaction Stack (AgentArena)

> An AI-driven smart transaction stack for Solana — **Yellowstone/Geyser streaming → Jito leader window → AI tip/timing/retry decision → Jito bundle (jito-ts) → stream-confirmed lifecycle evidence → failure-classified autonomous retry.**

Built for the **SuperteamNG × SolInfra Advanced Infrastructure Challenge**. This is deliberately **not** a happy-path demo: it ships controlled fault injection, an LLM agent that genuinely *owns* an operational decision with visible reasoning, live tip repricing from real tip-floor data, stream-based landing confirmation, judge-verifiable evidence export, and a first-place scoring gate.

📄 **Public architecture document:** https://volcano-fowl-b96.notion.site/ARCHITECTURE_PUBLIC-378975109cda80988c39fe0a74103053

![Node](https://img.shields.io/badge/node-%E2%89%A520.11-3c873a)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)
![Solana](https://img.shields.io/badge/Solana-mainnet--beta-9945FF)
![Jito](https://img.shields.io/badge/Jito-jito--ts%20SDK-000000)
![License](https://img.shields.io/badge/license-MIT-blue)

---

## Table of contents

- [Bounty requirement compliance](#bounty-requirement-compliance)
- [Architecture](#architecture)
- [How the AI agent owns the decision](#how-the-ai-agent-owns-the-decision)
- [Real live events (pump.fun via Yellowstone gRPC)](#real-live-events-pumpfun-via-yellowstone-grpc)
- [Stream-based commitment confirmation](#stream-based-commitment-confirmation)
- [Failure handling & fault injection](#failure-handling--fault-injection)
- [Lifecycle record schema](#lifecycle-record-schema)
- [Setup](#setup)
- [Running it](#running-it)
- [Evidence & verification](#evidence--verification)
- [Visual dashboard](#visual-dashboard)
- [README questions (required answers)](#readme-questions-required-answers)
- [Project structure](#project-structure)
- [Design decisions & depth of integration](#design-decisions--depth-of-integration)
- [Submission package](#submission-package)
- [License](#license)

---

## Bounty requirement compliance

| Requirement | Where it lives |
|---|---|
| Public architecture document | [`docs/ARCHITECTURE_PUBLIC.md`](docs/ARCHITECTURE_PUBLIC.md) (+ hosted URL) and [`docs/diagrams/`](docs/diagrams/) |
| Monitor live slot & leader data (Yellowstone) | [`src/geyser/slot-stream.ts`](src/geyser/slot-stream.ts), [`src/jito/leader-window-detector.ts`](src/jito/leader-window-detector.ts) |
| Detect the correct Jito leader window | [`src/jito/leader-window-detector.ts`](src/jito/leader-window-detector.ts) (`getNextScheduledLeader`) |
| Construct & submit Jito bundles | [`src/jito/bundle-builder.ts`](src/jito/bundle-builder.ts), [`src/jito/jito-grpc-client.ts`](src/jito/jito-grpc-client.ts) (jito-ts) |
| Dynamic tips from live data, **no hardcoding** | [`src/jito/tip-account-feed.ts`](src/jito/tip-account-feed.ts), [`src/jito/dynamic-tip-estimator.ts`](src/jito/dynamic-tip-estimator.ts) |
| Lifecycle: submitted → processed → confirmed → finalized | [`src/core/lifecycle-stream-tracker.ts`](src/core/lifecycle-stream-tracker.ts) |
| Timestamps, slot numbers, latency deltas | [`src/core/lifecycle-store.ts`](src/core/lifecycle-store.ts), [`src/types.ts`](src/types.ts) |
| Classify failures (expiry / fee / compute / bundle) | [`src/core/failure-classifier.ts`](src/core/failure-classifier.ts) |
| Confirm landing via **stream subscriptions** (not RPC polling) | [`src/core/commitment-tracker.ts`](src/core/commitment-tracker.ts) |
| Automatic retries incl. blockhash refresh | [`src/core/orchestrator.ts`](src/core/orchestrator.ts), [`src/agents/transaction-decision-agent.ts`](src/agents/transaction-decision-agent.ts) |
| AI agent owns one real operational decision | [`src/agents/`](src/agents/) (LLM-owned action + tip + reasoning) |
| Mandatory blockhash-expiry fault → autonomous recovery | [`src/core/fault-injection.ts`](src/core/fault-injection.ts), [`src/core/orchestrator.ts`](src/core/orchestrator.ts) |
| README answers (3) | [below](#readme-questions-required-answers) |
| Reconnection & backpressure | [`src/geyser/reconnecting-stream.ts`](src/geyser/reconnecting-stream.ts) |
| Clean separation: AI layer vs core stack | [`src/agents/`](src/agents/) vs [`src/core/`](src/core/) |
| Open-source, setup instructions, mainnet prototype | this README + MIT `LICENSE` |

## Architecture

```text
                 SolInfra RPC + Yellowstone gRPC (sponsor infra)
                                  │
        ┌─────────────────────────┴──────────────────────────┐
        │                                                     │
  Slot stream (status:                              Transaction stream
  processed/confirmed/finalized)                    (watch our signatures)
        │                                                     │
        ▼                                                     │
  Leader-window detector ──► NetworkSnapshot                  │
        │                         │                           │
  Tip-account feed + tip-floor ──►│                           │
        │                         ▼                           │
  Dynamic tip estimator ──► AI DECISION AGENT (LLM)           │
                                  │  action + tip + reasoning  │
                                  ▼                           │
                           Bundle builder (versioned tx + Jito tip)
                                  │                           │
                                  ▼                           │
                    jito-ts searcher SDK ── sendBundle ──► Jito block engine
                                  │                           │
                    bundle-result subscription                │
                                  │                           ▼
                                  └──────► Lifecycle tracker ◄─┘
                                           (processed→confirmed→finalized,
                                            slots, timestamps, latency)
                                                  │
                              failure?  ──► Failure classifier ──► AI retry decision
                                                  │                     │ (refresh blockhash,
                                                  ▼                     │  reprice tip, hold, abort)
                                          Evidence export ◄─────────────┘
                                   (JSONL / JSON / Markdown / run-summary / scorecard)
```

See [`docs/diagrams/system-flow.mmd`](docs/diagrams/system-flow.mmd) and [`docs/diagrams/failure-retry-sequence.mmd`](docs/diagrams/failure-retry-sequence.mmd) for Mermaid diagrams.

## How the AI agent owns the decision

The bounty is explicit: *"Retry decisions must come from the agent itself, not hardcoded logic. A simple wrapper that calls functions sequentially without reasoning will not qualify."* This stack is built to that bar.

- When `AI_DECISION_MODE=llm`, an **Anthropic Claude** model is the decision engine ([`src/agents/llm/anthropic-provider.ts`](src/agents/llm/anthropic-provider.ts)). It receives a structured snapshot of **live signals** (leader-window distance, tip percentiles, prior failure class, stream lag, retry attempt) and returns — via a forced structured tool call — the `action`, the `tipLamports`, a `landingProbability`, and **natural-language `reasoning` stored verbatim in every record**.
- The three former "agents" are now **deterministic signal providers** that feed the model evidence — they no longer make the final call: [`tip-intelligence-agent.ts`](src/agents/tip-intelligence-agent.ts), [`submission-timing-agent.ts`](src/agents/submission-timing-agent.ts), [`retry-reasoning-agent.ts`](src/agents/retry-reasoning-agent.ts).
- **Deterministic guardrails** then bound the model for safety: the tip is clamped to the configured range, the retry budget is enforced, and the action is kept coherent with attempt state. Every record flags `guardrailAdjusted` when the model's raw output was bounded.
- Each record stores `engine` (`llm`/`heuristic`), `model`, `promptHash` (sha256 of the exact prompt), `llmLatencyMs`, and the full `reasoning` — so reasoning is **auditable**, not hidden.
- No key? The agent **degrades gracefully** to a transparent heuristic engine so a run is never blocked. The LLM is the only non-sponsor dependency, and since the bounty names no AI vendor, it rivals no sponsor.

## Real live events (pump.fun via Yellowstone gRPC)

Beyond a self-driven loop, the stack can **react to real on-chain activity**. A read-only listener
([`src/geyser/pumpfun-event-stream.ts`](src/geyser/pumpfun-event-stream.ts)) subscribes to the
Yellowstone transaction stream filtered to the **pump.fun program**, reads each transaction's
`Program data:` logs, matches the trade-event discriminator, and **decodes live pump.fun trades**
(mint, SOL/token amounts, buy/sell) — the exact Yellowstone gRPC decode skill from the SolInfra
training, in TypeScript.

When `REACT_TO_LIVE_EVENTS=true`, each bundle attempt is **triggered by a real decoded trade**, the
bundle memo references that real `mint`, and the event is stored on the record
(`raw.pumpfunTriggerEvent`). The payload stays a safe memo+tip transfer — **the stack never trades or
sends a pump.fun transaction**, so there's no trading risk. Watch it live, standalone:

```bash
npm run watch:pumpfun   # streams + decodes real pump.fun trades; sends nothing
```

## Stream-based commitment confirmation

The bounty requires confirming landing via subscriptions — *"RPC polling alone is not sufficient."*

- **Processed** is observed on the Yellowstone **transaction stream** ([`src/geyser/transaction-stream.ts`](src/geyser/transaction-stream.ts)).
- **Confirmed / finalized** are derived from the Yellowstone **slot-status stream** ([`src/core/commitment-tracker.ts`](src/core/commitment-tracker.ts)): a tx in processed slot `S` is confirmed once the cluster confirms a slot ≥ `S`, and finalized once a slot ≥ `S` is rooted — both monotonic along the canonical fork.
- An RPC signature *subscription* (`onSignature`, **not** polling) races the stream as a fallback; whichever resolves first wins, and the source is recorded in `commitmentSource`.

## Failure handling & fault injection

Three controlled faults prove the stack handles adverse conditions, not just the happy path:

| Fault | What happens | Classified as |
|---|---|---|
| **Expired blockhash** (mandated) | Bundle built with a stale blockhash; never lands | `expired_blockhash` → agent refreshes blockhash, reprices tip, resubmits |
| **Low tip** | Tip set to ~1% of the dynamic estimate; loses the Jito auction | `fee_too_low` |
| **Compute exceeded** | Compute-unit limit set to 1; lands in a block but fails execution | `compute_exceeded` (detected from the observed tx error even though it was "processed") |

The classifier also handles `bundle_failure`, `leader_skipped_or_bundle_not_forwarded`, `confirmation_timeout`, `simulation_failed`, and `stream_disconnected` ([`src/core/failure-classifier.ts`](src/core/failure-classifier.ts)).

## Lifecycle record schema

Every attempt produces one record in `evidence/lifecycle-log.json` (judges cross-check these slots on a Solana explorer):

```jsonc
{
  "runId": "…", "attemptId": "…", "retryOf": "…",        // lineage (retries link to parents)
  "intent": "normal | fault_expired_blockhash | …",
  "bundleId": "…", "signatures": ["…"],
  "submittedAt": "…", "processedAt": "…", "confirmedAt": "…", "finalizedAt": "…",
  "submittedSlot": 0, "processedSlot": 0, "confirmedSlot": 0, "finalizedSlot": 0,
  "commitmentSource": { "processed": "yellowstone_tx_stream",
                        "confirmed": "yellowstone_slot_stream", "finalized": "…" },
  "latencyMs": { "submittedToProcessed": 0, "processedToConfirmed": 0,
                 "confirmedToFinalized": 0, "submittedToFinalized": 0 },
  "tipLamports": 0, "tipAccount": "…",
  "agentDecision": { "engine": "llm", "model": "claude-…", "action": "…",
                     "selectedTipLamports": 0, "landingProbabilityEstimate": 0.0,
                     "reasoning": "…", "promptHash": "…", "modules": [ … ] },
  "failureClass": "…", "failureMessage": "…",
  "explorerLinks": ["https://explorer.solana.com/tx/…"]
}
```

## Setup

**Requirements:** Node.js ≥ 20.11, Solana CLI, a funded mainnet keypair, **SolInfra** RPC/WS + Yellowstone gRPC, a Jito block-engine endpoint, and (optional) an Anthropic API key.

```bash
git clone https://github.com/mayor01234/solana-smart-transaction-stack.git
cd solana-smart-transaction-stack
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

> `AI_DECISION_MODE=heuristic` runs fully self-contained (no external API). If the jito-ts gRPC transport is unavailable in your environment, set `JITO_TRANSPORT=jsonrpc` — execution logic is identical.

Create/fund a keypair:

```bash
mkdir -p keys
solana-keygen new --outfile keys/payer.json
solana balance --keypair keys/payer.json   # fund with ~0.1–0.2 SOL for tips + fees
```

## Running it

```bash
npm run build            # tsc — must be clean
npm run challenge:doctor # verifies RPC, Yellowstone, Jito, tip-floor, AI mode
npm run watch:slots      # confirms the live Yellowstone slot stream
npm run watch:pumpfun    # (optional) confirms live pump.fun trade decoding
npm run challenge:first-place   # 25 records + 5 controlled failures, end to end
npm run challenge:dashboard     # (optional) visualize evidence at http://localhost:4317
```

The first-place run is equivalent to:

```bash
npm run challenge:reset-evidence
npm run challenge:run -- --count 25 --failures 5
npm run challenge:export-evidence
npm run challenge:verify-evidence
npm run challenge:score
```

## Evidence & verification

Generated under `evidence/`:

```text
lifecycle-log.jsonl     # one JSON record per line
lifecycle-log.json      # full array (primary submission artifact)
lifecycle-log.md        # human-readable table
run-summary.json        # counts, unique tips, p50/p90 latency deltas
scorecard.json          # first-place gate result
verification-report.md  # pass/fail against the evidence policy
```

**Valid evidence must be live** (`ALLOW_DRY_RUN=false`). Dry-run logs are for local development only — never submit dry-run bundle IDs. The verifier and scorer reject runs with zero records, no classified failures, no AI reasoning traces, or dry-run artifacts.

## Visual dashboard

A read-only local dashboard visualizes the generated evidence (no impact on the core stack):

```bash
npm run challenge:dashboard   # then open http://localhost:4317
```

It renders summary cards (records, failures, finalized, unique tips, p50/p90), a tip-per-attempt
chart, a processed→confirmed latency chart, and a records table where each row expands to show the
AI reasoning and the real pump.fun event the bundle reacted to. Before a run it renders the example
evidence (clearly flagged) so the layout is always viewable. Implementation:
[`src/cli/dashboard.ts`](src/cli/dashboard.ts) + [`dashboard/index.html`](dashboard/index.html).

## README questions (required answers)

### 1. What does the delta between `processed_at` and `confirmed_at` tell you about network health at submission time?

The `processed → confirmed` delta measures how quickly a transaction moves from first observed execution in a processed slot to a commitment level where the cluster has voted sufficiently on the block. A **small delta** indicates healthy leader execution, fast propagation, low congestion, and normal vote progress. A **large delta** signals congestion, delayed votes, fork uncertainty, leader instability, or poor propagation. This stack records `latencyMs.processedToConfirmed` per bundle and summarizes p50/p90 in `evidence/run-summary.json` (`p50ProcessedToConfirmedMs`, `p90ProcessedToConfirmedMs`).

> **Measured in our run:** p50 `processed→confirmed` = `<paste p50ProcessedToConfirmedMs>` ms, p90 = `<paste p90ProcessedToConfirmedMs>` ms. _(Fill from `evidence/run-summary.json` after the live run — judges score real observations highest.)_

### 2. Why should you never use finalized commitment when fetching a blockhash for a time-sensitive transaction?

A finalized blockhash is older than the freshest processed/confirmed blockhash because finalization intentionally lags the head of the chain. For a time-sensitive Jito bundle, that lag consumes part of the validity window before the bundle is even built or submitted — increasing expiry risk, especially while waiting for a leader window or retrying. This repo fetches blockhashes at `confirmed` ([`src/core/blockhash-manager.ts`](src/core/blockhash-manager.ts), `BLOCKHASH_COMMITMENT`) — fresh enough to maximize the validity window, yet already recognized by the Jito leader's bank (an over-fresh `processed` blockhash can be rejected by a leader that is a slot behind) — and **never** `finalized`. The AI agent rebuilds with a fresh blockhash on expiry.

### 3. What happens to your bundle if the Jito leader skips their slot?

The bundle may be accepted by the block engine but fail to land in the expected slot — remaining unprocessed, showing as failed/not-landed in bundle-result updates, or missing the validity window. This stack detects the absence of commitment progression from the Yellowstone slot-status stream around the intended leader window, classifies it as `leader_skipped_or_bundle_not_forwarded`, and hands the live signals to the AI agent, which reasons about the cause and decides whether to hold for the next Jito leader, refresh the blockhash, reprice the tip, retry, or abort. The retry is **not** a hardcoded flow — the action comes from the agent's reasoning and is captured in each record's `agentDecision` trace.

## Project structure

```text
src/geyser/   Yellowstone/Geyser clients (slot, transaction, pump.fun event decode, reconnect)
src/jito/     jito-ts client + JSON-RPC fallback, rate limiter, bundle builder, tip estimator, leader detector
src/agents/   AI operational decision agent + LLM provider + deterministic signal providers
src/core/     Orchestrator, lifecycle tracker, commitment tracker, failure classifier, faults
src/quality/  First-place evidence scoring policy
src/cli/      Challenge runner, doctor, watch:slots, watch:pumpfun, dashboard, exporter/verifier/score
dashboard/    Read-only web dashboard (index.html) for visualizing evidence
docs/         Architecture doc, Mermaid diagrams, requirement mapping, scorecard, checklist
evidence/     Generated lifecycle logs and submission evidence
```

## Design decisions & depth of integration

- **Official jito-ts searcher SDK (gRPC)** for the deepest Jito integration — native bundle submission, scheduled-leader lookup, and real-time `onBundleResult`. A JSON-RPC transport sits behind the same `JitoBundleClient` interface as a resilient fallback ([`src/jito/jito-bundle-client.ts`](src/jito/jito-bundle-client.ts)).
- **Stream-first commitment** (Yellowstone slot-status) rather than RPC polling, matching the requirement and the architecture doc.
- **LLM owns the decision, guardrails own safety** — meaningful AI with visible reasoning, never an unbounded model spending real funds.
- **Provider-agnostic interfaces** (`JitoBundleClient`, `LlmProvider`) so transports and models are swappable without touching execution logic.
- **Evidence-first**: every claim in this README is backed by a generated artifact a judge can open and cross-check on an explorer.

## Submission package

- GitHub repo URL (this repo)
- **Public architecture document:** https://volcano-fowl-b96.notion.site/ARCHITECTURE_PUBLIC-378975109cda80988c39fe0a74103053 (source: [`docs/ARCHITECTURE_PUBLIC.md`](docs/ARCHITECTURE_PUBLIC.md))
- `evidence/lifecycle-log.json`, `lifecycle-log.md`, `run-summary.json`, `verification-report.md`
- Explorer links / signatures / slot numbers from the evidence files
- Optional: a short demo video of the live run, doctor, evidence export, and scoring

## License

MIT — see [`LICENSE`](LICENSE).
