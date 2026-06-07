# Security

This document records the pre-submission security audit of the AgentArena Smart
Transaction Stack and the project's standing security posture.

## Summary

The stack is a **local, single-operator** tool that streams Solana data (SolInfra
Yellowstone/Geyser), builds and submits Jito bundles, and lets a Claude AI agent make
bounded operational decisions. It holds no inbound network surface beyond a
loopback-only dashboard, and the only secrets are the operator's own credentials, kept
in a git-ignored `.env`.

Audit result: **no secrets exposed, no code-injection surface, autonomous-agent spend
is hard-bounded.** One low-severity finding (dashboard bind address) was fixed.

## Secret management

- `.env` and `keys/*.json` are git-ignored and **were never committed** (verified across
  full git history, not just the working tree).
- `.env.example` ships placeholders only.
- No key material is ever logged. The single key-adjacent log line emits
  `authenticated: <boolean>`, never the key itself.
- The Anthropic API key flows from config straight into the official SDK
  (`new Anthropic({ apiKey })`) and nowhere else.
- Committed evidence (`evidence/*.json`) contains only **public on-chain data** —
  transaction signatures, bundle IDs, and the payer's public key. No private key or API
  key appears in any committed artifact.

**Operator note:** the real `.env` holds a live SolInfra key, an Anthropic key, and the
payer keypair. These must never be pasted into a submission form, a demo recording, or a
screenshot. Use a dedicated low-balance payer wallet (the demo wallet holds ~0.18 SOL).

## Autonomous-agent safety (financial blast radius)

The LLM is **not trusted with funds**. Its output is validated and hard-clamped by
deterministic guardrails before anything is signed:

- Tip is clamped to `[TIP_MIN_LAMPORTS, TIP_MAX_LAMPORTS]`
  (`src/agents/transaction-decision-agent.ts`); non-finite/negative model values coerce to 0.
- Retries are capped at `AI_MAX_RETRY_ATTEMPTS`; beyond the cap the action is forced to
  non-retry.

Net effect: even a hallucinating model — or a prompt-injection attempt embedded in a
live pump.fun mint name — cannot drain the wallet or loop indefinitely. The worst case is
`TIP_MAX` (0.002 SOL) plus the priority fee per attempt, across a capped number of attempts.

## Injection surface

- The only `child_process.spawn` (`src/cli/first-place-run.ts`) uses hard-coded command
  and argument literals; no user or network input reaches it. The `shell: true` flag is
  Windows-only (for the `tsx` shim) and carries no injection surface because nothing
  external is interpolated.
- No `eval`, `new Function`, or `execSync` anywhere in the codebase.
- The dashboard HTTP server matches a fixed set of route strings and reads only hard-coded
  evidence filenames; `req.url` never constructs a file path, so there is no path traversal.

## Network exposure

- The dashboard is a read-only local viewer. It now binds explicitly to `127.0.0.1`
  (loopback only). Previously it called `server.listen(PORT)` with no host, which binds to
  all interfaces (`0.0.0.0`) — fixed, as it would otherwise expose the (non-secret)
  evidence to the local network.

## Dependency advisories (`npm audit`)

`npm audit --omit=dev` reports 6 transitive advisories (3 high, 3 moderate):

| Package | Severity | Reachable in this project? |
|---|---|---|
| `bigint-buffer` (all versions) | High | Transitive via `@solana/web3.js`. **No patched version exists.** Worst case is a local-process crash on a malformed buffer, already contained by per-attempt `try/catch` + an `unhandledRejection` guard. |
| `uuid` `<11.1.1` | Moderate | Vulnerable only when `v3/v5/v6` is called with a `buf` argument. This project's direct `uuid` is already `11.1.1`, and it only calls `v4()` with no `buf`. The flagged copy is a transitive dependency of `jayson`/`jito-ts`; the vulnerable path is never invoked. |

**These advisories live inside the official, bounty-recommended Solana/Jito SDKs
(`@solana/web3.js`, `jito-ts`), not in this project's own code.** Every Solana web3.js 1.x
application ships them.

**We deliberately do not run `npm audit fix --force`:** its only proposed resolution is to
downgrade `jito-ts` from `4.2.1` to `2.2.0`, which is a breaking change that would degrade
the sponsor-required Jito SDK integration. Given that the vulnerable code paths are either
unreachable in our usage (`uuid`) or have no upstream fix and a contained local-only impact
(`bigint-buffer`), the residual risk is accepted and tracked here. It will be cleared when
the upstream SDKs publish patched transitive dependencies.

## Reporting

This is a bounty submission project. For any security concern, open a GitHub issue on the
repository.
