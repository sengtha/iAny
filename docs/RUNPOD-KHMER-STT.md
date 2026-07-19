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

### Your own `/voice` data — now on Hugging Face

The clips collected at [iany.app/voice](https://iany.app/voice) are published as a
dataset:
**[`sengtha/iany-khmer-voice`](https://huggingface.co/datasets/sengtha/iany-khmer-voice)**
(~5.1 h, ~76 speakers as of this writing — real phone/room audio, CC-BY-SA-4.0).
This is your **most valuable** signal: it matches how the app is actually used, in
the acoustic conditions the model must survive. It's small, so §2 pulls it
**straight from HF** (no export/upload step) and **oversamples** it so the model
weights real-world audio above the big read-speech corpora. It grows every time
people contribute — re-publish it (Actions → *Publish dataset to Hugging Face*) and
re-run §2 to fold in the newer clips.

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
pip install -U "transformers>=4.44" "datasets>=2.18,<4" accelerate evaluate jiwer librosa soundfile tensorboard huggingface_hub
# Your /voice dataset is thousands of tiny files; HF's Xet backend rate-limits
# (429) on those. Remove it so downloads use the plain LFS CDN (see §2):
pip uninstall -y hf_xet
```

> **Why `datasets<4`:** version **4.0 dropped loading-script support** (and the
> `trust_remote_code` flag). Two of our sources — **`openslr/openslr` and
> `google/fleurs`** — are still script-based, so on `datasets>=4` they fail with
> *"`trust_remote_code` is not supported anymore … based on a loading script."*
> Pinning `<4` keeps them working; everything else in this guide is unchanged. (If
> you'd rather stay on `datasets>=4`, just delete those two rows from `SOURCES` —
> DDD + km-speech-corpus + your `/voice` data are plenty. See the §2 note.)

---

## 2. Build the training subset (multi-corpus, license-clean)

More diverse speech = **the** fix for a tiny model's hallucination / repetition
and its real-world CER — more than any decode-param tweak. So we combine several
**compatibly-licensed** Khmer corpora, not just DDD.

> **⚠️ Licensing is a hard gate.** A dataset with **no license** on Hugging Face
> is *all rights reserved* — publicly downloadable ≠ permission to train a model
> you release. Only include sources with a clear, compatible license. Your model
> stays **CC-BY-SA-4.0** (from DDD); CC-BY / CC0 / Apache / MIT all combine into
> it. **Exclude** NonCommercial (CC-BY-NC) and unlicensed sets. Credit every
> source in the model card.

`SOURCES` below is the license-clean pool — edit it. Each source streams,
decodes + resamples to **16 kHz mono**, is shuffled, and capped at `hours` so no
single corpus dominates (balance matters). The transcript column is
auto-detected (`transcript` / `sentence` / `text` / `transcription`), since it
differs per dataset.

```python
# build_ds.py  — run in the pod
import os, io, tempfile, soundfile as sf, librosa
from datasets import load_dataset, Dataset, Audio
from huggingface_hub import login
from getpass import getpass

login(getpass("HF token: "))            # typed at the prompt, not stored in code

# Each source: repo, optional config, split, hours cap, license (for credits).
# ONLY clearly + compatibly licensed sets. Verify each before adding.
SOURCES = [
    {"repo": "DDD-Cambodia/khmer-speech-dataset", "split": "train", "hours": 80, "license": "CC-BY-SA-4.0"},
    {"repo": "seanghay/km-speech-corpus",         "split": "train", "hours": 40, "license": "CC-BY-4.0"},
    # ↓ These two are SCRIPT-BASED, so they need datasets<4 (see §1). On
    #   datasets>=4 they raise "trust_remote_code is not supported anymore" and the
    #   try/except below just SKIPS them — the run still succeeds on DDD +
    #   km-speech-corpus + /voice. Delete these rows if you prefer datasets>=4.
    {"repo": "google/fleurs", "config": "km_kh",  "split": "train", "hours": 12, "license": "CC-BY-4.0"},
    # OpenSLR SLR42 (Google Khmer, ~3-4 h read speech): CC-BY-SA-4.0. HEADS-UP:
    # this one serves audio as paths inside tar archives, which STREAMING doesn't
    # extract — so it decodes to 0 clips here ("DONE openslr/openslr: 0.0 h") and
    # is harmlessly skipped. It's only ~4 h of read speech DDD already covers, so
    # the simplest choice is to DELETE this row. If you truly want it, load just
    # this source with streaming=False (small, full download is fine) or grab it
    # directly from https://www.openslr.org/42/ and append rows to `meta`.
    {"repo": "openslr/openslr", "config": "SLR42", "split": "train", "hours": 6, "license": "CC-BY-SA-4.0"},
    # NOTE: Common Voice has NO Khmer set on HF, so it's not usable here.
    # Your consented /voice clips (sengtha/iany-khmer-voice) are added + oversampled
    # by a dedicated block AFTER this loop, not here — see below.
]
OUT = "/workspace/clips"; os.makedirs(OUT, exist_ok=True)
MIN_SEC, MAX_SEC = 0.5, 20
TEXT_KEYS = ("transcript", "sentence", "text", "transcription")

def text_of(ex):
    for k in TEXT_KEYS:
        v = ex.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return ""

def load16k(a):
    """Decode any clip → 16 kHz mono float. soundfile handles wav/flac;
    librosa (ffmpeg) handles mp3 (Common Voice) as a fallback."""
    b = a["bytes"] if a.get("bytes") else open(a["path"], "rb").read()
    try:
        y, sr = sf.read(io.BytesIO(b), dtype="float32")
        if y.ndim > 1: y = y.mean(1)
        if sr != 16000: y = librosa.resample(y, orig_sr=sr, target_sr=16000)
        return y
    except Exception:
        with tempfile.NamedTemporaryFile(suffix=".m", delete=True) as tf:
            tf.write(b); tf.flush()
            y, _ = librosa.load(tf.name, sr=16000, mono=True)   # decodes mp3 too
            return y

meta, i = [], 0
for s in SOURCES:
    repo = s["repo"]
    sub = os.path.join(OUT, repo.replace("/", "_")); os.makedirs(sub, exist_ok=True)
    # One bad source must not kill the whole build (a script-based dataset on
    # datasets>=4, a moved repo, a transient 5xx). Skip it and keep the rest.
    try:
        raw = (load_dataset(repo, s.get("config"), split=s["split"],
                            streaming=True, trust_remote_code=True)
               .cast_column("audio", Audio(decode=False))     # sidestep the audio-codec dep
               .shuffle(seed=42, buffer_size=10000))
    except Exception as e:
        print(f"SKIP {repo}: {e}", flush=True)
        continue
    got = 0.0
    for ex in raw:
        try:
            y = load16k(ex["audio"])
        except Exception:
            continue
        dur = len(y) / 16000
        if not (MIN_SEC <= dur <= MAX_SEC): continue
        txt = text_of(ex)
        if not txt: continue
        p = f"{sub}/{i:06d}.wav"; sf.write(p, y, 16000)
        meta.append({"path": p, "sentence": txt, "source": repo})
        got += dur; i += 1
        if i % 2000 == 0: print(f"[{repo}] {got/3600:.1f}h  total {i} clips", flush=True)
        if got >= s["hours"] * 3600: break
    print(f"DONE {repo}: {got/3600:.1f} h ({s['license']})", flush=True)

# --- Your consented /voice clips — the most valuable signal (real phones/rooms).
# Now a published HF dataset:
#   https://huggingface.co/datasets/sengtha/iany-khmer-voice
# It's small, so we DON'T cap it by hours — we take all of it and OVERSAMPLE it
# VOICE_REPEAT× so the model weights real-world audio above the big read corpora.
# 1 = no oversampling; 3 is a good start (raise it if real-clip CER lags).
#
# ⚠️ IMPORTANT — it's THOUSANDS of tiny WAVs, and Hugging Face's Xet backend
# stalls / rate-limits (429) on many small files: it fetches a per-file
# "xet-read-token", so 5k+ files => 5k+ token calls => "reconstructing file: 0%
# … 0.00B" stuck at ~18%, then a 429. Fix: DON'T use Xet. The surest way is to
# uninstall it so HF falls back to plain LFS CDN downloads — run ONCE, then
# RESTART THE KERNEL:
#     !pip uninstall -y hf_xet
# The env var below is belt-and-suspenders (must be set before hf_xet loads).
# We snapshot_download the whole repo in one RESUMABLE pass and load it as a
# local audiofolder — not the loose-file loader that hangs. Re-run if it stalls;
# it resumes. (If you still 429, wait ~5–10 min for the limit to reset.)
# The whole block is wrapped in try/except so the pipeline still runs if the
# dataset is unavailable — it just trains on the public corpora that loaded.
os.environ["HF_HUB_DISABLE_XET"] = "1"      # set BEFORE the download; plain HTTPS is reliable here
from huggingface_hub import snapshot_download
VOICE_REPEAT = 3
try:
    vdir = snapshot_download("sengtha/iany-khmer-voice", repo_type="dataset",
                             local_dir="/workspace/iany_voice_dl", max_workers=8)
    vraw = (load_dataset("audiofolder", data_dir=vdir, split="train")
            .cast_column("audio", Audio(decode=False)))
    print(f"iany/voice rows on HF: {vraw.num_rows}", flush=True)
    vsub = os.path.join(OUT, "iany_voice"); os.makedirs(vsub, exist_ok=True)
    vbase = []
    for ex in vraw:
        try:
            y = load16k(ex["audio"])
        except Exception:
            continue
        dur = len(y) / 16000
        if not (MIN_SEC <= dur <= MAX_SEC): continue
        txt = text_of(ex)                          # 'sentence' column, already in TEXT_KEYS
        if not txt: continue
        p = f"{vsub}/{i:06d}.wav"; sf.write(p, y, 16000)
        vbase.append({"path": p, "sentence": txt, "source": "iany/voice"})
        i += 1
    for _ in range(VOICE_REPEAT):
        meta.extend(vbase)
    print(f"DONE iany/voice: {len(vbase)} unique clips x{VOICE_REPEAT} = "
          f"{len(vbase)*VOICE_REPEAT} rows (consented, CC-BY-SA-4.0)", flush=True)
except Exception as e:
    print("skip iany/voice (unavailable?):", e, flush=True)

ds = (Dataset.from_list(meta)
        .cast_column("path", Audio(sampling_rate=16000))
        .rename_column("path", "audio"))
ds = ds.train_test_split(test_size=0.01, seed=42)          # ~1% held out for eval
ds.save_to_disk("/workspace/ds")
print(ds)
```

This yields a diverse, license-clean set (DDD + km-speech-corpus + FLEURS +
OpenSLR SLR42 ≈ 115–120 h — read + multi-domain, many speakers). The mp3
fallback in `load16k` stays harmless and ready for any future mp3-based source.

**Your `/voice` data is already folded in** (the block after the SOURCES loop):
it pulls `sengtha/iany-khmer-voice` from HF, takes every clip (no hours cap), and
oversamples it `VOICE_REPEAT×` because real phone/room audio is your most valuable
signal. Nothing to upload to the pod. When more people contribute, re-publish the
dataset (**Actions → Publish dataset to Hugging Face**) and re-run this script to
pick up the newer clips — one combined set, train once.

> **Dedup / no double-counting:** re-running §2 rebuilds `/workspace/ds` from
> scratch, so re-publishing the dataset and re-running never double-adds clips —
> `VOICE_REPEAT` is the *only* multiplier. (If you keep an old `/workspace/ds` and
> also build a new one, train on just one.)
>
> **One eval caveat from oversampling:** because each `/voice` clip is duplicated
> `VOICE_REPEAT×` *before* `train_test_split`, a held-out `/voice` clip can have a
> twin in train — so the headline eval CER slightly *flatters* `/voice`. Judge real
> accuracy on the §4 real-noisy-clip check. To measure `/voice` cleanly, hold out a
> few of its clips *before* the oversampling loop and oversample only the rest.

With this much data, train **whisper-base** (§3, just change `BASE`) — base +
more data is the real quality jump over tiny. With ~5 h of real `/voice` audio now
in the mix, base is the recommended target for this round.

**Credits:** list every `SOURCES` entry + its license in the model README, **plus
`sengtha/iany-khmer-voice`** (the folded-in `/voice` data) and its contributors,
and keep the release **CC-BY-SA-4.0**.

---

## 3. Fine-tune whisper-tiny — as a background job

An hours-long train must **not** die when your phone or browser disconnects.
Same pattern as the TTS run: write the script to a file, log in once so
checkpoints push to HF (they survive even a pod deletion), then launch it
**detached** with `nohup`.

### 3a. Write the training script (a notebook cell — `%%writefile` saves it)

```python
%%writefile /workspace/train.py
import os, io, evaluate, torch, soundfile as sf
from dataclasses import dataclass
from typing import Any
from datasets import load_from_disk, Audio
from transformers import (WhisperProcessor, WhisperForConditionalGeneration,
                          Seq2SeqTrainingArguments, Seq2SeqTrainer)
from transformers.trainer_utils import get_last_checkpoint

# Starting point — two valid choices (it's cheap, so try both and keep the lower CER):
#   "openai/whisper-tiny"  -> clean base, learns Khmer from DDD.  DEFAULT & recommended.
#   a Khmer whisper checkpoint -> warm-start (can converge faster), IF you find one that:
#     (a) is a TRANSFORMERS/HF checkpoint — NOT a *-ct2 (CTranslate2 = inference-only,
#         can't be fine-tuned), and
#     (b) is actually whisper-TINY — many Khmer repos are named "tiny" but are Whisper
#         SMALL (check the card's real base), which would defeat the on-phone size goal.
#   If you can't confirm both, just use the openai base — DDD is large enough to do great.
BASE = "openai/whisper-tiny"
OUT  = "/workspace/whisper-tiny-khmer"
HUB  = "sengtha/whisper-tiny-khmer"        # your HF repo (auto-created on first push)
processor = WhisperProcessor.from_pretrained(BASE, language="Khmer", task="transcribe")
# decode=False + soundfile: newer `datasets` needs `torchcodec` to decode an
# Audio column, which isn't installed — decode the wavs ourselves (same as §2).
ds = load_from_disk("/workspace/ds").cast_column("audio", Audio(decode=False))

def prepare(b):
    a = b["audio"]
    y, sr = sf.read(io.BytesIO(a["bytes"]) if a.get("bytes") else a["path"], dtype="float32")
    if y.ndim > 1: y = y.mean(axis=1)
    b["input_features"] = processor.feature_extractor(y, sampling_rate=16000).input_features[0]
    b["labels"] = processor.tokenizer(b["sentence"]).input_ids
    return b
ds = ds.map(prepare, remove_columns=ds["train"].column_names, num_proc=2)
# Whisper's decoder caps labels at 448 tokens; Khmer tokenizes densely, so a few
# long clips exceed it and would crash training. Drop them (cheap; map stays cached).
ds = ds.filter(lambda b: len(b["labels"]) <= 448, num_proc=2)

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
    output_dir=OUT,
    per_device_train_batch_size=32, gradient_accumulation_steps=1,
    learning_rate=3.75e-5, warmup_steps=200, max_steps=3000,   # ↑ with more data
    fp16=True, predict_with_generate=True, generation_max_length=225,
    eval_strategy="steps", eval_steps=500, save_steps=500, logging_steps=25,
    save_total_limit=2, per_device_eval_batch_size=16, report_to=["tensorboard"],
    load_best_model_at_end=True, metric_for_best_model="cer", greater_is_better=False,
    push_to_hub=True, hub_model_id=HUB, hub_strategy="checkpoint",  # checkpoints -> HF
)
# NOTE: on transformers <4.41 use `evaluation_strategy=` instead of `eval_strategy=`.

trainer = Seq2SeqTrainer(model=model, args=args,
    train_dataset=ds["train"], eval_dataset=ds["test"],
    data_collator=Collator(processor), compute_metrics=compute_metrics,
    processing_class=processor.feature_extractor)  # `tokenizer=` on transformers <4.46

resume = get_last_checkpoint(OUT) if os.path.isdir(OUT) else None
if resume is None and os.path.isdir(f"{OUT}/last-checkpoint"):
    resume = f"{OUT}/last-checkpoint"          # a checkpoint pulled back from HF
print("RESUME FROM:", resume, flush=True)
trainer.train(resume_from_checkpoint=resume)   # resumes if a checkpoint exists

trainer.save_model(OUT); processor.save_pretrained(OUT)
trainer.push_to_hub()                          # final model -> HF
print("DONE — best CER:", trainer.state.best_metric, flush=True)
```

### 3b. Log in once, then launch it detached

In the **Terminal** (not a cell): log in once so `push_to_hub` has a token
(cached to disk — the script never hard-codes it), then run with `nohup`.

```bash
huggingface-cli login          # paste your HF WRITE token once
cd /workspace
nohup python train.py > train.out 2>&1 &      # detached — survives disconnects
echo "pid $!"
tail -f train.out                             # watch; Ctrl-C stops WATCHING, not training
```

Close the tab / lock the phone — it keeps training. Check on it later with
`tail -f /workspace/train.out` or `nvidia-smi` (GPU busy = alive). Stop it
deliberately with `pkill -f train.py`.

**If the pod dies mid-run:** the checkpoints are already on HF. On a fresh pod,
redo §1–2, pull the last checkpoint back, then relaunch — it resumes exactly:

```bash
huggingface-cli download sengtha/whisper-tiny-khmer --include "last-checkpoint/*" \
  --local-dir /workspace/whisper-tiny-khmer
```

Watch eval **CER** fall in TensorBoard. `max_steps` ~3000 is a start; scale with
data. If it overfits (train CER ≪ eval CER), use more of DDD's speakers or fewer
steps. whisper-tiny trains in **~1–3 h on a 4090** (< $5).

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
