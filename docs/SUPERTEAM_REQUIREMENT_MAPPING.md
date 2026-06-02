# Superteam Requirement Mapping

| Requirement | Implementation location | Status before live run | First-place enhancement |
|---|---|---:|---|
| Public architecture document hosted separately | `docs/ARCHITECTURE_PUBLIC.md` | Publish required | Public URL is checked by `PUBLIC_ARCHITECTURE_URL` scoring gate |
| Explain architecture, components, data flow, infra decisions, failures, AI duties | `docs/ARCHITECTURE_PUBLIC.md` | Implemented | Includes Mermaid diagrams and runbook |
| Yellowstone/Geyser slot data | `src/geyser/slot-stream.ts` | Implemented | Reconnect/backpressure included |
| Yellowstone/Geyser transaction stream | `src/geyser/transaction-stream.ts` | Implemented | Signature watchlist for landing observations |
| Detect Jito leader window | `src/jito/leader-window-detector.ts` | Implemented | Feeds timing agent |
| Construct Jito bundles | `src/jito/bundle-builder.ts` | Implemented | Versioned tx + dynamic tip transfer |
| Submit Jito bundles | `src/jito/jito-rpc-client.ts`, `src/core/orchestrator.ts` | Implemented | Bundle ID captured in lifecycle evidence |
| Dynamic tips from real data | `src/jito/tip-account-feed.ts`, `src/jito/dynamic-tip-estimator.ts`, `src/agents/tip-intelligence-agent.ts` | Implemented | Evidence stores live percentile data and selected tip |
| No hardcoded submitted tip | Runtime-selected tip from live data | Implemented | Config values are guardrails only |
| Track submitted/processed/confirmed/finalized | `src/core/lifecycle-stream-tracker.ts` | Implemented | Processed via Yellowstone transaction stream; confirmed/finalized via subscriptions |
| Capture timestamps, slots, latency deltas | `src/core/lifecycle-store.ts` | Implemented | p50/p90 summary exported |
| Detect/classify failures | `src/core/failure-classifier.ts` | Implemented | 8 failure classes |
| Confirm landing using subscriptions | `src/core/lifecycle-stream-tracker.ts` | Implemented | Not RPC-poll-only |
| Automatic retries with blockhash refresh | `src/core/orchestrator.ts`, `src/agents/retry-reasoning-agent.ts` | Implemented | Retry action comes from AI decision trace |
| 10 real bundle submissions | `npm run challenge:run -- --count 10 --failures 2` | Requires live run | `npm run challenge:first-place` targets 25 |
| At least 2 failure cases | `src/core/fault-injection.ts` | Requires live run | First-place target is 5 |
| AI owns one operational decision | `src/agents/*` | Implemented | AI owns tip, timing, and retry decisions |
| Fault injection blockhash expiry | `npm run test:fault-expiry` | Implemented | First-place run mixes expiry + low-tip faults |
| README required questions | `README.md` | Implemented | Tied to run-summary metrics |
| Clear setup instructions | `README.md` | Implemented | VS Code workflow included |
| Working prototype on devnet/mainnet | Env-driven | Requires credentials | Mainnet-beta default, can be changed |
| Clean separation of AI/core stack | `src/agents`, `src/core`, `src/jito`, `src/geyser` | Implemented | Module-level decision traces |
| Happy-path not enough | Fault injection + score gate | Implemented | Evidence verifier fails weak runs |
