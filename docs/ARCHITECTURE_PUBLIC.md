# AgentArena Smart Transaction Stack — Public Architecture Document

> Publish this document as a public Notion, Google Doc, Figma page, or static webpage. Add that URL to `PUBLIC_ARCHITECTURE_URL` before final scoring.

## Executive Summary

AgentArena's smart transaction stack is a production Solana execution layer for autonomous trading and prediction agents. It observes the chain through Yellowstone/Geyser streams, detects Jito leader windows, lets an AI operational agent decide whether to submit, hold, reprice, refresh blockhash, retry, or abort, constructs Jito bundles with dynamic tips, and records judge-verifiable lifecycle evidence from submitted through finalized.

The design intentionally exceeds the minimum challenge requirement: instead of producing only 10 bundle logs and 2 failure cases, the first-place run targets 25 bundle records and 5 controlled failures with visible AI reasoning traces.

## One-Line Architecture

```text
Yellowstone/Geyser → Slot/Tx Streams → Jito Leader Window → AI Tip/Timing/Retry Agent → Dynamic Tip Estimator → Jito Bundle Builder → Jito Block Engine → Stream Lifecycle Tracker → Failure Classifier → Evidence + Autonomous Retry
```

## System Architecture Diagram

```mermaid
flowchart LR
    Y[Yellowstone/Geyser gRPC] --> S[Slot Stream]
    Y --> X[Transaction Stream]
    S --> L[Jito Leader Window Detector]
    J1[Jito getTipAccounts] --> T[Tip Account Feed]
    J2[Jito Tip Floor API] --> T
    T --> E[Dynamic Tip Estimator]
    S --> E
    L --> A[AI Transaction Decision Agent]
    E --> A
    A -->|submit_now| B[Blockhash Manager]
    A -->|hold_for_leader| L
    A -->|retry_refresh_blockhash| B
    A -->|retry_increase_tip| E
    B --> BB[Jito Bundle Builder]
    BB --> JE[Jito Block Engine sendBundle]
    JE --> BS[Bundle Status Monitor]
    X --> LT[Stream Lifecycle Tracker]
    LT --> LS[Lifecycle Store]
    BS --> LS
    LS --> FC[Failure Classifier]
    FC --> A
    LS --> EV[Evidence Exporter]
    EV --> SC[Self-Score Gate]
```

## Data Flow

```mermaid
sequenceDiagram
    participant G as Yellowstone/Geyser
    participant L as Leader Detector
    participant T as Tip Estimator
    participant A as AI Agent
    participant B as Bundle Builder
    participant J as Jito Block Engine
    participant S as Stream Tracker
    participant F as Failure Classifier
    participant E as Evidence Store

    G->>L: current slot, stream timestamp
    L->>A: slots until Jito leader + leader-window flag
    T->>A: live tip percentiles + chosen tip
    A->>A: reason over cost, landing probability, timing, retry state
    A->>B: action + selected tip + blockhash policy
    B->>J: serialized Jito bundle
    J->>E: bundle id, submitted_at, submitted_slot
    G->>S: observed transaction signature in processed stream
    S->>E: processed_at + processed_slot
    S->>E: confirmed/finalized subscription events
    E->>F: timeout/status/error context
    F->>A: classified failure
    A->>B: retry/hold/abort decision
```

## Key Components

### 1. Yellowstone/Geyser Stream Layer

Files:

```text
src/geyser/yellowstone-client.ts
src/geyser/reconnecting-stream.ts
src/geyser/slot-stream.ts
src/geyser/transaction-stream.ts
```

Responsibilities:

- Subscribe to live slots and transactions.
- Maintain current slot from stream data.
- Watch submitted signatures for processed landing.
- Reconnect automatically.
- Emit backpressure warnings.
- Avoid relying on RPC polling alone for landing confirmation.

### 2. Jito Bundle Layer

Files:

```text
src/jito/jito-rpc-client.ts
src/jito/bundle-builder.ts
src/jito/tip-account-feed.ts
src/jito/dynamic-tip-estimator.ts
src/jito/leader-window-detector.ts
```

Responsibilities:

- Discover live Jito tip accounts.
- Fetch live tip-floor data.
- Detect the next scheduled Jito leader.
- Build versioned transactions with a Jito tip transfer.
- Submit bundles via `sendBundle`.
- Monitor inflight/final bundle status.

### 3. AI Operational Agent

Files:

```text
src/agents/tip-intelligence-agent.ts
src/agents/submission-timing-agent.ts
src/agents/retry-reasoning-agent.ts
src/agents/transaction-decision-agent.ts
```

The AI layer owns three real operational decisions:

| Decision family | What it controls |
|---|---|
| Tip intelligence | How much to tip using live tip percentiles and current conditions. |
| Submission timing | Submit now, hold for Jito leader, or abort when conditions are poor. |
| Retry reasoning | Refresh blockhash, increase tip, retry same tip, hold, or abort after failure. |

Each lifecycle record stores the agent's module-level evidence and rationale. This is not a hidden sequential wrapper; the agent's decision changes real execution behavior.

### 4. Failure Handling Strategy

Files:

```text
src/core/failure-classifier.ts
src/core/fault-injection.ts
src/core/orchestrator.ts
```

Failure classes:

```text
expired_blockhash
fee_too_low
compute_exceeded
bundle_failure
leader_skipped_or_bundle_not_forwarded
confirmation_timeout
simulation_failed
stream_disconnected
unknown
```

Behavior:

- Expired blockhash → AI can refresh blockhash and retry.
- Fee too low → AI can reprice using fresh live tip data and retry.
- Compute exceeded → AI aborts because the payload is invalid.
- Leader skip/not forwarded → AI can hold for next favorable leader window.
- Stream disconnect → AI can hold until observability recovers.

### 5. Lifecycle Evidence Layer

Files:

```text
src/core/lifecycle-stream-tracker.ts
src/core/lifecycle-store.ts
src/cli/export-evidence.ts
src/cli/verify-evidence.ts
src/quality/evidence-policy.ts
```

Each record contains:

```text
runId
attemptId
bundleId
signatures
submitted_at / processed_at / confirmed_at / finalized_at
submitted_slot / processed_slot / confirmed_slot / finalized_slot
latency deltas
tip lamports
tip account
leader-window snapshot
AI decision trace
failure classification
explorer links
raw Jito status / live tip percentiles
```

## Infrastructure Decisions

| Decision | Why it matters |
|---|---|
| Yellowstone/Geyser stream | Lower-latency stream observations and challenge-required live infrastructure. |
| Jito bundles | Required by the challenge and appropriate for low-latency atomic submission. |
| Dynamic tip estimator | Avoids hardcoded tips and adapts to live tip floors and network conditions. |
| Separate AI layer | Makes the operational decision-maker auditable and replaceable. |
| Evidence-first design | Judges can cross-check signatures, slots, timestamps, and failure classes. |
| Fault injection | Demonstrates that failure handling works under controlled adverse conditions. |
| First-place score gate | Prevents submitting a technically incomplete or evidence-poor run. |

## First-Place Evidence Target

Minimum requirement:

```text
10 bundle submissions
2 failure cases
```

This implementation targets:

```text
25 bundle lifecycle records
5 controlled failure cases
3 AI decision families
dynamic tips from live data
public architecture URL
no dry-run evidence
p50/p90 latency summaries
explorer-verifiable signatures
```

## Operational Runbook

```bash
npm run challenge:doctor
npm run watch:slots
npm run challenge:first-place
```

If the first-place score is below the configured gate, the submission should not be sent yet. Fix the failed diagnostics, rerun live evidence, and export again.
