# RDT-reader model on Kaggle: train → deploy (guide)

Goal: read a **rapid diagnostic test (RDT) strip** photo and output
**positive / negative / invalid** — offline, on any phone. This is **reading a result
line, not diagnosing.** The *test* is the validated medical device; the model only
reports what the strip shows, the way a person would.

> ⚠️ **Read [`HEALTH-AI.md`](./HEALTH-AI.md) first.** Scope, consent, privacy, and the
> hard rule: **screening/reading, never diagnosis; always a human in the loop.** Ship
> it labelled *Experiment*, show confidence, and tell the user to confirm with a health
> worker. A wrong "negative" can cost a life — treat this feature with that gravity.

Same proven pipeline as [`CROP-MODEL.md`](./CROP-MODEL.md) and the shipped
`iany-waste-v1`: Keras **MobileNetV2** on Kaggle's TensorFlow → **ONNX** →
**onnxruntime-web**.

---

## 0. The honest data situation

Unlike crop, there is **no large, openly-downloadable RDT-strip dataset** for this
exact task:

- The big labelled RDT image sets (e.g. a ~106k-image, 4-country malaria-RDT corpus)
  are **held by research groups** (FIND, Audere/HealthPulse), described in papers, not
  a Kaggle download. **Partnering** (FIND in Geneva especially) is the real route to
  volume.
- The commonly-cited open "malaria dataset" is **blood-smear microscopy cells**
  (parasitized vs uninfected) — a *different task*, not strip reading.

So the plan is: **(1)** bootstrap the pipeline with **synthetic strips** you generate
(prove it trains and deploys end-to-end today), then **(2)** replace synthetic data
with **real photos from the `/health-test` collector** and any partner data. Synthetic
gets the plumbing working; real data makes it trustworthy.

---

## 1. New Kaggle notebook — settings

- **Accelerator: GPU T4 x2**, **Internet: On**.
- Store `HF_TOKEN` via **Add-ons → Secrets** for the upload step.
- Attach any RDT-strip datasets you *do* find on Kaggle/Roboflow (search "rapid test",
  "lateral flow", "RDT") into `/kaggle/input/…`; fold them in alongside synthetic.

The app's labels are in
[`src/assets/healthTestLabels.ts`](../src/assets/healthTestLabels.ts): result
(**classifier target**) `positive · negative · invalid`; test type
`malaria · dengue · pregnancy · covid · other` is **metadata** to stratify by kit.

---

## 2. Bootstrap: synthesize strip images

Draw cassette-style strips with a control line **C** and a test line **T** at varying
intensity, position, lighting, and blur — enough variety that the model learns
"two lines = positive, one line = negative, no control = invalid," not a fixed template.

```python
# cell 1 — synthetic RDT strips -> /kaggle/working/dataset/<result>/
import os, random, numpy as np
from PIL import Image, ImageDraw, ImageFilter
random.seed(42); np.random.seed(42)
OUT = "/kaggle/working/dataset"
N_PER = 1500                       # per class
W, H = 224, 224

def strip(result):
    # random cassette background + window
    bg = tuple(random.randint(200, 255) for _ in range(3))
    img = Image.new("RGB", (W, H), bg)
    d = ImageDraw.Draw(img)
    # result window (lighter rectangle)
    wx0 = random.randint(70, 90); wx1 = W - random.randint(70, 90)
    wy0 = random.randint(30, 60); wy1 = H - random.randint(30, 60)
    win = tuple(min(255, c + 15) for c in bg)
    d.rectangle([wx0, wy0, wx1, wy1], fill=win)
    cy = wy0 + (wy1 - wy0) // 3          # control line y
    ty = wy0 + 2 * (wy1 - wy0) // 3      # test line y
    def line(y, strength):               # strength 0..1
        col = tuple(int(c * (1 - strength)) for c in (180, 60, 90))  # reddish
        th = random.randint(4, 8)
        d.rectangle([wx0 + 6, y - th // 2, wx1 - 6, y + th // 2], fill=col)
    if result == "positive":             # C strong + T (often faint)
        line(cy, random.uniform(0.6, 1.0)); line(ty, random.uniform(0.25, 1.0))
    elif result == "negative":           # C only
        line(cy, random.uniform(0.6, 1.0))
    else:                                # invalid: no C (maybe T only, or blank)
        if random.random() < 0.5: line(ty, random.uniform(0.4, 1.0))
    # augment: rotate, blur, brightness, noise
    img = img.rotate(random.uniform(-12, 12), fillcolor=bg, expand=False)
    if random.random() < 0.6:
        img = img.filter(ImageFilter.GaussianBlur(random.uniform(0, 1.5)))
    arr = np.asarray(img).astype(np.int16)
    arr += np.random.randint(-12, 12, arr.shape)          # sensor noise
    arr = np.clip(arr * random.uniform(0.8, 1.15), 0, 255)  # exposure
    return Image.fromarray(arr.astype(np.uint8))

for cls in ("positive", "negative", "invalid"):
    os.makedirs(f"{OUT}/{cls}", exist_ok=True)
    for i in range(N_PER):
        strip(cls).save(f"{OUT}/{cls}/{cls}_{i}.jpg", quality=90)
    print(cls, "done")
```

