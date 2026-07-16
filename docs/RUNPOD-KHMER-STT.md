# Khmer STT on-device: fine-tune whisper-tiny on DDD → deploy (RunPod guide)

Goal: turn `whisper-tiny` into a Khmer STT you own, then ship it to your
targets:

- **Mobile (whisper.rn)** ← GGML `.bin`  (the phone / edge model)
- **IoT-Linux / server (faster-whisper)** ← CTranslate2
- **PWA (transformers.js)** ← ONNX

You only *train once* (the HF model), then convert to each format.

> **License note:** if you train on **DDD** (CC-BY-SA-4.0), the resulting STT
> model inherits **CC-BY-SA-4.0** + must credit DDD-Cambodia — same as your
> voice. Plan to release it that way.

---

## 0. What you need first — the data

The one thing this guide can't do for you: get DDD into `(audio, transcript)`
pairs. You need a folder of **16 kHz mono WAV** clips + their Khmer transcripts.
The simplest layout — a `metadata.csv`:

```csv
path,sentence
clips/0001.wav,សួស្ដី តើអ្នកសុខសប្បាយជាទេ
clips/0002.wav,ការអប់រំ និងសុខភាព គឺជាមូលដ្ឋានសំខាន់
```

⚠️ **Speaker diversity matters for STT.** If DDD is the *single-speaker* set you
used for the TTS voice, an STT trained only on it will overfit to that voice.
**Mix in other Khmer speech** for robustness:
- OpenSLR **SLR42** (Google Khmer), **Common Voice** Khmer, any field recordings.
Combine them all into one `metadata.csv`. More speakers + noise = better real-world CER.

---

## 1. Rent a GPU on RunPod

1. runpod.io → sign in → add a few $ credit.
2. **Pods → Deploy → GPU Cloud.** whisper-tiny is tiny, so a cheap card is plenty:
   pick **RTX A4000 / RTX 4090** (~$0.2–0.7/hr).
3. Template: **RunPod PyTorch 2.x**. Set a **Volume** (e.g. 50 GB, mounted at
   `/workspace`) so your data + checkpoints persist.
4. Deploy → **Connect → Jupyter Lab** (or Web Terminal / SSH).
5. Upload your `clips/` + `metadata.csv` into `/workspace` (Jupyter upload, or
   `runpodctl`, or `wget` from your HF/R2).

Install deps (terminal):

```bash
pip install -U "transformers>=4.44" datasets accelerate evaluate jiwer librosa soundfile tensorboard huggingface_hub
```

---

## 2. Build the dataset

```python
# build_ds.py  — run in the pod
from datasets import Dataset, Audio
import pandas as pd

df = pd.read_csv("/workspace/metadata.csv")           # columns: path, sentence
df["path"] = "/workspace/" + df["path"]                # make absolute if needed
ds = (Dataset.from_pandas(df)
        .cast_column("path", Audio(sampling_rate=16000))  # auto-resamples to 16k
        .rename_column("path", "audio")
        .rename_column("sentence", "sentence"))
ds = ds.train_test_split(test_size=0.02, seed=42)      # ~2% held out for eval
ds.save_to_disk("/workspace/ds")
print(ds)
```

---

## 3. Fine-tune whisper-tiny (the HF recipe)

```python
# train.py
from datasets import load_from_disk
from transformers import (WhisperProcessor, WhisperForConditionalGeneration,
                          Seq2SeqTrainingArguments, Seq2SeqTrainer)
from dataclasses import dataclass
from typing import Any
import evaluate, torch

BASE = "openai/whisper-tiny"
processor = WhisperProcessor.from_pretrained(BASE, language="Khmer", task="transcribe")
ds = load_from_disk("/workspace/ds")

def prepare(b):
    a = b["audio"]
    b["input_features"] = processor.feature_extractor(a["array"], sampling_rate=16000).input_features[0]
    b["labels"] = processor.tokenizer(b["sentence"]).input_ids
    return b
ds = ds.map(prepare, remove_columns=ds["train"].column_names, num_proc=2)

@dataclass
class Collator:
    processor: Any
    def __call__(self, feats):
        batch = self.processor.feature_extractor.pad(
            [{"input_features": f["input_features"]} for f in feats], return_tensors="pt")
        lab = self.processor.tokenizer.pad(
            [{"input_ids": f["labels"]} for f in feats], return_tensors="pt")
        labels = lab["input_ids"].masked_fill(lab.attention_mask.ne(1), -100)
        if (labels[:, 0] == self.processor.tokenizer.bos_token_id).all().cpu().item():
            labels = labels[:, 1:]
        batch["labels"] = labels
        return batch

cer = evaluate.load("cer")
def compute_metrics(p):
    ids = p.label_ids; ids[ids == -100] = processor.tokenizer.pad_token_id
    pred = processor.tokenizer.batch_decode(p.predictions, skip_special_tokens=True)
    ref  = processor.tokenizer.batch_decode(ids, skip_special_tokens=True)
    return {"cer": 100 * cer.compute(predictions=pred, references=ref)}

model = WhisperForConditionalGeneration.from_pretrained(BASE)
model.generation_config.language = "km"
model.generation_config.task = "transcribe"
model.generation_config.forced_decoder_ids = None

args = Seq2SeqTrainingArguments(
    output_dir="/workspace/whisper-tiny-khmer",
    per_device_train_batch_size=32, gradient_accumulation_steps=1,
    learning_rate=3.75e-5, warmup_steps=200, max_steps=3000,   # ↑ if you have lots of data
    fp16=True, predict_with_generate=True, generation_max_length=225,
    eval_strategy="steps", eval_steps=500, save_steps=500, logging_steps=25,
    per_device_eval_batch_size=16, report_to=["tensorboard"],
    load_best_model_at_end=True, metric_for_best_model="cer", greater_is_better=False,
)
# NOTE: on transformers <4.41 use `evaluation_strategy=` instead of `eval_strategy=`.

trainer = Seq2SeqTrainer(model=model, args=args,
    train_dataset=ds["train"], eval_dataset=ds["test"],
    data_collator=Collator(processor), compute_metrics=compute_metrics,
    tokenizer=processor.feature_extractor)

trainer.train()
trainer.save_model("/workspace/whisper-tiny-khmer")
processor.save_pretrained("/workspace/whisper-tiny-khmer")
print("done — best CER:", trainer.state.best_metric)
```

