# Fine-tune a Khmer female TTS voice (MMS-TTS / VITS) — Kaggle

Goal: one **good, offline, single female** Khmer voice. We fine-tune
`facebook/mms-tts-khm` (a VITS model that already knows Khmer) on **one female
speaker** from **DDD-Cambodia/khmer-speech-dataset** (727h, 5F/7M, per-speaker
IDs). MMS sounds bad only because it saw little Khmer data — fine-tuning it on
30–60h of one clean voice fixes the quality and locks it to that voice.

- Engine: **`ylacombe/finetune-hf-vits`** (adds the VITS discriminator that base
  `transformers` lacks — required for real training).
- Filenames are `{speaker_id}_khm_{sentence_id}.wav`; metadata has gender → so
  picking one female = filter by `speaker_id`. No diarization needed.
- Each female speaker has ~55–70h — you need only 10–30h, so there's headroom.

> **Time:** fine-tuning (not from-scratch) is fast because MMS already knows
> Khmer. A solid first voice at **30k steps ≈ 5–9h on a Kaggle T4** (often fits
> one 12h session; ~2–3h on an A100). Want extra polish? 60–100k steps → a
> second session. The config **checkpoints to HF every 500 steps and resumes**,
> so crossing the 12h limit is automatic if you go long.

---

## Cell 1 — INTERACTIVE: sample the 5 female voices, pick the best

Run this in a normal (interactive) session so you can *listen*. It downloads the
metadata + a few clips per female speaker and plays them.

```python
from huggingface_hub import hf_hub_download, list_repo_files, snapshot_download
from IPython.display import Audio, display
import pandas as pd, glob, os

REPO = "DDD-Cambodia/khmer-speech-dataset"

# 1) grab just the metadata files (not the 495GB of audio)
meta_dir = snapshot_download(REPO, repo_type="dataset",
    allow_patterns=["*.csv","*.tsv","*.json","*.jsonl"])
meta_files = [f for f in glob.glob(meta_dir+"/**/*", recursive=True) if os.path.isfile(f)]
print("metadata files:", meta_files)          # <-- look at these to find the columns
```

Open the metadata file, then adapt the column names below (they should include
speaker id, gender, and the transcript text):

```python
# 2) load metadata, list female speakers + how much data each has
meta = pd.read_csv([f for f in meta_files if f.endswith((".csv",".tsv"))][0])
print(meta.columns.tolist()); print(meta.head())

SPK, GENDER, TEXT = "speaker_id", "gender", "text"   # <-- fix to real column names
fem = meta[meta[GENDER].astype(str).str.lower().str.startswith("f")]
print("\nfemale speakers (clips each):")
print(fem.groupby(SPK).size().sort_values(ascending=False))
females = fem[SPK].unique().tolist()
```

```python
# 3) play 3 clips from each female speaker so you can choose the nicest voice
allf = [f for f in list_repo_files(REPO, repo_type="dataset") if f.endswith(".wav")]
for spk in females:
    picks = [f for f in allf if os.path.basename(f).startswith(f"{spk}_khm_")][:3]
    print(f"\n===== speaker {spk} =====")
    for w in picks:
        p = hf_hub_download(REPO, w, repo_type="dataset")
        print(os.path.basename(w)); display(Audio(p))
```

Listen, pick the `speaker_id` you like, and use it as `CHOSEN_SPK` below.

---

## Cell 2 — BATCH: fine-tune MMS on that voice (checkpoints + resumes)

Setup once: **Secrets →** `HF_TOKEN` (Write). Internet **On**. GPU (T4/P100).
Set `CHOSEN_SPK` to your pick. Run as **Save & Run All (Commit)**; re-run the
same commit to resume from the last HF checkpoint.

