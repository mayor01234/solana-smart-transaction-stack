# Demo Script

A short demo video is not explicitly required, but it can make the submission more convincing.

## 1. Show the architecture

Open `docs/ARCHITECTURE_PUBLIC.md` and show:

- system diagram
- data-flow sequence
- AI decision responsibilities
- failure handling strategy

## 2. Show live infrastructure

```bash
npm run challenge:doctor
npm run watch:slots
```

Point out:

- Yellowstone stream is live
- Jito tip accounts/tip-floor are reachable
- Jito leader schedule is reachable

## 3. Run the first-place evidence generator

```bash
npm run challenge:first-place
```

Explain that the run targets 25 records and 5 controlled failures.

## 4. Show evidence files

Open:

```text
evidence/lifecycle-log.md
evidence/run-summary.json
evidence/verification-report.md
```

Highlight:

- bundle IDs
- signatures
- slots
- tips
- failures
- AI decision traces

## 5. Show self-score

```bash
npm run challenge:score
```

End by showing the first-place gate passed.
