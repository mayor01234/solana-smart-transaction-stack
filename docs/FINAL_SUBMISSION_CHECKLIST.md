# Final Submission Checklist

Do not submit until every item below is complete.

## Required evidence

- [ ] `ALLOW_DRY_RUN=false`
- [ ] SolInfra `SOLANA_RPC_URL`, `SOLANA_WS_URL`, and `YELLOWSTONE_GRPC_URL` are set
- [ ] `ANTHROPIC_API_KEY` is set and `AI_DECISION_MODE=llm` (so records show `engine: llm` reasoning)
- [ ] `JITO_TRANSPORT=grpc` (official jito-ts SDK) — or `jsonrpc` if gRPC is unavailable in your env
- [ ] `PUBLIC_ARCHITECTURE_URL` is set to a public Notion/Google Doc/Figma/static page
- [ ] `npm run build` succeeds (clean `tsc`)
- [ ] `npm run challenge:doctor` passes without failed checks
- [ ] `npm run watch:slots` shows live Yellowstone slot updates
- [ ] `npm run challenge:first-place` completes
- [ ] `evidence/lifecycle-log.json` contains at least 25 records
- [ ] At least 5 records include failure classifications
- [ ] At least 8 successful records reached finalized commitment
- [ ] Tips vary across records and are backed by live percentile data
- [ ] Every record has AI module traces: tip, timing, retry
- [ ] Every signature has an explorer link
- [ ] `evidence/verification-report.md` score is at least 94/100

## What to upload / link

- GitHub repo URL
- Public architecture URL
- `evidence/lifecycle-log.json`
- `evidence/lifecycle-log.md`
- `evidence/run-summary.json`
- `evidence/verification-report.md`
- Optional but recommended: 2–3 minute demo video showing live stream, bundle run, evidence export, and scoring

## Judge-facing explanation

Use this one-liner:

```text
AgentArena is a Yellowstone/Geyser + Jito smart transaction stack where an AI agent owns live operational decisions for tip sizing, submission timing, and autonomous retry, with every bundle lifecycle exported for judge verification.
```
