# ==========================================================================
# Khmer STT comparison — whisper tiny vs small (faster-whisper, CPU int8)
#
# Synthesizes known Khmer with the iAny TTS, transcribes with each model, and
# prints CER (accuracy) + RTF (CPU speed) so you can pick the phone model.
# Run in Google Colab or Kaggle. Paste the whole thing into one cell.
# ==========================================================================
import subprocess, sys
subprocess.run([sys.executable, "-m", "pip", "-q", "install",
                "faster-whisper", "onnxruntime", "huggingface_hub",
                "jiwer", "librosa", "numpy"], check=True)

import json, time, numpy as np, librosa
import onnxruntime as ort
from huggingface_hub import hf_hub_download
from faster_whisper import WhisperModel
from jiwer import cer

# ---- models to compare + decode setting ---------------------------------
MODELS = [
    ("tiny ", "PhanithLIM/whisper-tiny-khmer-ct2"),
    ("small", "PhanithLIM/whisper-small-khmer-ct2"),
]
BEAM = 1   # greedy = edge-realistic + fastest. Raise to 5 for a bit more accuracy.
# -------------------------------------------------------------------------

# iAny Khmer TTS — makes known-ground-truth audio.
TTS = "sengtha/khmer-tts-female-v2"
meta = json.load(open(hf_hub_download(TTS, "tts_meta.json"), encoding="utf-8"))
tts = ort.InferenceSession(hf_hub_download(TTS, "khmer_tts_v3.onnx"))
id_of = {c: i for i, c in enumerate(meta["vocab"])}
blank = id_of[meta["blank"]]

def synth16k(text):
    ids = [id_of[c] for c in text if c in id_of]
    if meta.get("add_blank"):
        seq = [blank]
        for i in ids:
            seq += [i, blank]
        ids = seq
    x = np.array([ids], dtype=np.int64)
    xl = np.array([len(ids)], dtype=np.int64)
    y = np.asarray(tts.run(None, {"x": x, "x_lengths": xl})[0]).squeeze().astype(np.float32)
    return librosa.resample(y, orig_sr=meta["sample_rate"], target_sr=16000)

TESTS = [
    "សួស្ដី តើអ្នកសុខសប្បាយជាទេ",
    "ការអប់រំ និងសុខភាព គឺជាមូលដ្ឋានសំខាន់",
    "ព័ត៌មានពីស្រុកខ្មែរ ថ្ងៃនេះមេឃស្រឡះល្អ",
    "អង្គរវត្ត ស្ថិតនៅខេត្តសៀមរាប ប្រទេសកម្ពុជា",
    "ខ្ញុំចង់រៀនភាសាខ្មែរឲ្យបានល្អ",
]

# Synthesize each sentence once (same audio for every model = fair comparison).
CLIPS = [(ref, synth16k(ref)) for ref in TESTS]

summary = []
for label, repo in MODELS:
    print(f"\n########## {label.strip()}  ({repo})")
    stt = WhisperModel(repo, device="cpu", compute_type="int8")
    # warm-up — MUST consume the generator (that's where the work happens)
    list(stt.transcribe(CLIPS[0][1], language="km", beam_size=BEAM)[0])
    cers, t_total, dur_total = [], 0.0, 0.0
    for ref, a16 in CLIPS:
        t0 = time.time()
        segs, _ = stt.transcribe(a16, language="km", beam_size=BEAM)
        hyp = "".join(s.text for s in segs).strip()  # consume generator INSIDE the timer
        t_total += time.time() - t0
        c = cer(ref.replace(" ", ""), hyp.replace(" ", ""))
        cers.append(c); dur_total += len(a16) / 16000
        print(f"  CER {c:5.1%}  REF {ref}")
        print(f"            HYP {hyp}")
    summary.append((label, float(np.mean(cers)), t_total / dur_total, t_total, dur_total))

print("\n==================== COMPARISON ====================")
print(f"{'model':7} {'mean CER':>9} {'RTF (CPU)':>10}   (beam=%d)" % BEAM)
for label, mc, rtf, tt, dd in summary:
    print(f"{label:7} {mc:>8.1%} {rtf:>10.3f}   ({tt:.2f}s to transcribe {dd:.1f}s audio)")
print("\nCER  : lower = more accurate (on CLEAN synthetic speech — real audio is harder)")
print("RTF  : <1.0 = faster than real-time on THIS CPU. Your 2019 S10 is ~3-5x slower,")
print("       so multiply RTF by ~3-5 to estimate on-phone speed.")
print("Tip  : test real audio -> a16 = librosa.load('clip.wav', sr=16000)[0]")
