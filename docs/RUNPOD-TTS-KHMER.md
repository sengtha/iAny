# Best Khmer female TTS — grapheme VITS from scratch on RunPod (A100)

With 727h + an A100, the *best* Khmer voice is a **VITS trained from scratch,
grapheme-based** — it reads Khmer text directly and learns pronunciation from
the audio, sidestepping the weak eSpeak-Khmer phonemizer that caps MMS and
StyleTTS 2 quality. Result: a natural, fully-offline single female voice,
exportable to ONNX for phone / Raspberry Pi.

> Reliable fallback: if you want a quick voice first, the MMS fine-tune in
> `FINETUNE-KHMER-TTS.md` is faster but quality-capped. This doc is the "best".

Framework: **coqui-tts** (the maintained fork of Coqui TTS) — has a proven VITS
recipe and supports character (grapheme) input via `use_phonemes=False`.

Follow this doc top to bottom — it is self-contained (you don't need the MMS
doc). VITS from scratch ≈ **1–2 days A100** for a great voice, but it's
listenable much earlier; checkpoints push to HF and the run resumes.

## 1. Launch the pod

1. **runpod.io → Deploy → Pods →** GPU **A100** (Community Cloud = cheaper).
2. Template: **RunPod PyTorch 2.x**. **Container disk: 150 GB** (audio is large).
3. Connect → **Jupyter Lab** → new notebook. **Stop the pod when done.**

## 2. Inspect + pick the voice (streaming — no 495GB download)

The dataset is **parquet with audio embedded** (not loose WAVs). We stream it and
decode clips ourselves with soundfile (`decode=False` sidesteps the datasets
audio-codec dependency that errors on newer versions).

```python
import subprocess, sys
subprocess.run([sys.executable,"-m","pip","install","-q","datasets","soundfile","librosa","numpy"])
import io, numpy as np, soundfile as sf
from datasets import load_dataset, Audio
from IPython.display import Audio as Player, display
from huggingface_hub import login
from collections import defaultdict

login("hf_xxxxxxxx")                       # <-- your HF Write token
REPO = "DDD-Cambodia/khmer-speech-dataset"

# schema (no decode) -> auto-detect columns
ds = load_dataset(REPO, split="train", streaming=True)
feats = ds.features
print("FEATURES:", {k: type(v).__name__ for k,v in feats.items()})
AUD = next(k for k,v in feats.items() if type(v).__name__ == "Audio")
def find(c): return next((k for k in feats if any(x in k.lower() for x in c)), None)
SPK    = find(["speaker","spk"])
GENDER = find(["gender","sex"])
TEXT   = find(["text","transcript","sentence","script"])
print("AUDIO=",AUD," SPK=",SPK," GENDER=",GENDER," TEXT=",TEXT)

# stream WITHOUT decoding audio; decode clips manually with soundfile
ds = ds.cast_column(AUD, Audio(decode=False))
def decode(a):
    b = a["bytes"] if a.get("bytes") else open(a["path"],"rb").read()
    y, sr = sf.read(io.BytesIO(b), dtype="float32")
    return (y.mean(1) if y.ndim > 1 else y), sr

# collect 2 clips per female speaker to listen
samp = defaultdict(list); n = 0
for ex in ds:
    n += 1
    if GENDER and not str(ex[GENDER]).lower().startswith("f"): continue
    spk = str(ex[SPK])
    if len(samp[spk]) < 2: samp[spk].append((ex[AUD], str(ex[TEXT])[:50]))
    if n >= 15000 or (len(samp) >= 5 and all(len(v) >= 2 for v in samp.values())): break
print("female speakers found:", list(samp.keys()))
for spk, clips in samp.items():
    print(f"\n==== {spk} ====")
    for a, txt in clips:
        y, sr = decode(a); print(txt); display(Player(y, rate=sr))
```

Listen, pick the `speaker_id` you like → set it as `CHOSEN_SPK` in §3.

> If only one speaker appears, the shards are grouped by speaker — raise
> `n >= 15000` higher to reach the others, or just use the one you heard.

## 3a. Profile speakers (which one actually has data + where)

The `speaker_id` in §2's sample list can be a near-empty placeholder (e.g.
`f-adt1-0001` had 16 clips total). And a speaker's clips are **spread across many
shards**, so scanning shards in order wastes downloads. First map every speaker's
hours + which shards they're in, reading only the tiny `speaker_id`+`duration`
columns (no audio) in parallel.