```python
import os, glob, subprocess, sys, json, pathlib
os.environ["CUDA_VISIBLE_DEVICES"] = "0"
from kaggle_secrets import UserSecretsClient
HF_TOKEN = UserSecretsClient().get_secret("HF_TOKEN")

REPO      = "DDD-Cambodia/khmer-speech-dataset"
CHOSEN_SPK = "SPK_ID_HERE"                       # <-- from Cell 1
OUT_REPO  = "sengtha/khmer-tts-female-v1"        # your fine-tuned voice
BASE_DISC = "sengtha/mms-khm-with-disc"          # generator+discriminator (built below)
SPK, TEXT = "speaker_id", "text"                 # <-- match Cell 1 column names

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
ds.save_to_disk("khm_female_ds")
print("training clips:", len(ds))

# 3) set up the VITS fine-tuning engine (adds the discriminator base transformers lacks)
if not os.path.exists("finetune-hf-vits"):
    subprocess.run(["git","clone","https://github.com/ylacombe/finetune-hf-vits"])
    subprocess.run([sys.executable,"-m","pip","install","-q","-r","finetune-hf-vits/requirements.txt"])
    subprocess.run("cd finetune-hf-vits/monotonic_align && python setup.py build_ext --inplace",
                   shell=True)

# 4) one-time: build a generator+discriminator checkpoint from MMS-khm, push to HF
#    (skips if it already exists on your HF)
if HfApi().repo_exists(BASE_DISC):
    print("disc base exists:", BASE_DISC)
else:
    subprocess.run([sys.executable,"finetune-hf-vits/convert_original_discriminator_checkpoint.py",
                    "--language_code","khm","--pytorch_dump_folder_path","mms-khm-disc",
                    "--push_to_hub", BASE_DISC], check=True)

# 5) resume: pull the latest checkpoint from OUT_REPO if a previous session pushed one
resume = None
if HfApi().repo_exists(OUT_REPO):
    try:
        ckpt = snapshot_download(OUT_REPO, allow_patterns=["checkpoint-*/*"])
        cks = sorted(glob.glob(ckpt+"/checkpoint-*"), key=lambda p: int(p.split("-")[-1]))
        resume = cks[-1] if cks else None
        print("resuming from", resume)
    except Exception as e:
        print("no resumable checkpoint:", e)

# 6) training config
cfg = {
  "project_name": "khm-female-tts",
  "model_name_or_path": BASE_DISC,
  "hub_model_id": OUT_REPO,
  "output_dir": "./vits_out",
  "overwrite_output_dir": True,
  "dataset_name": "khm_female_ds",      # load_from_disk path
  "audio_column_name": "audio",
  "text_column_name": "text",
  "train_split_name": "train",
  "do_train": True,
  "max_steps": 30000,                   # ~good voice; raise for more polish
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

# 7) train (checkpoints auto-push to OUT_REPO every 500 steps -> survives the 12h wipe)
subprocess.run(["accelerate","launch","finetune-hf-vits/run_vits_finetuning.py","ft.json"], check=True)
print("SESSION DONE. Re-run this commit to continue from the last checkpoint.")
```

---

## How to run it across sessions

1. First run: does the one-time discriminator build (step 4), preps data, starts
   training, pushes `checkpoint-500, -1000, …` to `OUT_REPO`.
2. Kaggle stops you at 12h. Just **Save & Run All (Commit) again** — step 5 pulls
   the newest checkpoint and step 6 sets `resume_from_checkpoint`, so it picks up
   where it left off.
3. Repeat until the samples sound good (listen to checkpoints — the repo saves
   audio samples during training). ~30k steps is usually a solid voice.

## Using the voice offline (later)

The result is a standard `transformers` VITS model:

```python
from transformers import VitsModel, AutoTokenizer
import torch, scipy.io.wavfile
m = VitsModel.from_pretrained("sengtha/khmer-tts-female-v1")
t = AutoTokenizer.from_pretrained("sengtha/khmer-tts-female-v1")
x = t("សួស្តី ពិភពលោក", return_tensors="pt")
with torch.no_grad(): wav = m(**x).waveform
scipy.io.wavfile.write("out.wav", m.config.sampling_rate, wav[0].numpy())
```

For **on-device / Raspberry Pi**, export this VITS to **ONNX** and run with
onnxruntime — small and CPU-only, matching iAny's offline tiers.

## Notes / caveats

- **Column names.** Adapt `SPK`/`TEXT`/`sentence_id` to the dataset's real
  metadata columns (Cell 1 prints them). The audio-path glob in step 2 assumes
  the wav name contains the sentence id — adjust if the mapping differs.
- **MMS text frontend.** MMS-khm may romanize (uroman) internally; fine-tuning
  keeps its frontend but massively upgrades the acoustics/voice. If pronunciation
  still disappoints after a long run, that's the signal to graduate to **Path B**
  (grapheme VITS or StyleTTS 2 from scratch) on this same prepared data.
- **Clean data helps most.** You have far more than 30h — if some clips are noisy,
  filter them; a smaller clean set beats a big noisy one.
- **Compute.** 30k steps ≈ 5–9h on a Kaggle T4 (a good first voice, often one
  session); ~2–3h on an A100. More steps = more polish, via resume.