Tips: watch eval **CER** drop in TensorBoard. `max_steps` ~3000 is a starting
point; scale up with data. If it overfits (train CER ≪ eval CER), add more/varied
speakers or lower `max_steps`. whisper-tiny trains in **~1–3 h on a 4090** (< $5).

---

## 4. Sanity-check it

```python
from transformers import pipeline
asr = pipeline("automatic-speech-recognition", model="/workspace/whisper-tiny-khmer",
               generate_kwargs={"language": "km", "task": "transcribe"})
print(asr("/workspace/clips/0001.wav")["text"])
```
Also transcribe a few **real, noisy** clips — that's your true accuracy.

---

## 5. Convert to each platform (once trained)

**A) GGML `.bin` for mobile (whisper.rn / whisper.cpp)**
```bash
cd /workspace
git clone https://github.com/openai/whisper
git clone https://github.com/ggml-org/whisper.cpp
python whisper.cpp/models/convert-h5-to-ggml.py ./whisper-tiny-khmer ./whisper .
# -> ggml-model.bin
# build tools + quantize (q5_1 = small & good for phones)
cmake -S whisper.cpp -B whisper.cpp/build && cmake --build whisper.cpp/build -j --config Release
./whisper.cpp/build/bin/quantize ggml-model.bin ggml-tiny-khmer-q5_1.bin q5_1
```

**B) CTranslate2 for IoT-Linux / server (faster-whisper)**
```bash
pip install ctranslate2
ct2-transformers-converter --model ./whisper-tiny-khmer \
  --output_dir whisper-tiny-khmer-ct2 --quantization int8 \
  --copy_files tokenizer_config.json preprocessor_config.json
```

**C) ONNX for the PWA (transformers.js)**
```bash
pip install "optimum[onnxruntime]"
optimum-cli export onnx --model ./whisper-tiny-khmer \
  --task automatic-speech-recognition-with-past ./whisper-tiny-khmer-onnx
```

---

## 6. Publish to Hugging Face (never paste your token in code)

```python
from huggingface_hub import login, HfApi
from getpass import getpass
login(getpass("HF write token: "))         # typed at the prompt, not stored
api = HfApi(); REPO = "sengtha/whisper-tiny-khmer"
api.create_repo(REPO, exist_ok=True)
api.upload_folder(folder_path="/workspace/whisper-tiny-khmer", repo_id=REPO)   # HF model
api.upload_file(path_or_fileobj="/workspace/ggml-tiny-khmer-q5_1.bin",
                path_in_repo="ggml-tiny-khmer-q5_1.bin", repo_id=REPO)         # mobile
# (upload the ct2 folder / onnx folder too if you want them hosted)
```
Add a README with **CC-BY-SA-4.0 + credit to DDD-Cambodia**.

---

## 7. Integrate in the app

**Mobile — `whisper.rn`** (native module, needs a dev/EAS build, exactly like your `llama.rn`):
```bash
cd mobile && npx expo install whisper.rn
```
```ts
import { initWhisper } from 'whisper.rn'
import { Audio } from 'expo-av'

// 1) load the ggml .bin (download via your model mirror + ensureFile, like the others)
const ctx = await initWhisper({ filePath: ggmlPath })

// 2) record 16 kHz mono, then transcribe
const { promise } = ctx.transcribe(wavPath, { language: 'km' })
const { result } = await promise      // -> Khmer text
```
Then feed `result` straight into your RAG `ask()`. Voice → text → LLM → (TTS) — fully offline.

**Serve the model through your worker mirror:** add the repo to the allowlist in
`worker/index.ts` (same as we did for OCR):
```ts
'sengtha/whisper-tiny-khmer/', // Khmer STT (whisper.rn ggml + ct2)
```
then `wrangler deploy`. (Tell me when it's up and I'll wire the mobile download + record→transcribe screen.)

**PWA:** load the ONNX with transformers.js (`pipeline('automatic-speech-recognition', 'sengtha/whisper-tiny-khmer', { device:'wasm' })`), Web Audio to capture the mic.

**IoT (Linux):** `faster-whisper` with the ct2 folder — done.

---

## Cost / time
- RunPod RTX 4090: ~$0.5/hr · whisper-tiny fine-tune ≈ 1–3 h → **under ~$5**.
- Convert + upload: minutes.

## Recap
Train `whisper-tiny` once → GGML (mobile) + ct2 (IoT) + ONNX (PWA). DDD (+ diverse
Khmer speech) is your fuel; CER on real clips is your scoreboard; CC-BY-SA is your
license. That completes the offline trio: **STT → LLM → TTS**, all on-device.
