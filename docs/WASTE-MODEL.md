# Waste model on-device: train a bottle/can/material recogniser → deploy (guide)

Goal: replace the **beta ImageNet guess** behind the live `/waste` camera with a
real, purpose-trained model you own — and (later) a detector so `/traffic` and
`/street` can find bottles/cans in a scene.

Two models, one dataset family:

- **Classifier** (MobileNetV3 / EfficientNet-Lite) ← *one item → material*. This is
  what the live `/waste` view needs now. Output = our 8 material types.
- **Detector** (EfficientDet-Lite) ← *find + box every bottle/can in a frame*. This
  is the "detect-then-classify" half for `/traffic` / `/street`. Optional, §9.

You **train once** with **MediaPipe Model Maker**, export a `.tflite`, and drop it
in — the app already has the model mirror + loader wired
([`src/lib/imageClassifier.ts`](../src/lib/imageClassifier.ts) /
[`src/lib/trafficDetector.ts`](../src/lib/trafficDetector.ts)).

> **Why bother when there's a live guess already?** The current guess runs a
> pretrained **ImageNet** classifier mapped to our types by keyword
> ([`src/lib/wasteGuess.ts`](../src/lib/wasteGuess.ts)) — rough, and it knows
> nothing about **Cambodian** bottles/cans/brands. A trained model, fine-tuned on
> your `/waste` photos, is the real thing.

---

## 0. The plan in one line

**Bootstrap** on open datasets → **fine-tune** on your collected `/waste` photos
(the Cambodia adaptation) → **export** int8 `.tflite` → **mirror + swap** into the
app. The public data teaches "what a bottle/can looks like"; your data teaches
"…in Cambodia, on a phone, in the real conditions the app runs in."

---

## 1. The datasets (open, license-checked)

