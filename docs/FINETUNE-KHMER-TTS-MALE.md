# Fine-tune a Khmer **male** TTS voice (MMS-TTS / VITS) — Kaggle

Goal: one **good, offline, single male** Khmer voice that matches the quality of the
current female voice ([`sengtha/khmer-tts-female-v2`](https://huggingface.co/sengtha/khmer-tts-female-v2)).

**This is the same recipe as [`FINETUNE-KHMER-TTS.md`](./FINETUNE-KHMER-TTS.md)** — same
base model, same engine, same loss weights. The **only** differences are:
1. pick a **male** speaker (DDD has **7 male** speakers), not female,
2. a male **output repo**, and
3. the **same step count** you trained the female voice to.

> **Matching quality = matching the recipe, not just the model.** VITS quality is very
> sensitive to (a) the loss weights and (b) how long you train. The female voice's
> polish came from a **long run** (you mentioned ~**200** — read this as **200k steps**).
> A first pass at 30k already sounds decent; parity with female-v2 means training the
> male to the **same number of steps** with the **same config below**. If your female
> number means something else (200 epochs? a checkpoint tag?), set `MAX_STEPS` to match
> that instead — it's the one knob that decides "as good as the female."

- Base: **`facebook/mms-tts-khm`** (a VITS model that already knows Khmer).
- Engine: **`ylacombe/finetune-hf-vits`** (adds the VITS discriminator `transformers` lacks).
- Data: **DDD-Cambodia/khmer-speech-dataset** (727h, 5F/**7M**, per-speaker IDs).
  Each male speaker has ~55–70h; you need only 20–40h of the **cleanest** clips.

## Quality-parity checklist (do these or it won't match female)

- ✅ **Same loss weights** as female (`weight_mel 35`, `weight_kl 1.5`, `weight_disc 3`, …) — kept identical in Cell 2.
- ✅ **Same step count** — `MAX_STEPS` = whatever the female voice used (~200k for a polished v2).
- ✅ **One clean speaker.** Pick the nicest-sounding male in Cell 1; drop noisy clips.
- ✅ **16 kHz mono** audio (the cast in Cell 2 handles it).
- ✅ **Listen to checkpoints** — the engine saves audio samples during training; stop when it sounds as good as female.

---

## Run on a RunPod RTX pod (recommended — faster than Kaggle, no 12h wipe)

The cells below are **not** Kaggle-specific; only the HF-token line changes. On an RTX
pod you get more speed and **no 12h session limit**, so 200k can finish in one run.

1. **runpod.io → Deploy → Pods → GPU:** an **RTX 4090 / A5000 / A6000** (Community Cloud
   is cheaper). Template: **RunPod PyTorch 2.x**. **Disk ≥ 100 GB** at `/workspace`
   (one speaker's audio + checkpoints). Prefer a **Network Volume** so `/workspace`
   survives a pod restart. Connect → **Jupyter Lab** → new notebook. Work under
   `/workspace`. **Stop the pod when done** (you pay while it runs).
2. **Auth** — replace the two Kaggle-secret lines at the top of Cell 2 with:
   ```python
   from huggingface_hub import login
   login("hf_xxxxxxxxxxxx")          # your HF Write token
   HF_TOKEN = "hf_xxxxxxxxxxxx"       # cfg["hub_token"] still needs it
   ```
   Everything else in Cells 1–2 runs unchanged.
3. **VRAM → batch size** (`per_device_train_batch_size`):

   | GPU VRAM | batch | note |
   |---|---|---|
   | **≥24 GB** (4090, A5000, A6000) | **16** (as-is) | fastest |
   | 16 GB (4060 Ti 16G, A4000) | 12–16 | |
   | 12 GB | 8 + `gradient_accumulation_steps: 2` | keep **effective batch 16** for parity |

4. **Speed:** a 4090/A5000 is ~3–5× a Kaggle T4, so **200k ≈ 10–20h**, usually one
   session. Even so, keep `save_steps: 500` — a pod can be interrupted. Cell 2's step 5
   already **resumes from the last checkpoint on HF**, so a fresh pod picks right back up.

> **⚠️ Data-format footgun (check this first).** This guide's Cell 2 downloads loose
> per-speaker WAVs (`snapshot_download(allow_patterns=["…_khm_*.wav"])`). Your repo's
> [`RUNPOD-TTS-KHMER.md`](./RUNPOD-TTS-KHMER.md) notes DDD is now **parquet with embedded
> audio**. If `print("training clips:", len(ds))` shows **0**, the WAV glob found nothing
> → build the dataset with the **streaming parquet decode in `RUNPOD-TTS-KHMER.md` §2**
> (filter to your male `speaker_id`), then feed it into Cell 2's training config instead.

---

## Cell 1 — INTERACTIVE: audition the 7 male voices, pick the best

Run in a normal (interactive) session so you can *listen*. Same as the female Cell 1,
but filtered to **male**.

```python
from huggingface_hub import hf_hub_download, list_repo_files, snapshot_download
from IPython.display import Audio, display
import pandas as pd, glob, os

REPO = "DDD-Cambodia/khmer-speech-dataset"

# 1) metadata only (not the 495GB of audio)
meta_dir = snapshot_download(REPO, repo_type="dataset",
    allow_patterns=["*.csv","*.tsv","*.json","*.jsonl"])
meta_files = [f for f in glob.glob(meta_dir+"/**/*", recursive=True) if os.path.isfile(f)]
meta = pd.read_csv([f for f in meta_files if f.endswith((".csv",".tsv"))][0])
print(meta.columns.tolist())                 # <-- confirm the real column names

SPK, GENDER, TEXT = "speaker_id", "gender", "text"   # <-- fix to real names
male = meta[meta[GENDER].astype(str).str.lower().str.startswith("m")]
print("\nmale speakers (clips each):")
print(male.groupby(SPK).size().sort_values(ascending=False))
males = male[SPK].unique().tolist()
```

```python
# 2) play 3 clips per male speaker so you can choose the nicest / clearest voice
allw = [f for f in list_repo_files(REPO, repo_type="dataset") if f.endswith(".wav")]
for spk in males:
    picks = [f for f in allw if os.path.basename(f).startswith(f"{spk}_khm_")][:3]
    print(f"\n===== speaker {spk} =====")
    for w in picks:
        p = hf_hub_download(REPO, w, repo_type="dataset")
        print(os.path.basename(w)); display(Audio(p))
```

Pick the `speaker_id` you like (clear, warm, low noise) → use it as `CHOSEN_SPK` below.

---

## Cell 2 — BATCH: fine-tune MMS on that male voice (checkpoints + resumes)

GPU: Kaggle T4/P100, or a **RunPod RTX 4090 / A5000 / A6000** (see the RunPod section
above for the token change + VRAM). Set `CHOSEN_SPK` + `MAX_STEPS`. **Kaggle:** Secrets →
`HF_TOKEN` (Write), Internet On, run as **Save & Run All (Commit)** and re-run to resume.
**RunPod:** swap in `login("hf_…")` (above) and just run the cell — it resumes from the
last HF checkpoint automatically if interrupted.

```python
import os, glob, subprocess, sys, json
os.environ["CUDA_VISIBLE_DEVICES"] = "0"
from kaggle_secrets import UserSecretsClient
HF_TOKEN = UserSecretsClient().get_secret("HF_TOKEN")

REPO       = "DDD-Cambodia/khmer-speech-dataset"
CHOSEN_SPK = "SPK_ID_HERE"                       # <-- your male pick from Cell 1
OUT_REPO   = "sengtha/khmer-tts-male-v1"         # your fine-tuned MALE voice
BASE_DISC  = "sengtha/mms-khm-with-disc"         # generator+discriminator (shared with female; reused)
MAX_STEPS  = 200_000                             # <-- MATCH the female voice (30_000 = quick first pass)
SPK, TEXT  = "speaker_id", "text"                # <-- match Cell 1 column names

from huggingface_hub import login, snapshot_download, HfApi
login(HF_TOKEN)

# 1) download ONLY this speaker's audio + metadata (~1/12 of the data, not 495GB)
data_dir = snapshot_download(REPO, repo_type="dataset",
    allow_patterns=[f"{CHOSEN_SPK}_khm_*.wav","*.csv","*.tsv","*.json","*.jsonl"],
    max_workers=8)

# 2) build a HF audio dataset (audio + text) filtered to this speaker
import pandas as pd
from datasets import Dataset, Audio
meta = pd.read_csv(glob.glob(data_dir+"/**/*.csv", recursive=True)[0])
meta = meta[meta[SPK].astype(str) == str(CHOSEN_SPK)].copy()
def wav_path(row):
    hits = glob.glob(f"{data_dir}/**/{CHOSEN_SPK}_khm_*{row['sentence_id']}*.wav", recursive=True)
    return hits[0] if hits else None
meta["audio"] = meta.apply(wav_path, axis=1)
meta = meta.dropna(subset=["audio"])
ds = Dataset.from_dict({"audio": meta["audio"].tolist(),
                        "text":  meta[TEXT].astype(str).tolist()})
ds = ds.cast_column("audio", Audio(sampling_rate=16000))
ds.save_to_disk("khm_male_ds")
print("training clips:", len(ds))

# 3) engine (adds the discriminator base transformers lacks)
if not os.path.exists("finetune-hf-vits"):
    subprocess.run(["git","clone","https://github.com/ylacombe/finetune-hf-vits"])
    subprocess.run([sys.executable,"-m","pip","install","-q","-r","finetune-hf-vits/requirements.txt"])
    subprocess.run("cd finetune-hf-vits/monotonic_align && python setup.py build_ext --inplace",
                   shell=True)

# 4) reuse the SAME generator+discriminator base built for the female voice (build if absent)
if HfApi().repo_exists(BASE_DISC):
    print("disc base exists:", BASE_DISC)
else:
    subprocess.run([sys.executable,"finetune-hf-vits/convert_original_discriminator_checkpoint.py",
                    "--language_code","khm","--pytorch_dump_folder_path","mms-khm-disc",
                    "--push_to_hub", BASE_DISC], check=True)

# 5) resume from the last checkpoint OUT_REPO pushed (so 200k spans sessions)
resume = None
if HfApi().repo_exists(OUT_REPO):
    try:
        ckpt = snapshot_download(OUT_REPO, allow_patterns=["checkpoint-*/*"])
        cks = sorted(glob.glob(ckpt+"/checkpoint-*"), key=lambda p: int(p.split("-")[-1]))
        resume = cks[-1] if cks else None
        print("resuming from", resume)
    except Exception as e:
        print("no resumable checkpoint:", e)

# 6) training config — IDENTICAL loss weights to the female voice (this is the quality recipe)
cfg = {
  "project_name": "khm-male-tts",
  "model_name_or_path": BASE_DISC,
  "hub_model_id": OUT_REPO,
  "output_dir": "./vits_out",
  "overwrite_output_dir": True,
  "dataset_name": "khm_male_ds",        # load_from_disk path
  "audio_column_name": "audio",
  "text_column_name": "text",
  "train_split_name": "train",
  "do_train": True,
  "max_steps": MAX_STEPS,               # <-- match the female voice
  "per_device_train_batch_size": 16,
  "gradient_accumulation_steps": 1,
  "learning_rate": 2e-4,
  "warmup_ratio": 0.01,
  "fp16": True,
  "preprocessing_num_workers": 4,
  "do_step_schedule_per_epoch": True,
  "weight_disc": 3, "weight_fmaps": 1, "weight_gen": 1,
  "weight_kl": 1.5, "weight_mel": 35, "weight_duration": 1,
  "save_steps": 500, "save_total_limit": 2,
  "logging_steps": 20,
  "push_to_hub": True, "hub_token": HF_TOKEN,
  "report_to": [],
}
if resume: cfg["resume_from_checkpoint"] = resume
json.dump(cfg, open("ft.json","w"), indent=2)

# 7) train (auto-pushes checkpoint-500,-1000,… to OUT_REPO -> survives the 12h wipe)
subprocess.run(["accelerate","launch","finetune-hf-vits/run_vits_finetuning.py","ft.json"], check=True)
print("SESSION DONE. Re-run this commit to continue from the last checkpoint.")
```

---

## Running it across sessions (200k needs several)

1. First run builds/reuses the discriminator base (step 4), preps data, starts training,
   pushes `checkpoint-500, -1000, …` to `OUT_REPO`.
2. Kaggle stops at 12h → **Save & Run All (Commit) again**; step 5 pulls the newest
   checkpoint and step 6 sets `resume_from_checkpoint`, so it continues seamlessly.
3. Repeat until it sounds as good as the female voice. **Compute:** ~30k steps ≈ 5–9h
   on a T4, so **200k ≈ 4–6 T4 sessions** (or ~2 on an A100). Listen to the saved
   samples at each checkpoint and stop when parity is reached — you may not need the
   full 200k.

## Use the voice offline (later)

Standard `transformers` VITS — swap the repo id:

```python
from transformers import VitsModel, AutoTokenizer
import torch, scipy.io.wavfile
m = VitsModel.from_pretrained("sengtha/khmer-tts-male-v1")
t = AutoTokenizer.from_pretrained("sengtha/khmer-tts-male-v1")
x = t("សួស្តី ពិភពលោក", return_tensors="pt")
with torch.no_grad(): wav = m(**x).waveform
scipy.io.wavfile.write("out.wav", m.config.sampling_rate, wav[0].numpy())
```

For on-device iAny (Radio + TTS), export to **ONNX** exactly like the female voice, add
`sengtha/khmer-tts-male-v1/` to the worker mirror `ALLOWED_PREFIXES`, and offer it as a
second voice in the TTS/Radio voice picker. (Wiring a male/female choice is a small
follow-up once the voice is ready.)

## Notes / caveats

- **Match the female's step count.** This is the difference between "decent" and "as
  good as female-v2." Set `MAX_STEPS` accordingly (you said ~200 → 200k).
- **Column names.** Adapt `SPK`/`TEXT`/`sentence_id` to the dataset's real columns
  (Cell 1 prints them); adjust the audio-path glob if the wav↔sentence mapping differs.
- **Cleanest speaker wins.** A clear, low-noise male with 20–30h clean beats a bigger
  noisy set. Filter noisy clips before training.
- **Licensing.** Trained on DDD (CC-BY-SA-4.0) → the voice is **CC-BY-SA-4.0** and must
  credit DDD-Cambodia — same as the female voice. Add a matching model card.
- **If pronunciation lags acoustics** after a long run, that's the signal to graduate to
  a grapheme VITS / StyleTTS 2 from scratch (Path B) — same as the female guide's note.

---

Part of [iAny](https://iany.app) · sibling of [FINETUNE-KHMER-TTS.md](./FINETUNE-KHMER-TTS.md)
· voice CC-BY-SA-4.0, credit DDD-Cambodia · E-KHMER Technology Co., Ltd.
