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

## 3. Extract that speaker to an LJSpeech folder (streaming)

Reuses `ds` / `decode` / `AUD` / `SPK` / `TEXT` from §2 (same kernel).

```python
CHOSEN_SPK   = "SPK_HERE"       # <-- from §2
TARGET_HOURS = 15               # plenty for a great VITS voice; raise for more
import pathlib, librosa
out = pathlib.Path("khm_tts"); (out/"wavs").mkdir(parents=True, exist_ok=True)
rows = []; sec = 0.0; i = 0
for ex in ds:                                   # ds is decode=False from §2
    if str(ex[SPK]) != CHOSEN_SPK: continue
    y, sr = decode(ex[AUD])
    if sr != 22050:
        y = librosa.resample(np.asarray(y, dtype="float32"), orig_sr=sr, target_sr=22050)
    name = f"{CHOSEN_SPK}_{i:06d}"; i += 1
    sf.write(out/"wavs"/f"{name}.wav", y, 22050)
    t = str(ex[TEXT]).strip().replace("|", " ").replace("\n", " ")
    rows.append(f"{name}|{t}|{t}")
    sec += len(y)/22050
    if i % 200 == 0: print(f"{i} clips, {sec/3600:.2f}h")
    if sec >= TARGET_HOURS*3600: break
(out/"metadata.csv").write_text("\n".join(rows), encoding="utf-8")
print("DONE:", i, "clips,", round(sec/3600,2), "h ->", out)

# coqui-tts is needed for §4 training
subprocess.run([sys.executable,"-m","pip","install","-q","coqui-tts"])
```

## 4. Train grapheme VITS (one cell — resumable)

```python
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
# Whole Khmer block (consonants, vowels, diacritics, digits, signs) + ZWSP/space.
KH = "".join(chr(c) for c in range(0x1780, 0x1800))
chars = CharactersConfig(
    characters_class="TTS.tts.utils.text.characters.Graphemes",
    characters=KH, punctuations="!,.?:;()\"'៖។៕ៗ​ ",
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

```python
from TTS.api import TTS
tts = TTS(model_path="vits_khm/.../best_model.pth", config_path="vits_khm/.../config.json")
tts.tts_to_file(text="សូមស្វាគមន៍មកកាន់ iAny", file_path="out.wav")
```

## 7. On-device (phone / Pi) — later

Export the VITS to **ONNX** and run with **onnxruntime** or **sherpa-onnx**
(handles the grapheme frontend). Small, CPU-only, fully offline — matches iAny's
tiers, and the same file serves the Raspberry Pi.

## Notes / how to get the best voice

- **Listen early.** VITS is intelligible after ~10–20k steps; naturalness keeps
  improving to ~100k+. Push a checkpoint, synthesize `test_sentences`, judge, keep going.
- **Clean > big.** You have far more than needed — drop noisy/clipped clips; a
  clean 20–30h beats a noisy 60h.
- **Column names / sentence_id mapping** — adapt `SPK`/`TEXT` and the wav glob to
  the dataset's real metadata (Cell 1 prints columns).
- **Grapheme, not phonemes** is the key Khmer decision — `use_phonemes=False`
  lets the model learn Khmer pronunciation from audio instead of via weak eSpeak.
- **Resume:** re-run Cell 4; `continue_path` picks up the newest checkpoint.
  Push to HF (Cell 5) before stopping the pod so nothing is lost.
- **Untested end-to-end here** (I can't run RunPod from this env) — expect a
  couple of small fixes at first run, like we did on Kaggle. Paste errors and
  I'll fix fast.
