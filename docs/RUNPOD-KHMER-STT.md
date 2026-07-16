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

Good news — DDD is ready-made for this. It's
**[`DDD-Cambodia/khmer-speech-dataset`](https://huggingface.co/datasets/DDD-Cambodia/khmer-speech-dataset)**
on HF: **~450k clips**, **multi-speaker** (male + female, many `speaker_id`s like
`f-adt1-0001` / `m-adt1-0001`), with `audio` + `transcript` columns. That speaker
diversity is exactly what STT needs (the single-speaker worry was only about the
TTS *subset* — the full corpus is diverse), so you don't have to assemble anything.

Two practical facts drive §2:
- It's **huge (~495 GB, parquet with the audio embedded)** — do **not** download it
  all. §2 **streams** a capped subset (e.g. 80 h) and shuffles it for speaker/topic
  variety.
- Newer `datasets` errors when decoding its audio, so we use the same workaround as
  the TTS pipeline (`Audio(decode=False)` + decode with `soundfile`) — see
  `docs/RUNPOD-TTS-KHMER.md`.

---

## 1. Rent a GPU on RunPod

1. runpod.io → sign in → add a few $ credit.
2. **Pods → Deploy → GPU Cloud.** whisper-tiny is tiny, so a cheap card is plenty:
   pick **RTX A4000 / RTX 4090** (~$0.2–0.7/hr).
3. Template: **RunPod PyTorch 2.x**. Set a **Volume ~150 GB** at `/workspace`
   (the streamed audio subset + checkpoints need room) so it persists.
4. Deploy → **Connect → Jupyter Lab** (or Web Terminal / SSH).

Install deps (terminal):

```bash
pip install -U "transformers>=4.44" datasets accelerate evaluate jiwer librosa soundfile tensorboard huggingface_hub
```

---

## 2. Build the training subset (stream from DDD)

Streams DDD, decodes + resamples each clip to **16 kHz mono**, writes WAVs, and
saves a ready-to-train `datasets` dataset. It **shuffles** the stream so the
subset spans many speakers/topics (not one block), and caps at `TARGET_HOURS`.
Writing WAVs to disk (not RAM) keeps it memory-safe.

```python
# build_ds.py  — run in the pod
import os, io, soundfile as sf, librosa
from datasets import load_dataset, Dataset, Audio
from huggingface_hub import login
from getpass import getpass

login(getpass("HF token: "))            # typed at the prompt, not stored in code
REPO = "DDD-Cambodia/khmer-speech-dataset"
OUT = "/workspace/clips"; os.makedirs(OUT, exist_ok=True)
TARGET_HOURS = 80        # plenty for whisper-tiny; raise for lower CER
MIN_SEC, MAX_SEC = 0.5, 20

raw = (load_dataset(REPO, split="train", streaming=True)
       .cast_column("audio", Audio(decode=False))      # sidestep the audio-codec dep
       .shuffle(seed=42, buffer_size=10000))            # mix speakers/topics

meta, total, i = [], 0.0, 0
for ex in raw:
    a = ex["audio"]
    b = a["bytes"] if a.get("bytes") else open(a["path"], "rb").read()
    y, sr = sf.read(io.BytesIO(b), dtype="float32")
    if y.ndim > 1: y = y.mean(1)                        # to mono
    if sr != 16000: y = librosa.resample(y, orig_sr=sr, target_sr=16000); sr = 16000
    dur = len(y) / sr
    if not (MIN_SEC <= dur <= MAX_SEC): continue
    txt = (ex.get("transcript") or "").strip()
    if not txt: continue
    p = f"{OUT}/{i:06d}.wav"; sf.write(p, y, sr)
    meta.append({"path": p, "sentence": txt})
    total += dur; i += 1
    if i % 2000 == 0: print(f"{i} clips, {total/3600:.1f} h", flush=True)
    if total >= TARGET_HOURS * 3600: break

ds = (Dataset.from_list(meta)
        .cast_column("path", Audio(sampling_rate=16000))
        .rename_column("path", "audio"))
ds = ds.train_test_split(test_size=0.01, seed=42)       # ~1% held out for eval
ds.save_to_disk("/workspace/ds")
print(ds)
```

~80 h ≈ 50–60k clips ≈ ~9 GB on disk. Want more speaker/noise variety? Also fold in
**OpenSLR SLR42** / **Common Voice** Khmer the same way (append to `meta`).

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
