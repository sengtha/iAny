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

## 2. Pick the voice (run this first on the pod, then listen)

```python
import subprocess, sys
subprocess.run([sys.executable,"-m","pip","install","-q",
                "huggingface_hub","pandas","librosa","soundfile"])
from huggingface_hub import hf_hub_download, list_repo_files, snapshot_download, login
from IPython.display import Audio, display
import pandas as pd, glob, os

login("hf_xxxxxxxx")                       # <-- your HF Write token
REPO = "DDD-Cambodia/khmer-speech-dataset"

# metadata only (not the 495GB of audio)
meta_dir = snapshot_download(REPO, repo_type="dataset",
    allow_patterns=["*.csv","*.tsv","*.json","*.jsonl"])
meta_files = [f for f in glob.glob(meta_dir+"/**/*", recursive=True) if os.path.isfile(f)]
print("METADATA FILES:", meta_files)
meta = pd.read_csv([f for f in meta_files if f.endswith((".csv",".tsv"))][0])
print("COLUMNS:", meta.columns.tolist()); print(meta.head())

# --- after checking COLUMNS, set the real names, then re-run from here ---
SPK, GENDER = "speaker_id", "gender"       # <-- fix to the real column names
fem = meta[meta[GENDER].astype(str).str.lower().str.startswith("f")]
print("female speakers (clips each):\n", fem.groupby(SPK).size().sort_values(ascending=False))

# play 3 clips per female speaker
allw = [f for f in list_repo_files(REPO, repo_type="dataset") if f.endswith(".wav")]
for spk in fem[SPK].unique():
    picks = [f for f in allw if os.path.basename(f).startswith(f"{spk}_khm_")][:3]
    print(f"\n===== speaker {spk} =====")
    for w in picks:
        display(Audio(hf_hub_download(REPO, w, repo_type="dataset")))
```

Listen, pick the `speaker_id` you like → that's your `CHOSEN_SPK` for §3.

## 3. Prepare the data (one cell)

```python
import os, glob, subprocess, sys, pathlib, pandas as pd
HF_TOKEN = os.environ["HF_TOKEN"]
subprocess.run([sys.executable,"-m","pip","install","-q","coqui-tts","librosa","soundfile","huggingface_hub"])
from huggingface_hub import login, snapshot_download
login(HF_TOKEN)

REPO       = "DDD-Cambodia/khmer-speech-dataset"
CHOSEN_SPK = "SPK_ID_HERE"                 # <-- from Cell 1
SPK, TEXT  = "speaker_id", "text"          # <-- match the dataset's real columns

# download ONLY this speaker's audio + metadata (~1/12 of the corpus, not 495GB)
data_dir = snapshot_download(REPO, repo_type="dataset",
    allow_patterns=[f"{CHOSEN_SPK}_khm_*.wav","*.csv","*.tsv","*.json","*.jsonl"],
    max_workers=8)

# resample to 22.05kHz mono (VITS default) and build LJSpeech-style metadata
import librosa, soundfile as sf
out = pathlib.Path("khm_tts"); (out/"wavs").mkdir(parents=True, exist_ok=True)
meta = pd.read_csv(glob.glob(data_dir+"/**/*.csv", recursive=True)[0])
meta = meta[meta[SPK].astype(str) == str(CHOSEN_SPK)]
rows = []
for _, r in meta.iterrows():
    hits = glob.glob(f"{data_dir}/**/*{r.get('sentence_id','')}*.wav", recursive=True)
    if not hits: continue
    y, _ = librosa.load(hits[0], sr=22050, mono=True)
    name = pathlib.Path(hits[0]).stem
    sf.write(out/"wavs"/f"{name}.wav", y, 22050)
    rows.append(f"{name}|{str(r[TEXT]).strip()}|{str(r[TEXT]).strip()}")
(out/"metadata.csv").write_text("\n".join(rows), encoding="utf-8")
print("clips:", len(rows))
```

## 4. Train grapheme VITS (one cell — resumable)

```python
import torch, glob
from trainer import Trainer, TrainerArgs
from TTS.tts.configs.shared_configs import BaseDatasetConfig, CharactersConfig
from TTS.tts.configs.vits_config import VitsConfig
from TTS.tts.datasets import load_tts_samples
from TTS.tts.models.vits import Vits, VitsAudioConfig
from TTS.tts.utils.text.tokenizer import TTSTokenizer

OUT = "vits_khm"
dataset = BaseDatasetConfig(formatter="ljspeech", meta_file_train="metadata.csv", path="khm_tts")

# Khmer character set — feed graphemes directly, NO phonemes (dodges eSpeak-khm).
KH = "".join(chr(c) for c in range(0x1780, 0x17FF))     # Khmer Unicode block
chars = CharactersConfig(characters=KH, punctuations="।៕។!?,.…៖ ៗ", pad="<PAD>",
                         eos="<EOS>", bos="<BOS>", blank="<BLNK>", characters_class="TTS.tts.utils.text.characters.Graphemes")

config = VitsConfig(
    audio=VitsAudioConfig(sample_rate=22050),
    run_name="khm_female_vits", batch_size=32, eval_batch_size=16,
    num_loader_workers=8, num_eval_loader_workers=4,
    epochs=1000, save_step=2000, save_n_checkpoints=2,
    print_step=50, mixed_precision=True, output_path=OUT,
    datasets=[dataset], use_phonemes=False, characters=chars,
    test_sentences=["សួស្តី តើអ្នកសុខសប្បាយជាទេ?", "ថ្ងៃនេះអាកាសធាតុល្អណាស់។"],
)
ap_samples_train, ap_samples_eval = load_tts_samples(dataset, eval_split=True, eval_split_size=0.01)
tokenizer, config = TTSTokenizer.init_from_config(config)
model = Vits(config, ap=None, tokenizer=tokenizer, speaker_manager=None)

# resume from the newest local checkpoint if a prior session left one
ckpts = sorted(glob.glob(f"{OUT}/**/checkpoint_*.pth", recursive=True))
trainer = Trainer(TrainerArgs(continue_path=str(pathlib.Path(ckpts[-1]).parent) if ckpts else ""),
                  config, OUT, model=model,
                  train_samples=ap_samples_train, eval_samples=ap_samples_eval)
trainer.fit()
```

## 5. Push checkpoints to HF (run periodically / after each session)

```python
from huggingface_hub import HfApi
api = HfApi(token=HF_TOKEN); REPO_OUT = "sengtha/khmer-tts-female-v1"
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