| Dataset | Size | Classes | Boxes? | License | Use |
|---|---|---|---|---|---|
| **[Drinking Waste Classification](https://www.kaggle.com/datasets/arkadiyhacks/drinking-waste-classification)** | ~4,800 | PET bottle, glass bottle, **aluminium can**, HDPE | ✅ YOLO bbox | check on Kaggle | closest to bottle/can |
| **[TrashNet](https://github.com/garythung/trashnet)** | 2,527 | glass, paper, cardboard, plastic, metal, trash | ❌ | **MIT** ✅ | classifier baseline |
| **[TACO](https://github.com/pedropro/TACO)** | 1,500 | 60 (bottle, can, cap…) | ✅ COCO | **CC BY 4.0** ✅ | real-world litter → detector |
| **[Open Images V7](https://storage.googleapis.com/openimages/web/index.html)** | huge | "Bottle", "Tin can", "Plastic bag"… | ✅ bbox | CC BY 4.0 ✅ | scale (filter classes) |
| **[Roboflow Universe](https://universe.roboflow.com/)** — "garbage/recycling detection" | many | varies | ✅ export | varies | quick TFLite-ready sets |

Master index of every waste dataset:
**[AgaMiko/waste-datasets-review](https://github.com/AgaMiko/waste-datasets-review)**.

**For the classifier (§5):** TrashNet + Drinking Waste (crop each image to its box so
one item fills the frame — matches how `/waste` is used).
**For the detector (§9):** Drinking Waste + TACO (both already have boxes).

> **License → your model's license.** TrashNet (MIT), TACO / Open Images (CC BY 4.0)
> all allow redistribution **with attribution**. Release the trained model under a
> permissive license and **credit the datasets** in the model card. Verify each
> Kaggle set's terms before shipping.

---

## 2. Map public classes → iAny's 8 material types

The app's classes live in
[`src/assets/wasteLabels.ts`](../src/assets/wasteLabels.ts):

```
plastic_bottle · plastic_other · can · glass · paper · organic · ewaste · other
```

Translate each source dataset's labels into these (drop what doesn't map):

```python
# public label (lowercased)  ->  iAny type
LABEL_MAP = {
    # Drinking Waste
    "pet": "plastic_bottle", "plastic bottle": "plastic_bottle", "hdpe": "plastic_other",
    "aluminiumcan": "can", "aluminium can": "can", "can": "can",
    "glass": "glass", "glassbottle": "glass",
    # TrashNet
    "plastic": "plastic_other", "metal": "can", "paper": "paper", "cardboard": "paper",
    "trash": "other",
    # TACO (examples — TACO has 60 fine classes; group them)
    "bottle": "plastic_bottle", "bottle cap": "plastic_other", "drink can": "can",
    "carton": "paper", "cup": "paper", "food waste": "organic",
    "battery": "ewaste", "electronic": "ewaste",
}
```

Keep the mapping in a small `prep_labels.py` so it's reproducible. The **exported
model's label file must be these 8 ids in a fixed order** — that's what the app maps
back to emoji/Khmer names.

---

## 3. Environment (Colab free tier is enough)

MediaPipe Model Maker trains a MobileNetV3 classifier in minutes on a free Colab T4
(the classifier is tiny). RunPod works too if you prefer (see the STT guide's §1).

```bash
python -m venv venv && source venv/bin/activate     # Python 3.10 or 3.11
pip install --upgrade pip
pip install "mediapipe-model-maker"                   # pulls TF + the maker
pip install kaggle                                    # for dataset download
```

Kaggle download (put your `kaggle.json` token in `~/.kaggle/`):

```bash
kaggle datasets download -d arkadiyhacks/drinking-waste-classification -p data/ --unzip
git clone https://github.com/garythung/trashnet data/trashnet   # images in data/trashnet/data
```

---

## 4. Prep the data (folder-per-class for the classifier)

Model Maker's image classifier wants **one folder per label**:

```
waste_ds/
  plastic_bottle/ *.jpg
  can/            *.jpg
  glass/          *.jpg
  paper/          *.jpg
  plastic_other/  *.jpg
  organic/        *.jpg
  ewaste/         *.jpg
  other/          *.jpg
```

Write a `prep.py` that, for each source image, looks up `LABEL_MAP`, **crops to the
bounding box** if the dataset has one (so a single item fills the frame), and copies
it into `waste_ds/<iany_type>/`. Aim for **balanced** folders — cap the biggest
class so "plastic_bottle" doesn't swamp "ewaste". A few hundred–1,000 images per
class is plenty for a first model.

---

## 5. Train the classifier (MobileNetV3 → `.tflite`)

```python
from mediapipe_model_maker import image_classifier

data = image_classifier.Dataset.from_folder("waste_ds")
train, rest = data.split(0.8)
val, test = rest.split(0.5)

spec = image_classifier.SupportedModels.MOBILENET_V2  # or EFFICIENTNET_LITE0
hp = image_classifier.HParams(epochs=20, batch_size=32, learning_rate=0.004,
                              export_dir="exported")
options = image_classifier.ImageClassifierOptions(supported_model=spec, hparams=hp)

model = image_classifier.ImageClassifier.create(train, val, options)
loss, acc = model.evaluate(test)
print("test accuracy:", acc)

# Exports exported/model.tflite (int8-quantized) + the label file baked into metadata
model.export_model()
```

- `MOBILENET_V2` is the smallest/fastest; `EFFICIENTNET_LITE0` is a touch more
  accurate. Both export a **CPU-int8** `.tflite` — which is exactly what the app's
  classifier loader wants (it defaults to the **CPU delegate**; see the delegate note
  in [`imageClassifier.ts`](../src/lib/imageClassifier.ts)).
- The label names come from the folder names, so they'll be our 8 ids in
  alphabetical order — note that order for §8.

---

## 6. Evaluate honestly

Look at the **per-class** confusion matrix, not just top-1 accuracy. Expect
plastic_bottle ↔ glass confusion (visually similar) and organic/other noise. If a
class is weak, add images (that's a `/waste` collection target). Keep a held-out
**Cambodian** test set (a handful of your own photos) — bootstrap accuracy on Western
data means little until it survives local items.

---

## 7. Fine-tune on your `/waste` photos (the Cambodia step)

Your collected photos are the point. They live in R2 (`waste/<type>/…`) with labels
in D1 (`waste_samples`). Export them into the same folder-per-class layout:

1. **Publish** the `/waste` data as an HF dataset the same way `/voice` is
   (a "Publish dataset" Action / script) — or pull straight from R2 with an
   authenticated lister.
2. Drop each labelled photo into `waste_ds/<type>/` alongside the public data, but
   **oversample** the local photos (duplicate 3–5×) so the model weights real-world
   Cambodian items above the clean studio shots.
3. Re-run §5. Re-run whenever enough new photos accumulate — the model improves every
   collection round. This is the same flywheel as the STT `/voice` fold-in.

---

## 8. Deploy into iAny (swap out the beta guess)

Say you export and upload to **`sengtha/iany-waste-v1`** on Hugging Face
(`model.tflite` at the repo root). Three small changes:

**a) Allowlist the model** in [`worker/index.ts`](../worker/index.ts) — add the
prefix to `ALLOWED_PREFIXES`:

```ts
'sengtha/iany-waste-v1/', // iAny waste classifier (real model, replaces the ImageNet beta)
```

It then resolves through the default HF path automatically
(`/models/sengtha/iany-waste-v1/resolve/main/model.tflite` →
`https://huggingface.co/sengtha/iany-waste-v1/resolve/main/model.tflite`) and is
cached in R2 + the service worker like every other model.

**b) Point the live view at it** in
[`src/views/ContributeWasteView.tsx`](../src/views/ContributeWasteView.tsx) — change
`liveClassifier()`'s `modelUrl` to the new path (keep the default **CPU** delegate,
which matches the int8 export).

**c) Replace the ImageNet keyword map with a direct label map.** The new model
already outputs our 8 ids, so [`src/lib/wasteGuess.ts`](../src/lib/wasteGuess.ts)
collapses to a passthrough:

```ts
// The model's categoryName IS our type id — no keyword mapping needed.
export function guessWasteType(results: Classification[], minConf = 0.35): WasteGuess | null {
  const top = results[0]
  return top && top.score >= minConf ? { typeId: top.label, conf: top.score } : null
}
```

Bump `minConf` (a real model is calibrated; the ImageNet hack needed a low floor).
Everything else — the overlay, capture, confirm-and-contribute flow — is unchanged.
Delete the `.tflite` SW cache entry's stale name if you renamed the file.

That's it: point the phone at a bottle → **real** on-device material label →
tap to confirm + contribute. Same for `/street` once its model exists.

---

## 9. Detector variant (optional — for scenes)

To find bottles/cans **in a frame** (multiple items, or feeding `/traffic`):

```python
from mediapipe_model_maker import object_detector

data = object_detector.Dataset.from_coco_folder("taco_coco", cache_dir="/tmp/od")
train, val = data.split(0.85)
spec = object_detector.SupportedModels.MOBILENET_MULTI_AVG   # or EFFICIENTDET_LITE0
hp = object_detector.HParams(epochs=30, batch_size=16, export_dir="exported_det")
model = object_detector.ObjectDetector.create(
    train, val, object_detector.ObjectDetectorOptions(supported_model=spec, hparams=hp))
model.export_model()   # exported_det/model.tflite
```

- Convert Drinking Waste (YOLO) / TACO (COCO) into Model Maker's COCO folder format.
- **Export float32** for the detector — the app's detector loader uses the **GPU
  delegate**, which needs a float model (int8 + GPU silently detects nothing; that
  was the `/traffic` bug — see the note in [`trafficDetector.ts`](../src/lib/trafficDetector.ts)).
- Wire it exactly like the traffic detector: mirror the model, then either add a
  `/waste`-scene view or run it as the **detect** stage before the §5 classifier
  (**detect-then-classify**) so `/street` gets tuk-tuk-style accuracy for waste too.

---

## Honest limits

- A first model from clean studio data (TrashNet/Drinking Waste) will be **confident
  and wrong** on messy real litter until fine-tuned (§7) — ship it labelled *beta*
  in the UI, same as now, until the Cambodian accuracy is there.
- 8 coarse material types is deliberately simple. Resale-value nuance (PET vs HDPE,
  clear vs coloured glass) is a later, finer model.
- On-device = private + offline, but small models are approximate. `/waste` is R&D
  and recycling **education**; it is not a certified sorting system.

---

Part of [iAny](https://iany.app) · Apache-2.0 code · trained model released openly
with dataset attribution · see also [docs/ENVIRONMENT-AI.md](./ENVIRONMENT-AI.md)
and [docs/VISION-MOBILENET.md](./VISION-MOBILENET.md).
