# Crop-health model on Kaggle: train → deploy (guide)

Goal: turn the photos from **[iany.app/crop](https://iany.app/crop)** into a real,
**offline crop-health classifier** a farmer can point at a leaf to get
"healthy / disease / pest" — advice read aloud in Khmer, no lab, no internet.

This is the **concrete, tested Kaggle recipe**. It uses the same pipeline that
shipped `sengtha/iany-waste-v1`: a plain **Keras MobileNetV2** on Kaggle's built-in
TensorFlow → **ONNX** → **onnxruntime-web**.

> **Why not MediaPipe Model Maker?** `mediapipe-model-maker` and `tflite-support`
> **fail to install on current Kaggle/Colab (Python 3.12)** — no wheels. The
> reusable-pipeline doc [`VISION-MOBILENET.md`](./VISION-MOBILENET.md) keeps the
> Model-Maker snippet for reference, but **this** is the path that works today.

---

## 0. The plan in one line

**Bootstrap** on open leaf datasets → **fine-tune** on your `/crop` photos (the
Cambodia adaptation) → **export ONNX** → **mirror + wire** into the app. Public data
teaches "what a diseased leaf looks like"; your data teaches "…on a Cambodian crop,
on a phone, in a real field."

---

## 1. The datasets (attach on Kaggle — no download)

Ranked by relevance to Cambodian crops (rice, cassava, maize, mango…):

| Dataset (Kaggle slug) | Size / classes | Fit | Note |
|---|---|---|---|
| **PlantVillage** (`emmarex/plantdisease` or similar) | up to ~54k, ~38 classes | big, clean start | **lab backgrounds** → weak field transfer. ⚠️ **Variants differ** — many uploads have only Pepper/Potato/Tomato (**no maize**). Check with cell 1a. |
| **`aryashah2k/mango-leaf-disease-dataset`** | ~4k, 8 classes | mango, similar climate | CC BY 4.0 |
| **Cassava Leaf Disease** (`cassava-leaf-disease-classification`) | ~21k **field**, 5 classes | cassava, real phones | competition data — check redistribution |
| **`minhhuy2810/rice-diseases-image-dataset`** (or similar rice set) | thousands, blast/blight/brown-spot | **rice = #1 crop** | mix several rice sets |
| **`therealoise/bean-leaf-lesions-classification`** (iBean) | ~1.3k field, 3 classes | beans, field | small |

Master picture + more sets: search Kaggle for "leaf disease" and filter to your crops.

> **License → your model's license.** Keep each dataset's terms; credit them all in
> the model card and release the model permissively (CC-BY-SA-4.0, like `/voice`).

---

## 2. New Kaggle notebook — settings

- **Accelerator: GPU T4 x2**, **Internet: On** (phone-verified account).
- **Add Data** (🔎) → attach the datasets above. They mount read-only under
  `/kaggle/input/<slug>/`. You build training folders under `/kaggle/working` (writable).
- Store your `HF_TOKEN` once via **Add-ons → Secrets** (for the upload step).

---

## 3. Build the training folders (`dataset/<class>/…`)

The app's crop taxonomy is in
[`src/assets/cropLabels.ts`](../src/assets/cropLabels.ts): crops `rice, cassava,
maize, banana, mango, vegetable, chili, pepper, bean, sugarcane, rubber, other` ×
conditions `healthy, disease, pest, deficiency, unsure`. The goal of this step is to
copy the attached images into one folder per **`<crop>_<condition>`** class you want
the model to predict — collapsing each dataset's specific disease into the coarse
`disease`.

> **Don't hardcode paths.** Every Kaggle dataset mounts at a *different* folder name,
> and some PlantVillage uploads have only Pepper/Potato/Tomato (no maize). So do it in
> two moves: **(3a) look at what's really mounted, then (3b) auto-copy by keyword.**

### 3a. See what's actually attached (run this first)

```python
# cell 1a — print every folder that actually holds images, with counts
import os
for base in sorted(f"/kaggle/input/{d}" for d in os.listdir("/kaggle/input")):
    for dp, _, files in os.walk(base):
        imgs = [f for f in files if f.lower().endswith((".jpg", ".jpeg", ".png"))]
        if imgs:
            print(len(imgs), "→", dp)
```

Look at the printed folder names — those are your real class folders (e.g.
`…/Tomato_healthy`, `…/MangoLeafBD Dataset/Anthracnose`).

### 3b. Auto-copy by keyword (robust — no hardcoded paths)

This scans **everything** under `/kaggle/input`, and for each folder that holds images
decides its class from keywords **in the full path** (so a crop name on a *parent*
folder, like MangoLeafBD's, is still caught). `healthy` in the path → `_healthy`,
otherwise `_disease`.

```python
# cell 1b — build /kaggle/working/dataset/<class>/ from whatever is attached
import os, glob, shutil, random
random.seed(42)
OUT, CAP = "/kaggle/working/dataset", 800          # CAP per class = balance

# keyword in the folder PATH  ->  iAny crop id.  Extend as you attach more.
CROP_KW = [("mango", "mango"), ("cassava", "cassava"), ("rice", "rice"),
           ("corn", "maize"), ("maize", "maize"),
           ("tomato", "vegetable"), ("potato", "vegetable"), ("pepper", "vegetable")]

def to_class(path):
    p = path.lower()
    crop = next((c for kw, c in CROP_KW if kw in p), None)
    if not crop:
        return None                                # unknown crop → skip
    return f"{crop}_{'healthy' if 'healthy' in p else 'disease'}"

counts = {}
for base in glob.glob("/kaggle/input/*"):
    for dp, _, files in os.walk(base):
        imgs = [f for f in files if f.lower().endswith((".jpg", ".jpeg", ".png"))]
        if not imgs:
            continue
        cls = to_class(dp)                         # uses the FULL path, not basename
        if not cls:
            continue
        dst = f"{OUT}/{cls}"; os.makedirs(dst, exist_ok=True)
        random.shuffle(imgs)
        have = counts.get(cls, 0)
        for f in imgs[: max(0, CAP - have)]:
            shutil.copy(os.path.join(dp, f), f"{dst}/{cls}_{have}.jpg"); have += 1
        counts[cls] = have

for k in sorted(counts):
    print(k, "→", counts[k])
if not counts:
    print("NO MATCHES — check cell 1a's folder names and extend CROP_KW")
```

Each printed line is a class with its image count. If a class shows **0** (or is
missing), its keyword isn't in the paths cell 1a printed — add it to `CROP_KW`. Tomato,
potato, and bell-pepper map to **`vegetable`** on purpose (they're not distinct iAny
crops); mango is your cleanest single-crop signal.

### 3c. (optional) Add Cassava

Cassava (`cassava-leaf-disease-classification`, the 2020 competition) uses **label
4 = Healthy**, the rest diseases. It comes in **two shapes** on Kaggle — use the cell
that matches what you attached (run cell 1a to tell which):

**(i) JPEG version** — a `train_images/` folder of `.jpg` + a `train.csv`
(`image_id, label`). This is the official competition download and most full mirrors.

```python
# cell 1c — Cassava from JPEG + CSV
import pandas as pd, os, shutil, random
random.seed(42)
ROOT = "/kaggle/input/cassava-leaf-disease-classification"   # confirm via cell 1a
df = pd.read_csv(f"{ROOT}/train.csv")            # columns: image_id, label
CAP = 800
for healthy, sub in [(True, df[df.label == 4]), (False, df[df.label != 4])]:
    cls = f"cassava_{'healthy' if healthy else 'disease'}"
    dst = f"/kaggle/working/dataset/{cls}"; os.makedirs(dst, exist_ok=True)
    ids = sub.image_id.tolist(); random.shuffle(ids)
    for i, name in enumerate(ids[:CAP]):
        shutil.copy(f"{ROOT}/train_images/{name}", f"{dst}/{cls}_{i}.jpg")
    print(cls, "→", min(len(ids), CAP))
```

**(ii) TFRecords version** — files like `ld_train00-1427.tfrec` and **no
`train_images/` folder** (the images are serialized *inside* the `.tfrec` files, so
neither cell 1b nor the JPEG cell above can see them). Decode them instead:

```python
# cell 1c-tf — Cassava from TFRecords (ld_train*.tfrec)
import tensorflow as tf, glob, os
files = sorted(glob.glob("/kaggle/input/**/*.tfrec", recursive=True))
print(len(files), "tfrec files")

# confirm the feature keys once (cassava uses image / image_name / target):
ex = tf.train.Example.FromString(next(iter(tf.data.TFRecordDataset(files[:1]))).numpy())
print("keys:", list(ex.features.feature.keys()))

feat = {"image": tf.io.FixedLenFeature([], tf.string),
        "target": tf.io.FixedLenFeature([], tf.int64)}
CAP = 800
counts = {"cassava_healthy": 0, "cassava_disease": 0}
for r in tf.data.TFRecordDataset(files):
    e = tf.io.parse_single_example(r, feat)
    cls = "cassava_healthy" if int(e["target"]) == 4 else "cassava_disease"
    if counts[cls] >= CAP:
        if all(v >= CAP for v in counts.values()):
            break
        continue
    dst = f"/kaggle/working/dataset/{cls}"; os.makedirs(dst, exist_ok=True)
    open(f"{dst}/{cls}_{counts[cls]}.jpg", "wb").write(e["image"].numpy())  # already JPEG bytes
    counts[cls] += 1
print(counts)
```

> If the key-check prints names other than `image`/`target`, adjust `feat` to match.
> The `.jpg` written by the TFRecords cell are real JPEG bytes, so §4's loader reads
> them like any other image.

> **You control the class list.** Whatever classes end up in `dataset/` become the
> model's labels (alphabetical) — and must match `CROP_MODEL_LABELS` in the app
> ([`CropScanView.tsx`](../src/views/CropScanView.tsx)). Mango + vegetable alone give a
> working first model; add cassava/rice/maize/cashew datasets to reach the core
> Cambodian crops.

### 3d. Sanitize the images (do this before training)

Scraped datasets (CCMT, PlantVillage mirrors, …) almost always contain a few
**corrupt / truncated / CMYK** JPEGs. `tf.io.decode_jpeg` aborts the *whole batch* on
one bad file (`InvalidArgumentError: jpeg::Uncompress failed`), so re-encode
everything to clean RGB JPEG once and drop anything unreadable:

```python
# cell 1d — sanitize: re-encode to clean RGB JPEG, delete unreadable files
import os, glob
from PIL import Image
DS = "/kaggle/working/dataset"
fixed = bad = 0
for p in glob.glob(f"{DS}/**/*", recursive=True):
    if not os.path.isfile(p):
        continue
    try:
        Image.open(p).convert("RGB").save(p, "JPEG", quality=90)   # forces full decode
        fixed += 1
    except Exception:
        os.remove(p); bad += 1
print(f"re-saved {fixed} · removed {bad} bad")
```

Fast on a few thousand images, and it also normalizes CMYK/progressive/PNG-as-`.jpg`
files that would otherwise trip the decoder mid-training.

---

## 4. Train MobileNetV2 (transfer learning, Keras)

```python
# cell 2 — train
import tensorflow as tf, os, shutil
IMG, BATCH = 224, 32
DS = "/kaggle/working/dataset"

# /kaggle/working persists across runs, so an empty class folder left by an earlier
# prep attempt would become a phantom class (labels count != real classes → the
# classification_report "Number of classes does not match target_names" error). Drop them.
for d in list(os.listdir(DS)):
    p = f"{DS}/{d}"
    if os.path.isdir(p) and not any(f.lower().endswith((".jpg", ".jpeg", ".png")) for f in os.listdir(p)):
        shutil.rmtree(p); print("dropped empty class:", d)

train = tf.keras.utils.image_dataset_from_directory(
    DS, validation_split=0.2, subset="training", seed=42,
    image_size=(IMG, IMG), batch_size=BATCH, label_mode="int")
val = tf.keras.utils.image_dataset_from_directory(
    DS, validation_split=0.2, subset="validation", seed=42,
    image_size=(IMG, IMG), batch_size=BATCH, label_mode="int")

labels = train.class_names            # ALPHABETICAL — this is the output order; note it
print("LABEL ORDER:", labels)

# IMPORTANT: normalize [0,255] -> [-1,1] in the PIPELINE, not inside the model, so the
# exported ONNX expects [-1,1] input — identical to iany-waste-v1, so the app reuses
# the exact same onnxruntime-web preprocessing.
pp = tf.keras.applications.mobilenet_v2.preprocess_input
AUTOTUNE = tf.data.AUTOTUNE
train = train.map(lambda x, y: (pp(x), y)).prefetch(AUTOTUNE)
val   = val.map(lambda x, y: (pp(x), y)).prefetch(AUTOTUNE)

aug = tf.keras.Sequential([
    tf.keras.layers.RandomFlip("horizontal"),
    tf.keras.layers.RandomRotation(0.1),
    tf.keras.layers.RandomZoom(0.1),
])
base = tf.keras.applications.MobileNetV2(
    input_shape=(IMG, IMG, 3), include_top=False, weights="imagenet")
base.trainable = False

inp = tf.keras.Input((IMG, IMG, 3))            # expects [-1,1]
x = aug(inp)
x = base(x, training=False)
x = tf.keras.layers.GlobalAveragePooling2D()(x)
x = tf.keras.layers.Dropout(0.2)(x)
out = tf.keras.layers.Dense(len(labels), activation="softmax")(x)
model = tf.keras.Model(inp, out)

# 1) train the head
model.compile(optimizer=tf.keras.optimizers.Adam(1e-3),
              loss="sparse_categorical_crossentropy", metrics=["accuracy"])
model.fit(train, validation_data=val, epochs=8)

# 2) fine-tune the top of the backbone (small LR)
base.trainable = True
for l in base.layers[:-30]:
    l.trainable = False
model.compile(optimizer=tf.keras.optimizers.Adam(1e-5),
              loss="sparse_categorical_crossentropy", metrics=["accuracy"])
model.fit(train, validation_data=val, epochs=6)
```

---

## 5. Evaluate honestly (per-class, not just top-1)

```python
# cell 3 — per-class report (single pass → true & pred stay aligned)
import numpy as np
from sklearn.metrics import classification_report, confusion_matrix
# NB: val is shuffled and RESHUFFLES each iteration, so reading it twice (once for
# y_true, once for predict) would misalign labels vs predictions. Collect both in ONE pass.
y_true, y_pred = [], []
for x, y in val:
    y_true.append(y.numpy())
    y_pred.append(model.predict(x, verbose=0).argmax(1))
y_true = np.concatenate(y_true); y_pred = np.concatenate(y_pred)
print(classification_report(y_true, y_pred, target_names=labels))
print(confusion_matrix(y_true, y_pred))
```

Expect `disease ↔ healthy` confusion on look-alike leaves. A weak class = a `/crop`
collection target. **Keep a held-out set of your OWN Cambodian phone photos** — a good
score on clean lab images means little until it survives real fields.

---

## 6. Export to ONNX + upload to Hugging Face

Keras 3 breaks `tf2onnx.convert.from_keras`, so go via a **SavedModel**:

```python
# cell 4 — export
model.export("/kaggle/working/sm")     # Keras 3 SavedModel
open("/kaggle/working/labels.txt", "w").write("\n".join(labels))
```
```bash
# cell 5 — SavedModel -> ONNX
!pip -q install tf2onnx onnx
!python -m tf2onnx.convert --saved-model /kaggle/working/sm \
    --output /kaggle/working/iany-crop.onnx --opset 13
```
```python
# cell 6 — push to HF (token from Kaggle Secrets)
from kaggle_secrets import UserSecretsClient
from huggingface_hub import HfApi
TOK = UserSecretsClient().get_secret("HF_TOKEN")
api = HfApi(); api.create_repo("sengtha/iany-crop-v1", repo_type="model", exist_ok=True, token=TOK)
for f, name in [("/kaggle/working/iany-crop.onnx", "model.onnx"),
                ("/kaggle/working/labels.txt", "labels.txt")]:
    api.upload_file(path_or_fileobj=f, path_in_repo=name,
                    repo_id="sengtha/iany-crop-v1", repo_type="model", token=TOK)
print("uploaded. LABEL ORDER =", labels)
```

Add a **model card** crediting every dataset (PlantVillage, MangoLeafBD, Cassava,
rice, iBean) and stating the license — see `model-cards/iany-waste-v1.md` as a template.

---

## 7. Fine-tune on your `/crop` photos (the Cambodia step)

Your collected photos are the point. They're in R2, already class-foldered as
`crop/<crop>/<condition>/…`, labels in D1 (`crop_samples`). Pull them and fold in:

```bash
npx wrangler r2 object get iany-models --prefix "crop/" --local-dir ./crop_raw --recursive
```

Drop each labelled photo into `dataset/<crop>_<condition>/` alongside the public data,
but **oversample the local photos (3–5×)** so the model weights real Cambodian fields
above clean studio shots. Re-run §4–§6, upload to the **same repo** — the app picks it
up with no code change. This is the same flywheel as the STT `/voice` fold-in.

---

## 8. Wire it into the app (offline)

The onnxruntime-web classifier already exists — [`src/lib/wasteOnnx.ts`](../src/lib/wasteOnnx.ts)
(`createWasteClassifier({ modelUrl, labels })`): centre-crop → `[0,255]→[-1,1]` →
softmax, `numThreads=1`. The crop model uses the **same input contract**, so:

1. **Mirror the repo:** add `'sengtha/iany-crop-v1/'` to `ALLOWED_PREFIXES` in
   [`worker/index.ts`](../worker/index.ts) (the SW rule already caches `iany-*` model
   ONNX for offline use — check the `runtimeCaching` glob covers it).
2. **Classify:** point a classifier at
   `/models/sengtha/iany-crop-v1/resolve/main/model.onnx` with `labels` = the
   `LABEL ORDER` you noted. Map the top label's `<crop>_<condition>` to the emoji/Khmer
   names in [`cropLabels.ts`](../src/assets/cropLabels.ts).
3. **(Optional) live view:** add a `/crop-scan` experiment like `/waste-scan` — reuse
   [`LiveCapture`](../src/views/LiveCapture.tsx) with the crop classifier for a live
   "point → label" overlay. Pipe the top label + advice into the on-device Khmer TTS.

---

## Honest limits

- A first model from clean lab data is **confident and wrong** on messy real leaves
  until fine-tuned (§7) — ship it labelled *Experiment* in the UI until Cambodian
  accuracy is there.
- Coarse conditions (healthy/disease/pest) are deliberate. Naming the exact disease
  needs lots of per-disease examples — a later, finer model.
- On-device = private + offline, but a small model is approximate triage, **not an
  agronomist**. Present results as guidance and encourage a second opinion.

---

Part of [iAny](https://iany.app) · Apache-2.0 code · model & datasets CC-BY-SA-4.0
· see also [VISION-MOBILENET.md](./VISION-MOBILENET.md),
[HEALTH-TEST-MODEL.md](./HEALTH-TEST-MODEL.md), [WASTE-MODEL.md](./WASTE-MODEL.md).
