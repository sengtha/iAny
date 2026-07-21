---
license: cc-by-4.0
language:
- en
- km
library_name: onnx
pipeline_tag: image-classification
tags:
- image-classification
- health
- rapid-diagnostic-test
- lateral-flow
- mobilenetv2
- onnx
- on-device
- cambodia
- iany
---

# iany-health-rdt-v1

> ⏸️ **SHELVED (paused) — not released.** No open dataset was available to train a reliable reader; this card is a template kept for when real data or a partner exists. The `/health-test` collector keeps gathering data. See [docs/HEALTH-TEST-MODEL.md](https://github.com/sengtha/iAny/blob/main/docs/HEALTH-TEST-MODEL.md).

An **on-device rapid-diagnostic-test (RDT) strip reader** — from a photo of a test cassette, it reports **positive / negative / invalid**. A MobileNetV2 exported to **ONNX** for the browser via `onnxruntime-web`. Built for **[iAny](https://iany.app)**, the offline, on-device Khmer AI platform.

> 🛑 **This reads a result line. It does NOT diagnose.** The *test* is the validated medical device; this model only reports what the strip already shows, the way a person would. **Not a medical device. Always confirm with a health worker.** A wrong "negative" can cost a life — the app must show confidence, refuse on low confidence, and keep a human in the loop.
>
> ⚠️ **Status: Experiment.** See [iany.app/health-test](https://iany.app/health-test) to contribute strip photos (strip only — no faces, names, or documents).

## What it does

Classifies an RDT cassette photo's **result** into 3 classes, for offline reading assistance (e.g. low-light, poor eyesight, or logging). Test type (malaria / dengue / pregnancy / covid / other) is **metadata** used to stratify, not an output.

## Labels (output order — this order matters)

```
0 invalid     (no valid control line — retake / see a health worker)
1 negative
2 positive
```
`labels.txt` in this repo is authoritative. Output is a softmax over these 3 classes.

## Input / preprocessing (important)

- **Input:** `float32`, shape **`[1, 224, 224, 3]`** (NHWC).
- **Normalization:** MobileNetV2 — scale pixels `[0,255] → [-1,1]` (`x/127.5 - 1`).
- Center-crop to a square, then 224×224. **Identical input contract to `iany-waste-v1` / `iany-crop-v1`** (one shared runtime).

## Usage

**Python (onnxruntime)**
```python
import onnxruntime as ort, numpy as np
from PIL import Image

labels = ["invalid", "negative", "positive"]
img = Image.open("strip.jpg").convert("RGB").resize((224, 224))
x = (np.asarray(img, np.float32) / 127.5 - 1.0)[None]
sess = ort.InferenceSession("model.onnx")
probs = sess.run(None, {sess.get_inputs()[0].name: x})[0][0]
# Treat low confidence / near-ties as "invalid → retake or seek care", not a guess.
print(labels[int(probs.argmax())], float(probs.max()))
```

**Browser (onnxruntime-web)** — reuses [`src/lib/wasteOnnx.ts`](https://github.com/sengtha/iAny/blob/main/src/lib/wasteOnnx.ts) (generic `[-1,1]` MobileNetV2 classifier).

## Training data

- **v1 bootstrap: synthetic strips** (generated cassettes with control/test lines at varied intensity, lighting, blur — see [docs/HEALTH-TEST-MODEL.md](https://github.com/sengtha/iAny/blob/main/docs/HEALTH-TEST-MODEL.md) §2). Synthetic data proves the pipeline; it does **not** make the model clinically reliable.
- **Real lateral-flow photos:** the MIT-licensed [COVID-19 LFT image set](https://www.kaggle.com/datasets/mahdimaktabdar/covid19-lateral-flow-test-images) (~325, positive/negative) — a cassette reads the same way across kits, so it transfers the *reading skill*.
- **Then:** real photos from **[iany.app/health-test](https://iany.app/health-test)** (strip + result), folded in as they accumulate, replacing synthetic. Malaria/dengue strip corpora remain research-held (FIND, Audere) — partner for validated volume.
- Large real-world RDT image corpora exist but are **research-held** (e.g. FIND, Audere/HealthPulse) — partnering is the route to validated volume.

Base: **MobileNetV2** (ImageNet weights), transfer learning.

## Limitations

- **v1 is a plumbing demo** trained on synthetic (or thin) data — treat outputs as unreliable until independently evaluated on real strips.
- **Kit diversity is the killer:** brand, shape, and colour differ; a model tuned on one kit won't transfer. Stratify and collect across kits; consider per-test-type models.
- The cost of a wrong **positive→negative** is asymmetric and high. Bias toward "unclear → get a real test."

## Intended use

Offline **reading assistance** for a result a person could also read; the `/health-test` experiment; pre-filling labels in the collector. **Not a diagnostic, not a medical device, not a substitute for clinical testing or care.** Requires independent clinical validation (and likely regulatory review) before any non-R&D use.

## License & attribution

Released under **CC-BY-4.0**, crediting **[iAny](https://iany.app)** and any partner/source data per its terms. The model card and app must always carry the "reading, not diagnosis; confirm with a health worker" notice.

## Credit & recipe

Trained and released by **[iAny](https://iany.app)** (E-KHMER Technology). Full training + deploy recipe: [github.com/sengtha/iAny · docs/HEALTH-TEST-MODEL.md](https://github.com/sengtha/iAny/blob/main/docs/HEALTH-TEST-MODEL.md). Scope + safety: [docs/HEALTH-AI.md](https://github.com/sengtha/iAny/blob/main/docs/HEALTH-AI.md).
