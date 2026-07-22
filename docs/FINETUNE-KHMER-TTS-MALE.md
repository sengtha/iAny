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
   !pip install -q huggingface_hub hf_transfer "datasets[audio]==2.21.0" pandas soundfile librosa pyarrow
   ```
   (`hf_transfer` because RunPod sets `HF_HUB_ENABLE_HF_TRANSFER=1` and errors without it.
   `datasets==2.21.0` because 4.x decodes audio via **torchcodec**, which needs a CUDA lib
   the pod lacks (`libnvrtc.so.13`); 2.x uses soundfile. Cell 2c pins transformers+datasets.)
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

## Cell 0 — environment (run FIRST on a fresh pod, then RESTART the kernel)

`finetune-hf-vits` targets a 2024-era stack; modern pods ship bleeding-edge packages
that break it in a chain (transformers 5.x, datasets 4.x/torchcodec, numpy 2.x, missing
hf_transfer). Pin a **coherent set once**, then **restart the kernel** so the numpy
downgrade takes effect. Do this before Cell 1.

```python
import subprocess, sys
subprocess.run([sys.executable,"-m","pip","install","-q",
    "numpy==1.26.4",             # 2.x + the older pandas/pyarrow -> import errors
    "scipy==1.13.1",             # pod's scipy wants numpy>=2.0; pin one that supports 1.26
    "transformers==4.46.3",      # 5.x removed VitsConfig.pad_token_id
    "datasets[audio]==2.21.0",   # 4.x decodes audio via torchcodec (needs a CUDA lib absent here)
    "huggingface_hub", "hf_transfer",  # RunPod sets HF_HUB_ENABLE_HF_TRANSFER=1
    "pyarrow", "pandas", "soundfile", "librosa", "cython", "setuptools",
], check=True)
print("env pinned ✓ — now RESTART the kernel (Kernel → Restart), then run Cell 1 onward")
```

> After the restart you can skip Cell 0. The transformers/datasets pins also live in
> Cell 2c as a safety net (re-running Cell 2c won't undo them).

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
disconnect, and you check progress with **Cell 2e**. It saves **local** checkpoints to
`output_dir` (on the persistent `/workspace` volume) and pushes the finished model to
`OUT_REPO` **at the end of the run**. To get a listenable voice + a Hub push sooner,
**train in segments** — set `MAX_STEPS` to e.g. `40000` first, listen, then raise it and
re-run (it resumes from the local checkpoint).

```python
# ── Cell 2a — settings + login (edit these) ──────────────────────────────
CHOSEN_SPK   = "m-xxxx-xxxx"                 # your male pick from Cell 1
OUT_REPO     = "sengtha/khmer-tts-male-v1"   # your voice repo (created on first push)
DATA_REPO    = "sengtha/ddd-male-tts"        # the training set is pushed here (trainer loads via load_dataset)
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
# speaker_id is required by the trainer's model call (all 0 = single speaker).
ds = Dataset.from_dict({"audio":apaths,"text":texts,"speaker_id":[0]*len(apaths)}).cast_column("audio",Audio(sampling_rate=16000))
print("training clips:", len(apaths))          # must be > 0
# The trainer loads with load_dataset(DATA_REPO) — which can't read a local save_to_disk
# folder — so push to the Hub (also persists it, so resumes don't rebuild).
ds.push_to_hub(DATA_REPO, private=True)
print("pushed dataset →", DATA_REPO)
```

```python
# ── Cell 2c — engine + discriminator base (Py3.12-safe; rebuilds mms-khm-with-disc if deleted) ──
import os, sys, subprocess, glob
from huggingface_hub import HfApi
if not os.path.exists("finetune-hf-vits"):
    subprocess.run(["git","clone","https://github.com/ylacombe/finetune-hf-vits"], check=True)
subprocess.run([sys.executable,"-m","pip","install","-q","-r","finetune-hf-vits/requirements.txt"], check=True)

# Single-speaker patch: the script only adds batch["speaker_id"] when >1 speaker, but
# the model call reads it unconditionally -> KeyError for one voice. Make it tolerant.
_p = "finetune-hf-vits/run_vits_finetuning.py"; _s = open(_p).read()
if 'if "speaker_id" in batch' not in _s:
    _s = _s.replace('speaker_id=batch["speaker_id"],',
                    'speaker_id=(batch["speaker_id"] if "speaker_id" in batch else None),')
    open(_p, "w").write(_s); print("patched single-speaker speaker_id access")

# The repo's open-ended pins pull incompatible latest versions. Pin the tested pair:
#  - transformers 5.x removed VitsConfig.pad_token_id -> vendored VITS crashes.
#  - datasets 4.x decodes audio via torchcodec -> needs libnvrtc.so.13 the pod lacks.
subprocess.run([sys.executable,"-m","pip","install","-q","transformers==4.46.3","datasets[audio]==2.21.0"], check=True)