> This is a **crutch, not the product.** A model trained only on synthetic strips will
> look great in the notebook and fail on real photos. Its job is to prove the pipeline
> and give you a working ONNX to wire up while real data accumulates.

---

## 3. Train MobileNetV2 (identical recipe to crop §4)

```python
# cell 2 — train  (same as CROP-MODEL.md §4; only DS + repo name differ)
import tensorflow as tf
IMG, BATCH = 224, 32
DS = "/kaggle/working/dataset"

# Drop any empty class folder left by an earlier run (/kaggle/working persists) — an
# empty class becomes a phantom label and breaks the eval report's class count.
import os, shutil
for d in list(os.listdir(DS)):
    p = f"{DS}/{d}"
    if os.path.isdir(p) and not any(f.lower().endswith((".jpg", ".jpeg", ".png")) for f in os.listdir(p)):
        shutil.rmtree(p)

train = tf.keras.utils.image_dataset_from_directory(DS, validation_split=0.2,
    subset="training", seed=42, image_size=(IMG, IMG), batch_size=BATCH, label_mode="int")
val = tf.keras.utils.image_dataset_from_directory(DS, validation_split=0.2,
    subset="validation", seed=42, image_size=(IMG, IMG), batch_size=BATCH, label_mode="int")
labels = train.class_names            # ['invalid','negative','positive'] alphabetical — NOTE IT
print("LABEL ORDER:", labels)

pp = tf.keras.applications.mobilenet_v2.preprocess_input   # [0,255] -> [-1,1] in the pipeline
AUTOTUNE = tf.data.AUTOTUNE
train = train.map(lambda x, y: (pp(x), y)).prefetch(AUTOTUNE)
val   = val.map(lambda x, y: (pp(x), y)).prefetch(AUTOTUNE)

aug = tf.keras.Sequential([tf.keras.layers.RandomFlip("horizontal"),
    tf.keras.layers.RandomRotation(0.08), tf.keras.layers.RandomZoom(0.1),
    tf.keras.layers.RandomBrightness(0.15)])
base = tf.keras.applications.MobileNetV2((IMG, IMG, 3), include_top=False, weights="imagenet")
base.trainable = False
inp = tf.keras.Input((IMG, IMG, 3))
x = aug(inp); x = base(x, training=False)
x = tf.keras.layers.GlobalAveragePooling2D()(x); x = tf.keras.layers.Dropout(0.3)(x)
out = tf.keras.layers.Dense(len(labels), activation="softmax")(x)
model = tf.keras.Model(inp, out)

model.compile(tf.keras.optimizers.Adam(1e-3), "sparse_categorical_crossentropy", ["accuracy"])
model.fit(train, validation_data=val, epochs=8)
base.trainable = True
for l in base.layers[:-30]: l.trainable = False
model.compile(tf.keras.optimizers.Adam(1e-5), "sparse_categorical_crossentropy", ["accuracy"])
model.fit(train, validation_data=val, epochs=6)
```

Keeping the input contract `[-1,1]` identical to crop/waste means the app reuses the
**same** onnxruntime-web preprocessing — only the model URL + labels change.

---

## 4. Evaluate — and weight the errors by harm