```python
import subprocess, sys
subprocess.run([sys.executable,"-m","pip","install","-q","huggingface_hub","pyarrow","soundfile","librosa"])
import pyarrow.parquet as pq
from huggingface_hub import HfFileSystem, login
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
login("hf_xxxxxxxx")                       # <-- your HF token

REPO = "DDD-Cambodia/khmer-speech-dataset"
fs = HfFileSystem()
paths = sorted(fs.glob(f"datasets/{REPO}/data/train-*.parquet"))
print(len(paths), "shards", flush=True)

def scan(ip):
    idx, pth = ip
    with fs.open(pth) as f:
        t = pq.read_table(f, columns=["speaker_id", "duration"]).to_pydict()
    return idx, list(zip(t["speaker_id"], t["duration"]))

dur = defaultdict(float); cnt = defaultdict(int); shards_of = defaultdict(set); done = 0
with ThreadPoolExecutor(max_workers=16) as ex:      # 16 = fast but may hit HTTP 429s (it retries)
    for idx, pairs in ex.map(scan, list(enumerate(paths))):
        for s, d in pairs:
            dur[s] += float(d) if d is not None else 0.0
            cnt[s] += 1; shards_of[s].add(idx)
        done += 1
        if done % 300 == 0: print("scanned", done, "/", len(paths), flush=True)

print("\n=== speakers by clip count ===", flush=True)
for s, c in sorted(cnt.items(), key=lambda x: -x[1]):
    ss = shards_of[s]
    print(f"{s}: {c} clips (~{c*8/3600:.1f}h est), {len(ss)} shards [{min(ss)}..{max(ss)}]", flush=True)
```

Pick the **female (`f-…`) with the most hours** (needs ≥ ~15h). Optionally listen
first: download one shard from `shards_of[spk]` and play a couple of its clips.

## 3b. Extract only that speaker's shards (fast, targeted)

Downloads **only the shards containing your speaker** (from `shards_of`),
sequentially so it doesn't hit HF's 429 rate limit; deletes each after.

```python
import os, io, pathlib, numpy as np, soundfile as sf, librosa
from huggingface_hub import hf_hub_download

CHOSEN_SPK = "f-adt2-0002"      # <-- female with the most hours from 3a
TARGET_HOURS = 15
out = pathlib.Path("khm_tts"); (out/"wavs").mkdir(parents=True, exist_ok=True)
rows = []; sec = 0.0; i = 0
for si in sorted(shards_of[CHOSEN_SPK]):            # reuse shards_of from 3a
    rel = paths[si].split(f"{REPO}/", 1)[-1]        # -> data/train-...parquet
    p = hf_hub_download(REPO, rel, repo_type="dataset")
    tbl = pq.read_table(p, columns=["speaker_id", "audio", "transcript"]).to_pydict()
    for s, a, t in zip(tbl["speaker_id"], tbl["audio"], tbl["transcript"]):
        if str(s) != CHOSEN_SPK: continue
        b = a["bytes"] if a.get("bytes") else open(a["path"], "rb").read()
        y, sr = sf.read(io.BytesIO(b), dtype="float32")
        if getattr(y, "ndim", 1) > 1: y = y.mean(1)
        if sr != 22050: y = librosa.resample(np.asarray(y, dtype="float32"), orig_sr=sr, target_sr=22050)
        nm = f"{CHOSEN_SPK}_{i:06d}"; i += 1
        sf.write(out/"wavs"/f"{nm}.wav", y, 22050)
        tt = str(t).strip().replace("|", " ").replace("\n", " ")
        rows.append(f"{nm}|{tt}|{tt}"); sec += len(y)/22050
    os.remove(p)
    print(f"shard {si}: {i} clips, {sec/3600:.2f}h", flush=True)
    if sec >= TARGET_HOURS*3600: break
(out/"metadata.csv").write_text("\n".join(rows), encoding="utf-8")
print("DONE:", i, "clips,", round(sec/3600, 2), "h", flush=True)
# coqui-tts needs a transformers that has isin_mps_friendly -> pin it, then
# RESTART THE KERNEL before running §4 (transformers is already imported).
subprocess.run([sys.executable,"-m","pip","install","-q","coqui-tts","transformers==4.46.3"])
```

> After this, **Kernel → Restart** before §4 (the data on disk survives). If the
> §4 import still fails on `isin_mps_friendly`, try `transformers==4.44.2`.

## 4. Train grapheme VITS (one cell — resumable)

