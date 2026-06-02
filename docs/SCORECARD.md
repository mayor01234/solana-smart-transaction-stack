# Scorecard and Self-Benchmark

## Static implementation score

The codebase is scored on whether the required modules exist and are cleanly separated:

| Area | Target |
|---|---|
| Architecture document | Public-hostable doc with diagrams |
| Yellowstone/Geyser | Slot stream, tx stream, reconnect/backpressure |
| Jito | bundle builder, sendBundle, statuses, tip accounts |
| Dynamic tips | live tip-floor data + network conditions |
| AI | tip, timing, retry decision families |
| Failure handling | expiry, low tip, compute, bundle, leader skip, timeout |
| Evidence | JSONL/JSON/MD/summary/verifier |

## Evidence score

The final score depends on live evidence, not static code.

| Evidence criterion | First-place target |
|---|---:|
| Bundle records | 25+ |
| Failure records | 5+ |
| Finalized successful records | 8+ |
| Dry-run records | 0 |
| Unique tip values | >1 |
| AI reasoning traces | 100% records |
| Explorer links | 100% records |
| AI decision families | tip + timing + retry |
| Public architecture URL | required |

## Expected readiness

| State | Expected readiness |
|---|---:|
| Static repo only | 75–85 / 100 |
| Repo + 10/2 live evidence | 88–92 / 100 |
| Repo + 25/5 evidence + public doc + verification report | 94–97 / 100 |

The repo is designed to fail the first-place gate if evidence is weak. That is intentional.
