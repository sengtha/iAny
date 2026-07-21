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
| **`emmarex/plantdisease`** (PlantVillage) | ~54k, 38 classes | big, clean start | **lab backgrounds** → weak field transfer; overlap = maize, pepper, tomato/potato |
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

## 3. Map public labels → iAny classes

The app's crop taxonomy is in
[`src/assets/cropLabels.ts`](../src/assets/cropLabels.ts): crops `rice, cassava,
maize, banana, mango, vegetable, chili, pepper, bean, sugarcane, rubber, other` ×
conditions `healthy, disease, pest, deficiency, unsure`.

**First model — keep it small and useful.** Train `<crop>_<condition>` classes only
for crops you have data for, collapsing each dataset's specific disease into the
coarse `disease`. Add a `background` class so the model can say "not a leaf."

```python
# cell 1 — build /kaggle/working/dataset/<class>/ from the public sets
import os, shutil, random, pathlib
random.seed(42)
OUT = "/kaggle/working/dataset"

# (source folder on Kaggle)  ->  iAny class.  Point these at the real attached paths;
# print os.listdir('/kaggle/input') first to confirm the exact folder names.
COPY = [
    # PlantVillage (maize/corn is the useful overlap)
    ("/kaggle/input/plantdisease/PlantVillage/Corn_(maize)___healthy", "maize_healthy"),
    ("/kaggle/input/plantdisease/PlantVillage/Corn_(maize)___Common_rust", "maize_disease"),
    # Mango
    ("/kaggle/input/mango-leaf-disease-dataset/MangoLeafBD Dataset/Healthy", "mango_healthy"),
    ("/kaggle/input/mango-leaf-disease-dataset/MangoLeafBD Dataset/Anthracnose", "mango_disease"),
    # Cassava (folders are numeric class ids; 4 = healthy in the 2019 set)
    # ("/kaggle/input/cassava-leaf-disease-classification/train_images", "cassava_*"),  # needs the CSV
    # Rice — add your attached rice set's healthy / diseased folders here.
]
CAP = 800  # per class — keep balanced so a big class can't swamp a small one

for src, cls in COPY:
    dst = f"{OUT}/{cls}"; os.makedirs(dst, exist_ok=True)
    imgs = [p for p in pathlib.Path(src).rglob("*") if p.suffix.lower() in (".jpg",".jpeg",".png")]
    random.shuffle(imgs)
    for i, p in enumerate(imgs[:CAP]):
        shutil.copy(p, f"{dst}/{cls}_{i}{p.suffix.lower()}")
    print(cls, "→", min(len(imgs), CAP))
```

> Cassava's 2019 set labels images via a CSV (`train.csv`, class ids 0–4, 4=healthy),
> not folders — read the CSV and copy accordingly. Skip it for a first pass if that's
> fussy; rice + mango + maize already give you a working model.

---

## 4. Train MobileNetV2 (transfer learning, Keras)

```python
# cell 2 — train
import tensorflow as tf
IMG, BATCH = 224, 32
DS = "/kaggle/working/dataset"

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
# cell 3 — per-class report
import numpy as np
from sklearn.metrics import classification_report, confusion_matrix
y_true = np.concatenate([y for _, y in val], 0)
y_pred = model.predict(val).argmax(1)
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