```python
# cell 3 — single pass so true & pred stay aligned (val reshuffles each iteration)
import numpy as np
from sklearn.metrics import classification_report, confusion_matrix
y_true, y_pred = [], []
for x, y in val:
    y_true.append(y.numpy())
    y_pred.append(model.predict(x, verbose=0).argmax(1))
y_true = np.concatenate(y_true); y_pred = np.concatenate(y_pred)
print(classification_report(y_true, y_pred, target_names=labels))
print(confusion_matrix(y_true, y_pred))   # rows = true, cols = pred
```

The dangerous cell is **true positive → predicted negative** (a false "you're fine").
Track it explicitly. In the app, treat low confidence or any near-tie as **invalid /
"retake or see a health worker"**, not a guess — a refusal is safer than a wrong call.

---

## 5. Export ONNX + upload (same as crop §6)

```python
model.export("/kaggle/working/sm")
open("/kaggle/working/labels.txt", "w").write("\n".join(labels))
```
```bash
!pip -q install tf2onnx onnx
!python -m tf2onnx.convert --saved-model /kaggle/working/sm \
    --output /kaggle/working/iany-health-rdt.onnx --opset 13
```
```python
from kaggle_secrets import UserSecretsClient
from huggingface_hub import HfApi
TOK = UserSecretsClient().get_secret("HF_TOKEN")
api = HfApi(); api.create_repo("sengtha/iany-health-rdt-v1", repo_type="model", exist_ok=True, token=TOK)
for f, name in [("/kaggle/working/iany-health-rdt.onnx", "model.onnx"),
                ("/kaggle/working/labels.txt", "labels.txt")]:
    api.upload_file(path_or_fileobj=f, path_in_repo=name,
                    repo_id="sengtha/iany-health-rdt-v1", repo_type="model", token=TOK)
```

The model card **must** state: reads a result line only, not a diagnosis; trained
partly/wholly on synthetic data in v1; not a medical device; confirm with a clinician.

---

## 6. Replace synthetic with real (the step that makes it real)

1. Collect via [`/health-test`](https://iany.app/health-test): strip photo + result
   (+ test type). Stored in R2 `health-test/<test>/<result>/…`, labels in D1
   (`health_test_samples`). **Strip only — no faces, names, or documents.**
2. Pull it: `npx wrangler r2 object get iany-models --prefix "health-test/" --local-dir ./rdt_raw --recursive`.
3. Fold real photos into `dataset/<result>/`, **drop synthetic as real data grows**
   (start blended, end mostly real). Stratify eval by `test` type — a model good on
   malaria cassettes may fail on a differently-shaped pregnancy strip. Consider a
   **per-test-type** model if kits differ a lot.
4. Re-run §3–§5 → same repo. App picks it up, no code change.

> **Seek a partner for volume + validation.** FIND (Geneva) and RDT manufacturers hold
> real labelled strips and the clinical expertise to validate a reader. This model
> should not gate care on its own until independently evaluated.

---

## 7. Wire it into the app (offline)

Same as crop §8 — reuse the onnxruntime-web classifier in
[`src/lib/wasteOnnx.ts`](../src/lib/wasteOnnx.ts) (identical `[-1,1]` input):

1. Add `'sengtha/iany-health-rdt-v1/'` to `ALLOWED_PREFIXES` in
   [`worker/index.ts`](../worker/index.ts) (SW caching for `iany-*` ONNX already covers it).
2. Classify at `/models/sengtha/iany-health-rdt-v1/resolve/main/model.onnx` with the
   noted `LABEL ORDER`; map to the emoji/Khmer names in `healthTestLabels.ts`.
3. **Gate the UX on safety:** show the result **with confidence**, force a
   "retake / invalid" path on low confidence, and always render the standing message —
   "reading only, not a diagnosis; confirm with a health worker." Never auto-conclude.

---

## Honest limits

- v1 trained on synthetic (or thin) data is a **plumbing demo**, not a clinical tool —
  say so in the UI and the model card.
- Kit diversity (brand, shape, colour) is the killer; one brand's data won't transfer.
  Collect and stratify across kits.
- The cost of a wrong "negative" is asymmetric and high. Bias the system toward
  "unclear → get a real test," never toward a confident guess.

---

Part of [iAny](https://iany.app) · Apache-2.0 code · model & datasets CC-BY-SA-4.0
· screening/reading only, not a medical device · see
[HEALTH-AI.md](./HEALTH-AI.md), [CROP-MODEL.md](./CROP-MODEL.md),
[VISION-MOBILENET.md](./VISION-MOBILENET.md).