```python
# shim: coqui-tts imports isin_mps_friendly from transformers.pytorch_utils,
# which some transformers versions lack. Define it (a torch.isin wrapper) first.
import torch, transformers.pytorch_utils as _ptu
if not hasattr(_ptu, "isin_mps_friendly"):
    _ptu.isin_mps_friendly = lambda elements, test_elements: torch.isin(elements, test_elements)

import glob, pathlib
from trainer import Trainer, TrainerArgs
from TTS.tts.configs.shared_configs import BaseDatasetConfig, CharactersConfig
from TTS.tts.configs.vits_config import VitsConfig
from TTS.tts.datasets import load_tts_samples
from TTS.tts.models.vits import Vits, VitsAudioConfig
from TTS.tts.utils.text.tokenizer import TTSTokenizer
from TTS.utils.audio import AudioProcessor

OUT = "vits_khm"
dataset = BaseDatasetConfig(formatter="ljspeech", meta_file_train="metadata.csv", path="khm_tts")

audio = VitsAudioConfig(sample_rate=22050, win_length=1024, hop_length=256,
                        num_mels=80, mel_fmin=0, mel_fmax=None)

# Khmer graphemes — feed text directly, NO phonemes (dodges weak eSpeak-khm).
# Whole Khmer block (consonants, vowels, diacritics, digits, signs) + ASCII
# letters/digits (transcripts contain loanwords like "vitamin a"; without these
# coqui discards them and the voice can't say embedded English/numbers) + ZWSP/space.
import string
KH = "".join(chr(c) for c in range(0x1780, 0x1800)) + string.ascii_letters + string.digits
chars = CharactersConfig(
    characters_class="TTS.tts.utils.text.characters.Graphemes",
    # symbols not listed here are silently discarded during caching (harmless —
    # affects only prosody). Add any your corpus uses; % - / etc. included.
    characters=KH, punctuations="!,.?:;()\"'«»“”-–—%/​ ",
    pad="_", eos="~", bos="^", blank="@",
)

config = VitsConfig(
    audio=audio, run_name="khm_female_vits",
    batch_size=16, eval_batch_size=8, batch_group_size=5,
    num_loader_workers=8, num_eval_loader_workers=4,
    run_eval=True, test_delay_epochs=-1, epochs=1000,
    text_cleaner="basic_cleaners", use_phonemes=False,
    compute_input_seq_cache=True, print_step=25, print_eval=False,
    mixed_precision=True, output_path=OUT, datasets=[dataset],
    characters=chars, save_step=1000, save_n_checkpoints=2, cudnn_benchmark=True,
    test_sentences=["សួស្តី តើអ្នកសុខសប្បាយជាទេ?", "ថ្ងៃនេះអាកាសធាតុល្អណាស់។"],
)

ap = AudioProcessor.init_from_config(config)
tokenizer, config = TTSTokenizer.init_from_config(config)
train_samples, eval_samples = load_tts_samples(dataset, eval_split=True, eval_split_size=0.01)
model = Vits(config, ap, tokenizer, speaker_manager=None)

# resume from the newest local checkpoint if a prior session left one
ckpts = sorted(glob.glob(f"{OUT}/**/checkpoint_*.pth", recursive=True))
cont = str(pathlib.Path(ckpts[-1]).parent) if ckpts else ""
trainer = Trainer(TrainerArgs(continue_path=cont), config, OUT, model=model,
                  train_samples=train_samples, eval_samples=eval_samples)
trainer.fit()
```

## 5. Push checkpoints to HF (run periodically / after each session)

```python
from huggingface_hub import HfApi
api = HfApi(); REPO_OUT = "sengtha/khmer-tts-female-v1"   # uses your login() token
api.create_repo(REPO_OUT, exist_ok=True)
best = sorted(glob.glob("vits_khm/**/best_model.pth", recursive=True))
cfg  = sorted(glob.glob("vits_khm/**/config.json", recursive=True))
if best: api.upload_file(path_or_fileobj=best[-1], path_in_repo="best_model.pth", repo_id=REPO_OUT)
if cfg:  api.upload_file(path_or_fileobj=cfg[-1],  path_in_repo="config.json",   repo_id=REPO_OUT)
print("pushed to", REPO_OUT)
```

## 6. Synthesize / test (offline)

