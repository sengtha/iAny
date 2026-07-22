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

## Cell 2 — fine-tune (five short cells; training runs in the background)

Split into small steps so it's easy to follow. **Cell 2d launches training detached**
(`start_new_session=True`) → the cell returns immediately, the run survives a browser
disconnect, and you check progress with **Cell 2e**. It still checkpoints to HF every
500 steps and resumes automatically.

```python
# ── Cell 2a — settings + login (edit these) ──────────────────────────────
CHOSEN_SPK   = "m-xxxx-xxxx"                 # your male pick from Cell 1
OUT_REPO     = "sengtha/khmer-tts-male-v1"   # your voice repo (created on first push)
BASE_DISC    = "sengtha/mms-khm-with-disc"   # discriminator base (auto-rebuilt if missing)
MAX_STEPS    = 200_000                        # match the female voice
TARGET_HOURS = 25
HF_TOKEN     = "hf_xxxxxxxx"
REPO         = "DDD-Cambodia/khmer-speech-dataset"
from huggingface_hub import login; login(HF_TOKEN)
print("ok — speaker:", CHOSEN_SPK)
```

```python
# ── Cell 2b — build the training set from parquet (reuses paths + shards_of from Cell 1) ──
import io, os, pathlib, pyarrow.parquet as pq, soundfile as sf, librosa
from huggingface_hub import hf_hub_download
from datasets import Dataset, Audio
assert 'shards_of' in globals(), "run Cell 1 first (it sets paths + shards_of)"

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
    os.remove(p)
    print(f"  ~{sec/3600:.1f}h", flush=True)
    if sec/3600 >= TARGET_HOURS: break
Dataset.from_dict({"audio":apaths,"text":texts}).cast_column("audio",Audio(sampling_rate=16000)).save_to_disk("khm_male_ds")
print("training clips:", len(apaths))          # must be > 0
```

```python
# ── Cell 2c — engine + discriminator base (Py3.12-safe; rebuilds mms-khm-with-disc if deleted) ──
import os, sys, subprocess, glob
from huggingface_hub import HfApi
if not os.path.exists("finetune-hf-vits"):
    subprocess.run(["git","clone","https://github.com/ylacombe/finetune-hf-vits"], check=True)
subprocess.run([sys.executable,"-m","pip","install","-q","-r","finetune-hf-vits/requirements.txt"], check=True)

# finetune-hf-vits pins transformers>=4.35.1 (open-ended), but recent pods ship
# transformers 5.x, which removed VitsConfig.pad_token_id -> the repo's vendored VITS
# code crashes ("'VitsConfig' object has no attribute 'pad_token_id'"). Pin to 4.x.
subprocess.run([sys.executable,"-m","pip","install","-q","transformers==4.46.3"], check=True)

# Python 3.12 removed distutils (which monotonic_align/setup.py imports); setuptools provides
# the shim. Install setuptools+cython; do NOT upgrade numpy (torch/transformers are built
# against the pod's numpy — bumping to 2.x breaks them with an ABI error).
subprocess.run([sys.executable,"-m","pip","install","-q","-U","setuptools","cython"], check=True)
env = {**os.environ, "SETUPTOOLS_USE_DISTUTILS": "local"}
r = subprocess.run("cd finetune-hf-vits/monotonic_align && python setup.py build_ext --inplace",
                   shell=True, capture_output=True, text=True, env=env)
print("STDOUT:\n", r.stdout[-1500:]); print("STDERR:\n", r.stderr[-3000:])
so = glob.glob("finetune-hf-vits/monotonic_align/**/*.so", recursive=True)
assert so, "monotonic_align build FAILED — read the STDERR above (may need: apt-get install -y build-essential)"
print("monotonic_align built ✓", so)

if not HfApi().repo_exists(BASE_DISC):
    print("rebuilding discriminator base (a few min)…", flush=True)
    subprocess.run([sys.executable,"finetune-hf-vits/convert_original_discriminator_checkpoint.py",
                    "--language_code","khm","--pytorch_dump_folder_path","mms-khm-disc",
                    "--push_to_hub", BASE_DISC], check=True)
print("engine ready ✓")
```