# Python 3.12 removed distutils (which monotonic_align/setup.py imports); setuptools provides
# the shim. Install setuptools+cython; do NOT upgrade numpy (torch/transformers are built
# against the pod's numpy — bumping to 2.x breaks them with an ABI error).
subprocess.run([sys.executable,"-m","pip","install","-q","-U","setuptools","cython","hf_transfer"], check=True)
import shutil
env = {**os.environ, "SETUPTOOLS_USE_DISTUTILS": "local"}
subprocess.run("cd finetune-hf-vits/monotonic_align && python setup.py build_ext --inplace",
               shell=True, env=env, check=False)
# The package's __init__ does `from .monotonic_align.core import ...`, so the built core*.so
# must live in a NESTED monotonic_align/monotonic_align/ dir — modern build_ext puts it
# elsewhere, so place it there and verify the ACTUAL import (not just that a .so exists).
ma = "finetune-hf-vits/monotonic_align"; nested = f"{ma}/monotonic_align"
os.makedirs(nested, exist_ok=True); open(f"{nested}/__init__.py","a").close()
for so in glob.glob(f"{ma}/**/core*.so", recursive=True):
    dst = f"{nested}/{os.path.basename(so)}"
    if os.path.abspath(so) != os.path.abspath(dst): shutil.copy(so, dst)
chk = subprocess.run([sys.executable,"-c","from monotonic_align import maximum_path; print('MA OK')"],
                     cwd="finetune-hf-vits", capture_output=True, text=True)
assert "MA OK" in chk.stdout, "monotonic_align import failed (may need apt-get install -y build-essential):\n"+chk.stderr[-2000:]
print("monotonic_align ✓")

if not HfApi().repo_exists(BASE_DISC):
    print("rebuilding discriminator base (a few min)…", flush=True)
    subprocess.run([sys.executable,"finetune-hf-vits/convert_original_discriminator_checkpoint.py",
                    "--language_code","khm","--pytorch_dump_folder_path","mms-khm-disc",
                    "--push_to_hub", BASE_DISC], check=True)
print("engine ready ✓")
```

```python
# ── Cell 2d — write config + LAUNCH TRAINING IN BACKGROUND (detached; survives disconnect) ──
# NOTE: this script pushes the model to OUT_REPO only ONCE, at the end of the run. During
# training it saves LOCAL checkpoints to output_dir. So put output_dir on the persistent
# /workspace volume (survives a pod restart) and resume from the newest LOCAL checkpoint.
import json, glob, subprocess
OUTPUT_DIR = "/workspace/vits_out"              # persistent Network Volume
cks = sorted(glob.glob(f"{OUTPUT_DIR}/checkpoint-*"), key=lambda p:int(p.split("-")[-1]))
resume = cks[-1] if cks else None
print("resume from local checkpoint:", resume)

cfg = {  # IDENTICAL loss weights to the female voice — this is the quality recipe
  "project_name":"khm-male-tts","model_name_or_path":BASE_DISC,"hub_model_id":OUT_REPO,
  "output_dir":OUTPUT_DIR,"overwrite_output_dir":True,
  "dataset_name":DATA_REPO,"audio_column_name":"audio","text_column_name":"text",
  "speaker_id_column_name":"speaker_id",   # single speaker (all 0); required by the trainer
  "train_split_name":"train","do_train":True,
  "max_steps":MAX_STEPS,"per_device_train_batch_size":16,"gradient_accumulation_steps":1,
  "learning_rate":2e-4,"warmup_ratio":0.01,"fp16":True,"preprocessing_num_workers":4,
  "do_step_schedule_per_epoch":True,
  "weight_disc":3,"weight_fmaps":1,"weight_gen":1,"weight_kl":1.5,"weight_mel":35,"weight_duration":1,
  "save_steps":500,"save_total_limit":2,"logging_steps":20,
  "push_to_hub":True,"hub_token":HF_TOKEN,"token":HF_TOKEN,"report_to":[],
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

## Checkpoints, pushing & resuming (important)

- **The Hub push happens only at the END of a run** (the script does
  `model.save_pretrained(output_dir)` → `push_to_hub(OUT_REPO)` after `MAX_STEPS`).
  During training it saves **local** checkpoints to `output_dir` every `save_steps`.
- **Keep `output_dir` on the persistent volume** (`/workspace/vits_out`) so a RunPod
  restart doesn't lose progress. Cell 2d resumes from the newest **local** checkpoint.
- **Train in segments to hear progress + get Hub pushes sooner.** Set `MAX_STEPS=40000`
  first → it finishes, pushes a real voice to `OUT_REPO`, you listen; then raise
  `MAX_STEPS` and re-run **2d** — it resumes from the local checkpoint and pushes again
  at the new target. Repeat until it matches the female voice (likely before 200k).
- **Restart recovery:** if the pod restarts, re-run **2a → 2c → 2d** (dataset's already
  on the Hub, so you can skip 2b). Cell 2d finds `/workspace/vits_out/checkpoint-*` and
  continues. Watch with **2e**; stop with `!pkill -f run_vits_finetuning`.
- **Compute:** ~30k steps ≈ **2–4h on a 4090/A5000** (~5–9h on a T4), so **200k ≈
  10–20h on RTX**.

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
