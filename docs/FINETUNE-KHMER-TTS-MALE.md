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
2. **Install deps first** — the RunPod PyTorch image doesn't ship them (Kaggle does).
   Run this before Cell 1, or you'll get `ModuleNotFoundError: No module named
   'huggingface_hub'`:
   ```python
   !pip install -q huggingface_hub datasets pandas soundfile librosa
   ```
   (Cell 2's step 3 installs the training deps via `finetune-hf-vits/requirements.txt`.)
3. **Auth** — replace the two Kaggle-secret lines at the top of Cell 2 with:
   ```python
   from huggingface_hub import login
   login("hf_xxxxxxxxxxxx")          # your HF Write token
   HF_TOKEN = "hf_xxxxxxxxxxxx"       # cfg["hub_token"] still needs it
   ```
   Everything else in Cells 1–2 runs unchanged.
4. **VRAM → batch size** (`per_device_train_batch_size`):

   | GPU VRAM | batch | note |
   |---|---|---|
   | **≥24 GB** (4090, A5000, A6000) | **16** (as-is) | fastest |
   | 16 GB (4060 Ti 16G, A4000) | 12–16 | |
   | 12 GB | 8 + `gradient_accumulation_steps: 2` | keep **effective batch 16** for parity |

5. **Speed:** a 4090/A5000 is ~3–5× a Kaggle T4, so **200k ≈ 10–20h**, usually one
   session. Even so, keep `save_steps: 500` — a pod can be interrupted. Cell 2's step 5
   already **resumes from the last checkpoint on HF**, so a fresh pod picks right back up.

> **✅ Data format.** Cells 1–2 read DDD's **parquet** shards directly (there are no loose
> WAVs or CSV). Watch the `training clips: N` print in Cell 2 — if it's **0**, either
> `CHOSEN_SPK` is wrong (male ids start `m-`) or `shards_of` isn't set (re-run Cell 1's
> profiling). Cell 2 reuses `paths` + `shards_of` from Cell 1.

---

## Cell 1 — INTERACTIVE: audition the male voices, pick the best

> **DDD is stored as parquet** (shards `data/train-*.parquet`, columns `speaker_id`,
> `duration`, `audio` embedded bytes, `transcript`) — **there are no loose WAVs or a
> CSV**. Speaker IDs are prefixed **`f-` / `m-`**, so male = ids starting `m-`. This
> mirrors [`RUNPOD-TTS-KHMER.md`](./RUNPOD-TTS-KHMER.md) §2–3. Run in a normal
> (interactive) session so you can *listen*.

```python
# 1) profile every speaker's hours + which shards they're in (reads only tiny columns)
import io, numpy as np, soundfile as sf, pyarrow.parquet as pq
from huggingface_hub import HfFileSystem, hf_hub_download, login
from IPython.display import Audio as Player, display
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
login("hf_xxxxxxxx")                                   # your HF token (RunPod). Kaggle: use Secrets.
REPO = "DDD-Cambodia/khmer-speech-dataset"

fs = HfFileSystem()
paths = sorted(fs.glob(f"datasets/{REPO}/data/train-*.parquet"))
print(len(paths), "shards")

def scan(ip):
    idx, pth = ip
    with fs.open(pth) as f:
        t = pq.read_table(f, columns=["speaker_id","duration"]).to_pydict()
    return idx, list(zip(t["speaker_id"], t["duration"]))

dur=defaultdict(float); cnt=defaultdict(int); shards_of=defaultdict(set); done=0
with ThreadPoolExecutor(max_workers=16) as ex:         # 16 = fast; retries on HTTP 429
    for idx, pairs in ex.map(scan, list(enumerate(paths))):
        for s,d in pairs: dur[s]+=float(d or 0); cnt[s]+=1; shards_of[s].add(idx)
        done+=1
        if done%300==0: print("scanned",done,"/",len(paths),flush=True)

print("\n=== MALE speakers by hours (id starts 'm-') ===")
for s,h,c in sorted([(s,dur[s],cnt[s]) for s in cnt if str(s).lower().startswith("m")], key=lambda x:-x[1]):
    print(f"{s}: ~{h/3600:.1f}h ({c} clips), {len(shards_of[s])} shards")
