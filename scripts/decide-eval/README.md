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
training distribution — see the typed-decisions follow-up below.

## Results: 2026-09-21, Kaggle reproduction + typed-decisions checkpoint

Public, re-runnable notebook: https://www.kaggle.com/code/sengthachay/laya-testing
Full outputs in `results/2026-09-21-kaggle-router-rerun.json` and
`results/2026-09-21-kaggle-typed-decisions.json`.

**Reproduction:** the router run was repeated in a fresh Kaggle session and
came back **bit-identical** to the original — every pick the same, max
probability difference 0.0000 across all 12×n entries. Laya inference is
deterministic, so the 2026-09-21 router numbers are independently
reproduced, not a lucky draw.

**`--model typed-decisions`** (the checkpoint the first pass left untried):
agreement with device 3/12, gate accepts 0/12, and the distributions are
compressed toward uniform everywhere (top-p 0.20–0.52; effort still flat at
0.88–1.01; needs-variety hovers 0.38–0.62 and does NOT fire after the fried
week, 0.38). It picks the correct coin-toss dish — but at p=0.52 against a
0.50 chance floor, with entropy-confidence 0.002. It fabricates less than
the English checkpoint (M5 untagged is honestly near-uniform) but signals
almost nothing: consistent with its fine-tuning on four unrelated workflows
(customer service, invoices, security incidents, agent traces). Verdict
unchanged: **keep Jev**.

## Results: 2026-09-21, Jev via deployed worker (same-origin runner)

Full output in `results/2026-09-21-jev-worker.json`. 12/12 answered, all
fresh model calls, median ~1.0 s end to end through the edge.

### Three-way table

| scenario | device | Jev | Laya (router) |
|---|---|---|---|
| M1 hot lunch | green salad | green salad ✓ | sour soup ✗ |
| M2 cool breakfast | fried fish | **porridge** ≠ | num banh chok ✗ |
| M3 rainy dinner | fried fish | **sour soup** ≠ | fried rice ✗ |
| M4 fried-fatigue | green salad | green salad ✓ | fried rice ✗ |
| M5 untagged | mystery-2wk | mystery-2wk ✓ (gate: self-doubt) | mystery 1 ✗ |
| M6 coin toss (truth: B) | B ✓ | **B at 0.93** ✓ | A ✗ |
| O1 wedding | sampot hol | **sampot hol at 0.78** ✓ | office shirt ✗ |
| O2 hot workday | rain jacket (!) | **sun-cover riding shirt** ≠ | office shirt ✗ |
| O3 rainy casual | rain jacket | rain jacket ✓ | office shirt ✗ |
| E1 tired rainy | stretching | stretching ✓ | stretching ✓ |
| S1 tired evening | vocabulary | vocabulary ✓ | vocabulary ✓ |
| S2 fresh morning | new grammar | new grammar ✓ | vocabulary ✗ |

|  | Jev | Laya |
|---|---|---|
| agrees with device | 9/12 | 2/12 |
| gate would use | 11/12 | 1/12 |
| known-truth probes | 4/4 | 0/4 |
| effort-score spread | 0.02 → 1.12 (responsive) | 0.94 → 0.97 (flat) |
| variety after fried week | 0.83 (yes) | 0.40 (no) |

### The finding that matters

**All three Jev↔device disagreements read as Jev being right:**

- M2: the device picked fried fish for a cool breakfast (the +0.25 rating
  beat the +0.18 porridge-morning weight); Jev picked borbor — the actual
  Cambodian breakfast.
- M3: device again rating-led to fried fish; Jev picked sour soup for a
  rainy dinner.
- O2: the device picked a RAIN JACKET on a hot dry day — rotation pressure
  promoting an absurd item in a small wardrobe. Jev picked the sun-cover
  riding shirt.

And M5 shows the gate working as designed: with untagged items Jev agreed
with the device but was honestly unsure (conf 0.23 vs floor 0.24) and the
answer was correctly not relied on.

So the verdict is not "arithmetic beats models" — it is the hybrid thesis
validated end to end: the device is reliable on hard constraints (recency,
availability, ground truth) and cheap; Jev adds genuine judgement where the
hand weights are subtly wrong; the gate keeps the one shaky answer out. The
two device weaknesses Jev exposed (ratings overpowering meal-slot fit;
rotation promoting weather-absurd items) are recorded as tuning candidates —
to be fixed on their merits, not by copying Jev.
