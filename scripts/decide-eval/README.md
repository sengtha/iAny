# Decide × Laya evaluation kit

[Laya](https://github.com/NandhaKishorM/laya) (Apache-2.0) answers the same
typed questions as `typesafe/jev` — `choice` / `score` / `noul` — with the
same response shape. Its parser was checked against our wire format directly
(`laya/common.py` even documents our exact noul criteria form), so the
payloads here run on it **unmodified**.

Why this matters: if Laya holds up on our real request shape, the follow-up is
an ONNX export of `laya-multilingual` (322M, single forward pass — same size
class as the embeddinggemma we already mirror), which would make the "online"
scorer fully **on-device**: no worker call, no cache, no gate, no network.

## Files

- `gen-payloads.ts` — builds `payloads.json` from the PRODUCTION engine code
  (`buildRequest`, `rankLocal`, `aliasMap`), so the eval exercises exactly what
  the deployed app sends. 12 scenarios across all four domains, including the
  adversarial ones (untagged items, fried-fatigue, wedding).
- `payloads.json` — the generated set. No Khmer, no user data — synthetic
  items with English legends for reading the report.
- `run_laya.py` — feeds the payloads to Laya and applies the SAME gate the app
  applies to Jev (lift ≥ 1.4, self-trust ≥ 1.2/n), reporting per scenario:
  Laya's pick, probabilities, confidence, lift, gate verdict, latency, and
  agreement with the on-device scorer.

## Run it (Colab or any machine with internet)

```bash
pip install laya
python run_laya.py                      # router picks the checkpoint
python run_laya.py --model english      # force a checkpoint
```

CPU is fine (~200–500 ms per scenario). First run downloads ~1.3 GB of
weights from Hugging Face.

## The Jev column (GA since 2026-09-21 — no waitlist, $5 free credit)

`run_jev.py` sends the SAME payloads and applies the SAME gate (imported from
run_laya.py, so the columns are judged identically). All 12 scenarios cost
well under one US cent.

```bash
# through the deployed worker (production path; --fresh salts the cache key
# so the model answers, not the KV cache):
python run_jev.py

# or straight at TypeSafe's API once you have a key from console.typesafe.ai
# (check their docs for the endpoint path):
python run_jev.py --api typesafe --url https://<endpoint> --auth "Bearer sk-..."
```

Runs fine from the same Kaggle/Colab notebook as the Laya pass — both
scripts, one payload set, three comparable columns.

Before publishing Jev numbers anywhere, read TypeSafe's terms of service:
some model providers restrict publishing benchmarks without consent.

## Reading the result

- **gate would USE n/12** — how often the app would have shown "checked
  online" if Laya were the backend. Compare with your Jev experience.
- **Disagreement rows** are the decision: for each, ask which pick you would
  actually have wanted today. Benchmarks don't answer that; you do.
- `M5-untagged` is the honesty probe: with nothing to go on, a well-calibrated
  model should be near-uniform (gate: flat), not confidently wrong.
- `M6-coin-toss` has a ground truth: option B (A was eaten yesterday).

## Regenerating payloads after engine changes

```bash
npx esbuild scripts/decide-eval/gen-payloads.ts --bundle --platform=node \
  --format=esm --outfile=node_modules/.cache/gen-payloads.mjs
node node_modules/.cache/gen-payloads.mjs > scripts/decide-eval/payloads.json
```

## Results: 2026-09-21, Kaggle CPU, router (→ English checkpoint)

Full output in `results/2026-09-21-kaggle-router.json`. Summary — verdict: **keep Jev**.

| probe | expected | Laya answered |
|---|---|---|
| M6 coin toss (ground truth) | the dish NOT eaten yesterday | the one eaten yesterday (0.58) |
| O1 wedding ("attending a wedding" in the state) | sampot hol | office shirt; sampot p=0.11 |
| M4 fried-heavy week | anything not fried; variety=yes | fried rice; needs_variety 0.40 |
| effort score, 12 varied situations | should vary | 0.94–0.97, effectively constant |

Agreement with the on-device scorer 2/12 (the two easiest cases). Median
latency 4 s/call on x86 CPU (the 33 ms figure is T4 GPU), which also closes
the on-device ONNX path at this quality. Caveats recorded for fairness: the
confidence scalar is not Jev-comparable (so gate verdicts here reflect
semantics as much as quality), and this task is likely outside Laya's
training distribution — `--model typed-decisions` remains untried.