```

```python
# 2) listen to one male speaker (re-run with different ids to compare)
CHOSEN_SPK = "m-xxxx-xxxx"                              # a male with the most hours, ≥ ~15h
p = hf_hub_download(REPO, paths[min(shards_of[CHOSEN_SPK])].split(f"{REPO}/",1)[-1], repo_type="dataset")
tbl = pq.read_table(p, columns=["speaker_id","audio","transcript"]).to_pydict()
shown=0
for s,a,t in zip(tbl["speaker_id"],tbl["audio"],tbl["transcript"]):
    if str(s)!=CHOSEN_SPK: continue
    b = a["bytes"] if a.get("bytes") else open(a["path"],"rb").read()
    y,sr = sf.read(io.BytesIO(b), dtype="float32")
    print(t[:60]); display(Player(y.mean(1) if y.ndim>1 else y, rate=sr))
    shown+=1
    if shown>=3: break
```

Pick the clearest/warmest low-noise male (≥ ~15h) → set it as `CHOSEN_SPK` below.
Keep the `shards_of` / `paths` variables — Cell 2 reuses them.

---

## Cell 2 — BATCH: fine-tune MMS on that male voice (checkpoints + resumes)

GPU: Kaggle T4/P100, or a **RunPod RTX 4090 / A5000 / A6000** (see the RunPod section
above for the token change + VRAM). Set `CHOSEN_SPK` + `MAX_STEPS`. **Kaggle:** Secrets →
`HF_TOKEN` (Write), Internet On, run as **Save & Run All (Commit)** and re-run to resume.
**RunPod:** swap in `login("hf_…")` (above) and just run the cell — it resumes from the
last HF checkpoint automatically if interrupted.

```python
import os, io, pathlib, subprocess, sys, json, pyarrow.parquet as pq, soundfile as sf, librosa
os.environ["CUDA_VISIBLE_DEVICES"] = "0"
# TOKEN — RunPod: login("hf_…"); Kaggle: from kaggle_secrets import UserSecretsClient; ...get_secret("HF_TOKEN")
from huggingface_hub import login, snapshot_download, hf_hub_download, HfApi
HF_TOKEN = "hf_xxxxxxxx"; login(HF_TOKEN)

REPO       = "DDD-Cambodia/khmer-speech-dataset"
CHOSEN_SPK = "m-xxxx-xxxx"                       # <-- your male pick from Cell 1
OUT_REPO   = "sengtha/khmer-tts-male-v1"         # your fine-tuned MALE voice
BASE_DISC  = "sengtha/mms-khm-with-disc"         # generator+discriminator (shared with female; reused)
MAX_STEPS  = 200_000                             # <-- MATCH the female voice (30_000 = quick first pass)
TARGET_HOURS = 25                                # 20–40h of clean speech is plenty

# 1+2) build the HF dataset from PARQUET shards (reuses paths/shards_of from Cell 1;
#      if this cell runs standalone, re-run Cell 1's profiling first).
from datasets import Dataset, Audio
out = pathlib.Path("male_wavs"); out.mkdir(exist_ok=True)
apaths=[]; texts=[]; sec=0.0; i=0
for si in sorted(shards_of[CHOSEN_SPK]):
    p = hf_hub_download(REPO, paths[si].split(f"{REPO}/",1)[-1], repo_type="dataset")
    tbl = pq.read_table(p, columns=["speaker_id","audio","transcript","duration"]).to_pydict()
    for s,a,t,d in zip(tbl["speaker_id"],tbl["audio"],tbl["transcript"],tbl["duration"]):
        if str(s)!=CHOSEN_SPK: continue
        b = a["bytes"] if a.get("bytes") else open(a["path"],"rb").read()
        y,sr = sf.read(io.BytesIO(b), dtype="float32")
        if y.ndim>1: y=y.mean(1)
        if sr!=16000: y=librosa.resample(y, orig_sr=sr, target_sr=16000); sr=16000
        wp=str(out/f"{i:06d}.wav"); sf.write(wp,y,sr); apaths.append(wp); texts.append(str(t)); i+=1
        sec += float(d) if d else len(y)/sr
    os.remove(p)                                 # free disk as we go
    print(f"shard {si}: ~{sec/3600:.1f}h", flush=True)
    if sec/3600 >= TARGET_HOURS: break
ds = Dataset.from_dict({"audio":apaths,"text":texts}).cast_column("audio", Audio(sampling_rate=16000))
ds.save_to_disk("khm_male_ds")
print("training clips:", len(ds))                # must be > 0

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