`TTS.api` fails to load these checkpoints two ways: (1) strict `load_state_dict`
trips on the discriminator weights, and (2) **coqui saves an incomplete
`config.json`** — it drops the ASCII letters/digits from the character set, so the
rebuilt vocab (144) mismatches the trained checkpoint (206). Load the model
directly, restoring the true training vocab (**Khmer block + ASCII letters +
digits**), and synthesize via `model.inference`:

```python
import torch, glob, os, string, soundfile as sf, transformers.pytorch_utils as _ptu
if not hasattr(_ptu, "isin_mps_friendly"):
    _ptu.isin_mps_friendly = lambda e, t: torch.isin(e, t)
from TTS.tts.configs.vits_config import VitsConfig
from TTS.tts.models.vits import Vits

mp = max(glob.glob("/workspace/vits_khm/**/best_model.pth", recursive=True), key=os.path.getmtime)
cp = os.path.join(os.path.dirname(mp), "config.json")
config = VitsConfig(); config.load_json(cp)
# restore the real training vocab (config.json dropped ASCII) so sizes match
config.characters.characters = "".join(chr(c) for c in range(0x1780, 0x1800)) + string.ascii_letters + string.digits
model = Vits.init_from_config(config)
model.load_checkpoint(config, mp, eval=True, strict=False)
model.eval()

ids = model.tokenizer.text_to_ids("សូមស្វាគមន៍មកកាន់ iAny")
x = torch.tensor(ids).long().unsqueeze(0)
x_len = torch.tensor([x.shape[1]]).long()
with torch.no_grad():
    out = model.inference(x, aux_input={"x_lengths": x_len})
sf.write("out.wav", out["model_outputs"][0, 0].cpu().numpy(), config.audio.sample_rate)
print("wrote out.wav")
```

> **Carry this to iAny/ONNX export:** the real vocab is Khmer + ASCII letters +
> digits (206 tokens), NOT what `config.json` says. Rebuild `config.characters`
> as above before exporting, or the model loads with the wrong tokenizer.

## 7. On-device (phone / Pi) — ONNX export

**Status:** trained voice is on HF (`sengtha/khmer-tts-female-v1`:
`best_model.pth` + `config.json`). ONNX export is **pending** — see blocker.

### ✅ Working export (coqui `export_onnx` hangs — bypass it)
`model.export_onnx()` hangs forever tracing the stochastic duration predictor —
the culprit is **`do_constant_folding=True`** (it runs the stochastic model
repeatedly). Fix: **skip coqui's exporter**, wrap the model, and export with
`do_constant_folding=False`. CPU-friendly (~5 min), verified with an onnxruntime
sanity run → `khmer_tts.onnx` (109 MB) + `tts_meta.json` on HF.

```python
import torch, os, string, json, numpy as np, transformers.pytorch_utils as _ptu
if not hasattr(_ptu, "isin_mps_friendly"):
    _ptu.isin_mps_friendly = lambda e, t: torch.isin(e, t)
from TTS.tts.configs.vits_config import VitsConfig
from TTS.tts.models.vits import Vits
from huggingface_hub import hf_hub_download, HfApi, login
login("hf_xxxx")

REPO = "sengtha/khmer-tts-female-v1"
mp = hf_hub_download(REPO, "best_model.pth"); cp = hf_hub_download(REPO, "config.json")
config = VitsConfig(); config.load_json(cp)
config.characters.characters = "".join(chr(c) for c in range(0x1780,0x1800)) + string.ascii_letters + string.digits
model = Vits.init_from_config(config); model.load_checkpoint(config, mp, eval=True, strict=False); model.eval()

class OnnxVits(torch.nn.Module):
    def __init__(self, m): super().__init__(); self.m = m
    def forward(self, x, x_lengths):
        return self.m.inference(x, aux_input={"x_lengths": x_lengths,
            "d_vectors": None, "speaker_ids": None, "language_ids": None})["model_outputs"]

wrap = OnnxVits(model).eval()
torch.onnx.export(wrap, (torch.randint(1,50,(1,24)), torch.tensor([24])), "khmer_tts.onnx",
    opset_version=13, input_names=["x","x_lengths"], output_names=["y"],
    dynamic_axes={"x":{0:"N",1:"L"}, "x_lengths":{0:"N"}, "y":{0:"N",2:"T"}},
    do_constant_folding=False, dynamo=False)      # <-- the fix

meta = {"vocab": model.tokenizer.characters.vocab, "add_blank": getattr(config,"add_blank",True),
        "sample_rate": config.audio.sample_rate, "pad": config.characters.pad, "bos": config.characters.bos,
        "eos": config.characters.eos, "blank": config.characters.blank, "input_names": ["x","x_lengths"]}
json.dump(meta, open("tts_meta.json","w"), ensure_ascii=False, indent=1)
api = HfApi()
api.upload_file(path_or_fileobj="khmer_tts.onnx", path_in_repo="khmer_tts.onnx", repo_id=REPO)
api.upload_file(path_or_fileobj="tts_meta.json", path_in_repo="tts_meta.json", repo_id=REPO)
```

