# Self-Audit After Implementation

## What was improved from v2 to v3

- Increased default evidence target from 10/2 to 25/5.
- Added first-place evidence verifier.
- Added public architecture URL gate.
- Split AI into three auditable decision families: tip, timing, retry.
- Added module-level AI traces to every lifecycle record.
- Added doctor/preflight checks.
- Added p50/p90 latency summaries.
- Added final submission checklist and demo script.
- Added stricter no-dry-run evidence validation.

## What was hardened to a first-place, sponsor-aligned submission

- **Adopted the official jito-ts SDK** (recommended bounty resource) for bundle submission, tip
  accounts, scheduled-leader lookup, and real-time bundle-result subscriptions — behind a transport
  interface with a JSON-RPC fallback (`JITO_TRANSPORT`). Scores on depth of integration.
- **Made the AI agent genuinely own the decision.** An Anthropic Claude model now produces the
  action, tip, and visible natural-language reasoning through a forced structured tool call. The
  former lookup-table "agents" became deterministic signal providers that feed the model, and
  deterministic guardrails clamp the tip and enforce the retry budget. This removes the
  "hardcoded retry / sequential wrapper" disqualification risk. Degrades to a heuristic engine when
  no key is present.
- **Confirmed/finalized landing now comes from the Yellowstone slot-status stream**
  (`commitment-tracker.ts`), raced with an RPC signature subscription. No RPC polling.
- **Fault injection reliably produces classified failures** — including the compute-exceeded case
  that previously landed-but-failed without being recorded as a failure, and the mandated
  blockhash-expiry showcase.
- **Fixed a config crash** where an empty optional URL (e.g. `PUBLIC_ARCHITECTURE_URL=`) failed
  validation before the doc was published.
- **Verified to typecheck and build** (`tsc` clean) and smoke-tested at runtime: the jito-ts gRPC
  client and Yellowstone client both initialise; only live network calls require real credentials.
- Sponsor discipline: infrastructure is SolInfra (RPC + Yellowstone) and Jito only. The LLM rivals
  no sponsor because the bounty names no AI provider.

## Remaining work that must happen outside this sandbox

The final evidence must be generated on a real machine with:

- funded keypair
- SolInfra or equivalent premium RPC
- Yellowstone/Geyser credentials
- Jito block-engine access

Without live bundle logs, the repo is strong implementation work but not a final winning submission.
