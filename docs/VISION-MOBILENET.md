# On-device image AI for iAny — MobileNetV3 (crop health first)

Goal: turn photos contributed at **[iany.app/crop](https://iany.app/crop)** into a
**free, offline crop-health classifier** that runs on any phone — so a farmer can
point a camera at a leaf and learn "healthy / disease / pest / deficiency," with
advice read aloud in Khmer, no lab and no internet.

The exact same recipe works for the other verticals (waste sorting, species ID, a
rapid-test reader, …) — only the dataset changes. This doc is the reusable
**collect → train → deploy** pipeline.

> **Why MobileNetV3.** A tiny (~4–10 MB), fast image network that runs on-device.
> You don't train it from scratch — you **fine-tune** (transfer-learn): keep the
> pretrained backbone, retrain the last layer on *your* classes. Works with modest
> data (even ~100–300 images/class to start). It's small, so **your data is the
> quality ceiling, not the model.**

---

## 0. Collect the data (already built)

The **`/crop` collector** ([`src/views/ContributeCropView.tsx`](../src/views/ContributeCropView.tsx))
is live: a contributor photographs a crop, tags it (**crop** + **condition** =
healthy / disease / pest / deficiency / unsure), and it uploads to the Worker.

- Images land in R2 already **foldered by class**:
  `crop/<crop>/<condition>/<day>-<id>.jpg` — i.e. the R2 prefix *is* a labelled
  image dataset. Labels + metadata go to D1 (`crop_samples`).
- The [image quality gate + near-dup check](../src/lib/imageQuality.ts) runs on
  every capture, so the dataset stays sharp and duplicate-free.
- It's consent-first and credited, released **CC-BY-SA-4.0**, exactly like `/voice`.

**Aim for balance:** a few hundred images per (crop, condition) you care about, shot
in *real* fields on *real* phones. Start narrow — e.g. **rice** and **cassava**,
healthy vs diseased — and widen as contributions grow. You can also seed with public
data (**[PlantVillage](https://www.tensorflow.org/datasets/catalog/plant_village)**,
~54k leaf images, ~38 classes) to bootstrap, but weight toward Cambodian crops and
conditions for real-world accuracy.

### Getting the images to your training machine

Pull the R2 prefix down (it's already class-foldered):

```bash
# one class folder per (crop, condition) — Model Maker reads exactly this shape
npx wrangler r2 object get iany-models --prefix "crop/" --local-dir ./crop_raw --recursive
# → ./crop_raw/crop/rice/healthy/*.jpg, ./crop_raw/crop/rice/disease/*.jpg, …
```

Then flatten to `dataset/<class>/…` where a **class** is what you want the model to
predict. Two common choices:

- **Per-crop health** (recommended first model): classes like `rice_healthy`,
  `rice_disease`, `cassava_healthy`, `cassava_disease`.
- **Condition only** (crop-agnostic): `healthy`, `disease`, `pest`, `deficiency`.

```bash
# example: build per-crop-health classes from the R2 layout
mkdir -p dataset
for crop in crop_raw/crop/*; do for cond in "$crop"/*; do
  cls="$(basename "$crop")_$(basename "$cond")"
  mkdir -p "dataset/$cls" && cp "$cond"/*.jpg "dataset/$cls"/ 2>/dev/null || true
done; done
```

> Publishing the dataset to Hugging Face (like `sengtha/iany-khmer-voice`) is the
> same pattern as the other collectors — add a `scripts/export-crop.mjs` +
> a workflow entry when you're ready to release a version.

---

## 1. Rent a GPU (or use Colab/Kaggle free)

MobileNetV3 fine-tunes fast — a **free Colab/Kaggle GPU** is plenty for a first
model; RunPod (see `docs/RUNPOD-KHMER-STT.md`) if you want more control.

```bash
pip install -U "mediapipe-model-maker"
```

---

## 2. Fine-tune MobileNetV3 with MediaPipe Model Maker

> 📌 **Want the concrete, tested Kaggle recipe?** Use **[CROP-MODEL.md](./CROP-MODEL.md)**
> (crop) or **[HEALTH-TEST-MODEL.md](./HEALTH-TEST-MODEL.md)** (RDT reader). They ship
> the path that actually works on Kaggle today — plain **Keras MobileNetV2 → ONNX →
> onnxruntime-web** — because `mediapipe-model-maker`/`tflite-support` **fail to
> install on Python 3.12**. The Model-Maker snippet below is kept for reference/older
> environments only.

Model Maker fine-tunes a MobileNet backbone and exports **straight to the `.tflite`
the app already runs** (same MediaPipe runtime as Trace's embedder). Simplest path:

```python
# train_crop.py
from mediapipe_model_maker import image_classifier

# 1) Data — one folder per class (see §0). Model Maker splits + augments for you.
data = image_classifier.Dataset.from_folder("dataset")
train, rest = data.split(0.8)
val, test = rest.split(0.5)

# 2) Fine-tune. MOBILENET_V2 is the built-in spec; a MobileNetV3/EfficientNet-Lite
#    spec works the same way — try a couple and keep the best test accuracy.
opts = image_classifier.ImageClassifierOptions(
    supported_model=image_classifier.SupportedModels.MOBILENET_V2,
    hparams=image_classifier.HParams(epochs=20, batch_size=32, learning_rate=0.004,
                                     export_dir="out"),
)
model = image_classifier.ImageClassifier.create(
    train_data=train, validation_data=val, options=opts)

# 3) Evaluate on held-out data — this is your real scoreboard.
loss, acc = model.evaluate(test)
print(f"test accuracy: {acc:.3f}")

# 4) Export a single .tflite (labels are baked in) → this is what the app loads.
model.export_model("crop_health.tflite")
```

Tips that matter more than hyperparameters:
- **Balance classes** and shoot in real conditions (your phones, field lighting).
- Add a **`background`/`other`** class so the model can say "not a crop leaf."
- Watch **per-class** accuracy, not just overall — a rare disease can hide in a good
  average. Collect more of the weak classes.
- More data beats a bigger model here; MobileNetV3-Small keeps it phone-fast.

---

## 3. Deploy it in iAny (offline)

Everything is already wired — you reuse Trace's MediaPipe plumbing:

**a) Mirror the model** through the Worker (like the hand + embedder models). In
[`worker/index.ts`](../worker/index.ts), host the `.tflite` under the `/models`
proxy (upload it to R2 at e.g. `sengtha/iany-crop-health/…`, or add an
`upstreamUrl` mapping). Add its prefix to `ALLOWED_PREFIXES`.

**b) Load + run it on-device** with the ready-made classifier adapter
([`src/lib/imageClassifier.ts`](../src/lib/imageClassifier.ts)):

```ts
import { createImageClassifier } from './lib/imageClassifier'

const crop = createImageClassifier({
  wasmPath: `${location.origin}/mediapipe`,
  modelUrl: `${location.origin}/models/sengtha/iany-crop-health/resolve/main/crop_health.tflite`,
  maxResults: 3,
})

await crop.prepare()                       // lazy: downloads once, then offline
const results = await crop.classify(photoBlob)   // [{label:'rice_disease', score:0.87}, …]
```

**c) Speak the result in Khmer** — pipe the top label + advice into the on-device
TTS (the same voice Radio uses). Point → classify → speak, fully offline.

The MediaPipe vision runtime is a **lazy chunk** (only loads when a classifier is
used), so no page pays for it until a farmer opens the feature.

---

## What it CAN and CANNOT do (be honest)

- ✅ Coarse, useful triage on-device, offline, in a few ms — "healthy vs a problem,"
  and common named diseases once you have data for them.
- ✅ Grow with the community: every `/crop` contribution improves the next version.
- ❌ It is **not a lab or an agronomist.** Present results as guidance ("looks like
  … — consider …"), not certainty. Show confidence; encourage a second opinion for
  serious decisions.
- ❌ Fine-grained or rare diseases need lots of examples; a small model has a lower
  ceiling. Collect where it's weak.
- ⚠️ **Bias = data.** If it only saw one region's crops/lighting, it'll do worse
  elsewhere. Spread collection across provinces and seasons.

---

## Reusing this for other verticals

Same three steps — swap only the dataset and labels:

- **Environment:** litter/waste sorting, species ID, water-quality strip reading.
- **Smart city:** citizen infrastructure reports (pothole / broken light / garbage).
- **Health (careful — screening, never diagnosis):** a **rapid-test (RDT) result
  reader** is the best low-risk start; medication/pill ID; malnutrition screening.
  Keep a human in the loop and frame everything as a flag to see a clinician.

Build a `/…` collector like `/crop`, fine-tune MobileNetV3, mirror the `.tflite`,
load it with `createImageClassifier`. The pipeline is the product.

---

Part of [iAny](https://iany.app) · Apache-2.0 code · datasets & models CC-BY-SA-4.0
· E-KHMER Technology Co., Ltd.