**Vocab fix reminder:** the saved `config.json` keeps only 144 Khmer tokens; the
model is **206** (Khmer + ASCII + digits) — rebuild `config.characters.characters`
as above before export/inference or the tokenizer is wrong.

### iAny integration (next)
`onnxruntime-react-native` + a JS port of the tokenizer (vocab from `tts_meta.json`,
`add_blank` interleave) → run onnx → float PCM → WAV → play; 🔊 speak button;
English/number → Khmer normalization; serve the onnx through the Cloudflare mirror.

## 8. Continue training (more data + more steps) — resume from HF

> **"When I stop RunPod, everything is deleted — how do I continue?"**
> Nothing you care about lives on the pod. The trained state — `best_model.pth`
> (998 MB, **includes the optimizer + scaler states**, so it resumes exactly
> where it left off) + `config.json` — is already on Hugging Face at
> `sengtha/khmer-tts-female-v1`. **HF is the durable disk; RunPod is just
> disposable compute.** So "continue training" = pull the checkpoint from HF →
> train more → push it back to HF. The pod being wiped is expected and fine.
>
> Why do this at all: v1 was trained on only ~15h of the 221h available and
> stopped at ~95k steps. That's why *some words come out wrong* — it hasn't
> heard enough Khmer yet. The fix is not a setting, it's more data + more steps.

**One fresh pod, top to bottom:**