```python
# ── Cell 2d — write config + LAUNCH TRAINING IN BACKGROUND (detached; survives disconnect) ──
import json, glob, subprocess
from huggingface_hub import HfApi, snapshot_download
resume = None                                   # auto-resume from the last HF checkpoint
if HfApi().repo_exists(OUT_REPO):
    try:
        ck = snapshot_download(OUT_REPO, allow_patterns=["checkpoint-*/*"])
        cks = sorted(glob.glob(ck+"/checkpoint-*"), key=lambda p:int(p.split("-")[-1]))
        resume = cks[-1] if cks else None
    except Exception: pass
print("resume from:", resume)

cfg = {  # IDENTICAL loss weights to the female voice — this is the quality recipe
  "project_name":"khm-male-tts","model_name_or_path":BASE_DISC,"hub_model_id":OUT_REPO,
  "output_dir":"./vits_out","overwrite_output_dir":True,
  "dataset_name":"khm_male_ds","audio_column_name":"audio","text_column_name":"text",
  "train_split_name":"train","do_train":True,
  "max_steps":MAX_STEPS,"per_device_train_batch_size":16,"gradient_accumulation_steps":1,
  "learning_rate":2e-4,"warmup_ratio":0.01,"fp16":True,"preprocessing_num_workers":4,
  "do_step_schedule_per_epoch":True,
  "weight_disc":3,"weight_fmaps":1,"weight_gen":1,"weight_kl":1.5,"weight_mel":35,"weight_duration":1,
  "save_steps":500,"save_total_limit":2,"logging_steps":20,
  "push_to_hub":True,"hub_token":HF_TOKEN,"report_to":[],
}
if resume: cfg["resume_from_checkpoint"] = resume
json.dump(cfg, open("ft.json","w"), indent=2)

logf = open("train.log","w")
proc = subprocess.Popen(["accelerate","launch","finetune-hf-vits/run_vits_finetuning.py","ft.json"],
                        stdout=logf, stderr=subprocess.STDOUT, start_new_session=True)
print("🚀 training PID", proc.pid, "— running in background. Watch it with Cell 2e.")
```

```python
# ── Cell 2e — MONITOR (re-run anytime; this does NOT stop training) ──
!echo "--- alive? ---"; ps aux | grep -m1 "[r]un_vits_finetuning" || echo "NOT RUNNING (see train.log)"
!echo "--- last log ---"; tail -n 30 train.log
!echo "--- gpu ---"; nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv,noheader
# to STOP training:  !pkill -f run_vits_finetuning
```

Run **2a → 2b** (check `training clips > 0`) **→ 2c** (rebuilds your deleted disc base)
**→ 2d** (starts training, returns instantly) **→ 2e** (re-run to watch). You can close
the browser; on a RunPod pod the run keeps going and auto-resumes if the pod restarts.

---

## Resuming (background run, or after a stop)

- **RunPod (background):** Cell 2d runs detached, so it keeps going if you close the
  browser. If the **pod restarts**, just re-run **2a → 2b → 2c → 2d** — Cell 2d's
  `resume` logic pulls the newest checkpoint from `OUT_REPO` and continues from there.
  Watch with **2e**; stop with `!pkill -f run_vits_finetuning`.
- **Kaggle (12h limit):** run 2a–2d as **Save & Run All (Commit)**; re-commit to resume
  (same checkpoint logic). Background mode isn't needed there.
- **Compute:** ~30k steps ≈ 5–9h on a T4 (≈ **2–4h on a 4090/A5000**), so **200k ≈
  10–20h on RTX**, often one background run. Listen to the checkpoint samples and stop
  when it matches the female voice — you may not need the full 200k.

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
