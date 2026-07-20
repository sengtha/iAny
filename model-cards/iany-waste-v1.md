---
license: cc-by-4.0
language:
- en
- km
library_name: onnx
pipeline_tag: image-classification
tags:
- image-classification
- waste
- recycling
- waste-classification
- mobilenetv2
- onnx
- on-device
- cambodia
- iany
---

# iany-waste-v1

An **on-device waste-material classifier** — point a camera at an item and get its material. A MobileNetV2 trained from open waste datasets, exported to **ONNX** to run in the browser via `onnxruntime-web`. Built for **[iAny](https://iany.app)**, the offline, on-device Khmer AI platform.

> Live now: try it at **[iany.app/waste-scan](https://iany.app/waste-scan)** — fully on-device, nothing uploaded. Help improve it by contributing photos at [iany.app/waste](https://iany.app/waste).

## What it does

Classifies a single item's **material** into 7 types, for recycling education, correct sorting, and knowing what a waste-buyer will take.

## Labels (output order — this order matters)

```
0 can
1 glass
2 organic
3 other
4 paper
5 plastic_bottle
6 plastic_other
```
`labels.txt` in this repo has the same order. Output is a softmax over these 7 classes.

## Input / preprocessing (important)

- **Input:** `float32`, shape **`[1, 224, 224, 3]`** (NHWC).
- **Normalization:** MobileNetV2 — scale pixels `[0,255] → [-1,1]` (i.e. `x/127.5 - 1`).
- Center-crop the frame to a square before resizing to 224×224 for best results.

## Usage

**Python (onnxruntime)**
```python
import onnxruntime as ort, numpy as np
from PIL import Image

labels = ["can","glass","organic","other","paper","plastic_bottle","plastic_other"]
img = Image.open("item.jpg").convert("RGB").resize((224, 224))
x = (np.asarray(img, np.float32) / 127.5 - 1.0)[None]      # [1,224,224,3], [-1,1]
sess = ort.InferenceSession("model.onnx")
probs = sess.run(None, {sess.get_inputs()[0].name: x})[0][0]
print(labels[int(probs.argmax())], float(probs.max()))
```

**Browser (onnxruntime-web)** — see [`src/lib/wasteOnnx.ts`](https://github.com/sengtha/iAny/blob/main/src/lib/wasteOnnx.ts) in iAny for a live-camera implementation.

## Training data

Bootstrapped from open datasets:
- **[TrashNet](https://github.com/garythung/trashnet)** (MIT)
- **Drinking Waste Classification** (Kaggle) — bottle / can / glass / HDPE
- **techsash/waste-classification-data** (Kaggle) — *Organic* images only

Base: **MobileNetV2** (ImageNet weights). Trained with transfer learning (see the recipe below).

## Limitations

- **v1 / beta.** Trained mostly on **Western** datasets — accuracy on **Cambodian** items, brands, and messy real litter is rougher. This improves as `/waste` photos are folded in and the model is retrained.
- **No `ewaste` class** yet (not enough e-waste training images) — 7 of iAny's 8 material types.
- Best on **one item filling the frame**, decent light. It's a *suggestion*, not an authoritative sorting decision.

## Intended use

Recycling **education** and sorting guidance; the `/waste-scan` experiment; and pre-filling labels in the `/waste` data collector. Not a certified sorting or compliance system.

## License & attribution

Released under **CC-BY-4.0** — please credit the source datasets (TrashNet — MIT; others per their Kaggle terms) and **[iAny](https://iany.app)**. Verify each source dataset's terms before commercial redistribution.

## Credit & recipe

Trained and released by **[iAny](https://iany.app)** (E-KHMER Technology). Full training + deploy recipe: [github.com/sengtha/iAny · docs/WASTE-MODEL.md](https://github.com/sengtha/iAny/blob/main/docs/WASTE-MODEL.md).
