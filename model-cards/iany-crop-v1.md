---
license: cc-by-4.0
language:
- en
- km
library_name: onnx
pipeline_tag: image-classification
tags:
- image-classification
- agriculture
- plant-disease
- crop-health
- mobilenetv2
- onnx
- on-device
- cambodia
- iany
---

# iany-crop-v1

An **on-device crop-health classifier** — point a camera at a leaf and get its crop + condition (healthy / disease). A MobileNetV2 trained from open leaf datasets + community photos, exported to **ONNX** to run in the browser via `onnxruntime-web`. Built for **[iAny](https://iany.app)**, the offline, on-device Khmer AI platform.

> ⚠️ **Status: Experiment.** Try it at **[iany.app/crop-scan](https://iany.app/crop-scan)** — fully on-device, nothing uploaded. Help improve it by contributing photos at [iany.app/crop](https://iany.app/crop).

## What it does

Classifies a single crop **leaf** into a `<crop>_<condition>` class, for early, offline triage — "healthy vs a problem" — with advice that can be read aloud in Khmer. It is a *suggestion*, **not an agronomist or a lab.**

## Labels (output order — this order matters)

Starter classes (alphabetical — the softmax output order). `labels.txt` in this repo is authoritative and grows as more crops/conditions are trained.

```
0 background        (not a leaf)
1 cassava_disease
2 cassava_healthy
3 maize_disease
4 maize_healthy
5 mango_disease
6 mango_healthy
7 rice_disease
8 rice_healthy
```

## Input / preprocessing (important)

- **Input:** `float32`, shape **`[1, 224, 224, 3]`** (NHWC).
- **Normalization:** MobileNetV2 — scale pixels `[0,255] → [-1,1]` (i.e. `x/127.5 - 1`).
- Center-crop the frame to a square before resizing to 224×224. **Identical input contract to `iany-waste-v1`**, so the same runtime serves both.

## Usage

**Python (onnxruntime)**
```python
import onnxruntime as ort, numpy as np
from PIL import Image

labels = open("labels.txt").read().split()
img = Image.open("leaf.jpg").convert("RGB").resize((224, 224))
x = (np.asarray(img, np.float32) / 127.5 - 1.0)[None]      # [1,224,224,3], [-1,1]
sess = ort.InferenceSession("model.onnx")
probs = sess.run(None, {sess.get_inputs()[0].name: x})[0][0]
print(labels[int(probs.argmax())], float(probs.max()))
```

**Browser (onnxruntime-web)** — see [`src/lib/wasteOnnx.ts`](https://github.com/sengtha/iAny/blob/main/src/lib/wasteOnnx.ts) (generic `[-1,1]` MobileNetV2 classifier) and [`src/views/CropScanView.tsx`](https://github.com/sengtha/iAny/blob/main/src/views/CropScanView.tsx) for the live-camera implementation.

## Training data

Bootstrapped from open leaf datasets, then fine-tuned on **[iany.app/crop](https://iany.app/crop)** contributions (real Cambodian crops on real phones):

- **PlantVillage** (maize/corn overlap)
- **MangoLeafBD** (CC BY 4.0)
- **Cassava Leaf Disease** (Kaggle) — real field images
- open **rice** leaf-disease sets + **iBean** (beans)

Base: **MobileNetV2** (ImageNet weights), transfer learning. Full recipe: [docs/CROP-MODEL.md](https://github.com/sengtha/iAny/blob/main/docs/CROP-MODEL.md).

## Limitations

- **v1 / experiment.** Bootstrapped largely on non-Cambodian, sometimes lab-background data — accuracy on real Cambodian fields is rougher until `/crop` photos are folded in and the model is retrained.
- **Coarse conditions** (healthy / disease) by design — naming the exact disease needs many per-disease examples (a later, finer model).
- Best on **one leaf filling the frame**, decent light. A small model has a lower ceiling; collect where it's weak.

## Intended use

Offline crop-health **triage + education**; the `/crop-scan` experiment; pre-filling labels in the `/crop` collector. **Not** a certified diagnostic or a replacement for an agronomist — present results as guidance and encourage a second opinion for serious decisions.

## License & attribution

Released under **CC-BY-4.0** — please credit the source datasets (PlantVillage, MangoLeafBD — CC BY 4.0, Cassava, rice sets, iBean per their terms) and **[iAny](https://iany.app)**. Verify each source dataset's terms before commercial redistribution.

## Credit & recipe

Trained and released by **[iAny](https://iany.app)** (E-KHMER Technology). Full training + deploy recipe: [github.com/sengtha/iAny · docs/CROP-MODEL.md](https://github.com/sengtha/iAny/blob/main/docs/CROP-MODEL.md).