1. **§1** launch the A100 pod (150 GB disk).
2. **§3a** run the profiler → gives you `shards_of` + `paths` again (the pod is
   empty, so re-map the speaker's shards).
3. **§3b** re-extract, but **raise `TARGET_HOURS = 50`** (was 15). Keep the same
   `CHOSEN_SPK = "f-adt2-0002"`. Then **Restart Kernel** (as the note says).
4. Run the **install cell** below, **restart the kernel**, then run the
   **train cell** — it downloads v1 from HF and resumes. Push with **§5**
   periodically. Aim for ~200k+ total steps.

**Cell A — install (run once, then RESTART THE KERNEL):**

```python
# coqui/librosa churn numpy and can leave a broken ABI ("numpy fails sanity
# checks / No module named 'numpy.rec'"); the image's scipy is built for numpy
# 2.x, so pin numpy+scipy LAST as a matched pair. Installing numpy does NOT fix
# an already-loaded broken numpy in the running kernel — that's why you MUST
# restart the kernel after this cell before Cell B.
import subprocess, sys
subprocess.run([sys.executable,"-m","pip","install","-q","coqui-tts","transformers==4.46.3","huggingface_hub"])
subprocess.run([sys.executable,"-m","pip","install","-q","--force-reinstall","numpy==1.26.4","scipy==1.13.1"])
# --force-reinstall can drop click; spacy/typer need it, and click 8.2 removed
# split_arg_string that spacy imports -> pin 8.1.7.
subprocess.run([sys.executable,"-m","pip","install","-q","click==8.1.7"])
print("installed — now Kernel → Restart Kernel, then run Cell B")
```

> **Now: Kernel → Restart Kernel and Clear Outputs** (the `[1] [2] …` numbers
> must disappear — merely re-running a cell does NOT reload numpy). Then Cell B.

**Cell B — resume training (run after the restart):**

```python
# shim (same as §4) — coqui needs isin_mps_friendly on some transformers builds
import torch, transformers.pytorch_utils as _ptu
if not hasattr(_ptu, "isin_mps_friendly"):
    _ptu.isin_mps_friendly = lambda e, t: torch.isin(e, t)

import glob, string
from huggingface_hub import hf_hub_download, login
from trainer import Trainer, TrainerArgs
from TTS.tts.configs.shared_configs import BaseDatasetConfig, CharactersConfig
from TTS.tts.configs.vits_config import VitsConfig
from TTS.tts.datasets import load_tts_samples
from TTS.tts.models.vits import Vits, VitsAudioConfig
from TTS.tts.utils.text.tokenizer import TTSTokenizer
from TTS.utils.audio import AudioProcessor

login("hf_xxxxxxxx")                         # <-- your HF token
REPO = "sengtha/khmer-tts-female-v1"
# the persistent checkpoint from the last session (survives pod deletion)
restore = hf_hub_download(REPO, "best_model.pth")

OUT = "vits_khm"
dataset = BaseDatasetConfig(formatter="ljspeech", meta_file_train="metadata.csv", path="khm_tts")
audio = VitsAudioConfig(sample_rate=22050, win_length=1024, hop_length=256,
                        num_mels=80, mel_fmin=0, mel_fmax=None)

# IMPORTANT: character set must be IDENTICAL to v1 (Khmer block + ASCII + digits)
# or the embedding table won't match the checkpoint and restore fails.
KH = "".join(chr(c) for c in range(0x1780, 0x1800)) + string.ascii_letters + string.digits
chars = CharactersConfig(
    characters_class="TTS.tts.utils.text.characters.Graphemes",
    characters=KH, punctuations="!,.?:;()\"'«»“”-–—%/​ ",
    pad="_", eos="~", bos="^", blank="@",
)

config = VitsConfig(
    audio=audio, run_name="khm_female_vits_v2",
    batch_size=16, eval_batch_size=8, batch_group_size=5,
    num_loader_workers=8, num_eval_loader_workers=4,
    run_eval=True, test_delay_epochs=-1, epochs=1000,
    text_cleaner="basic_cleaners", use_phonemes=False,
    compute_input_seq_cache=True, print_step=25, print_eval=False,
    mixed_precision=True, output_path=OUT, datasets=[dataset],
    characters=chars, save_step=1000, save_n_checkpoints=2, cudnn_benchmark=True,
    test_sentences=["សួស្តី តើអ្នកសុខសប្បាយជាទេ?", "ថ្ងៃនេះអាកាសធាតុល្អណាស់។"],
)

ap = AudioProcessor.init_from_config(config)
tokenizer, config = TTSTokenizer.init_from_config(config)
train_samples, eval_samples = load_tts_samples(dataset, eval_split=True, eval_split_size=0.01)
model = Vits(config, ap, tokenizer, speaker_manager=None)

# restore_path loads model + optimizer + scaler from the HF checkpoint, then
# keeps training on the (now larger) dataset. Unlike continue_path it doesn't
# need the original run folder — just the .pth file we pulled from HF.
trainer = Trainer(TrainerArgs(restore_path=restore), config, OUT, model=model,
                  train_samples=train_samples, eval_samples=eval_samples)
trainer.fit()
```

**Within the same pod session**, if you stop and re-start the cell, it now finds
a local `checkpoint_*.pth` — switch back to §4's `continue_path` logic to keep the
step counter. `restore_path` is only for the *first* cell after pulling from HF.

- **Push often (§5).** Every hour or so, or before you stop the pod. If the pod
  dies mid-run, you lose only the steps since the last push — the checkpoint on
  HF is always a safe restart point.
- **When it sounds good enough**, re-run **§7** (ONNX export) → it overwrites
  `khmer_tts.onnx` on HF. In the app, hit **↻ Redownload** to pull the new voice.

## Notes / how to get the best voice

- **Listen early.** VITS is intelligible after ~10–20k steps; naturalness keeps
  improving to ~100k+. Push a checkpoint, synthesize `test_sentences`, judge, keep going.
- **Clean > big.** You have far more than needed — drop noisy/clipped clips; a
  clean 20–30h beats a noisy 60h.
- **Column names / sentence_id mapping** — adapt `SPK`/`TEXT` and the wav glob to
  the dataset's real metadata (Cell 1 prints columns).
- **Grapheme, not phonemes** is the key Khmer decision — `use_phonemes=False`
  lets the model learn Khmer pronunciation from audio instead of via weak eSpeak.
- **Resume within a session:** re-run Cell 4; `continue_path` picks up the
  newest local checkpoint. Push to HF (Cell 5) before stopping the pod.
- **Resume in a NEW pod (after RunPod wiped the old one):** see **§8** — pull
  `best_model.pth` from HF and `restore_path` from it. HF is the durable store;
  nothing is lost when the pod is deleted.
- **Untested end-to-end here** (I can't run RunPod from this env) — expect a
  couple of small fixes at first run, like we did on Kaggle. Paste errors and
  I'll fix fast.
