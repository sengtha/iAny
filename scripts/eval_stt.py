#!/usr/bin/env python3
"""
Evaluate a Khmer Whisper STT model — CER + WER with Khmer-aware normalization.

Self-contained: pulls the model + test set from Hugging Face, so it runs on any
fresh GPU box (RunPod, Colab, Kaggle) with no local files. See docs/RUNPOD-KHMER-STT.md.

Setup on a fresh pod:
    apt-get update && apt-get install -y libsndfile1 ffmpeg
    pip install -q -U transformers "datasets<4" evaluate jiwer librosa soundfile accelerate

Run (defaults = your model on the FLEURS Khmer benchmark):
    python scripts/eval_stt.py
    python scripts/eval_stt.py --n 500 --batch 32
    python scripts/eval_stt.py --baseline                 # also score stock whisper-base
    # your own real-world clips instead of FLEURS:
    python scripts/eval_stt.py --dataset sengtha/iany-khmer-voice --config "" --split train

Why two CER numbers: Khmer has no spaces between words, but Whisper inserts them,
which inflates raw CER. `CER(no-space)` strips spaces + zero-width chars and is the
honest figure. WER is near-useless for Khmer (word segmentation is ambiguous) — kept
only as a rough signal.
"""
import argparse
import re

import torch
import evaluate
from datasets import load_dataset, Audio
from transformers import WhisperProcessor, WhisperForConditionalGeneration

REF_CANDIDATES = ["transcription", "sentence", "transcript", "text", "raw_transcription"]
_ZW = re.compile(r"[​‌‍﻿]")  # zero-width space/joiner/BOM
_WS = re.compile(r"\s+")


def norm(s: str) -> str:
    """Khmer-aware: drop zero-width junk + all spaces (Khmer has no word spaces)."""
    return _WS.sub("", _ZW.sub("", s or "")).strip()


def pick_ref_col(cols):
    for c in REF_CANDIDATES:
        if c in cols:
            return c
    raise SystemExit(f"No transcript column found in {cols}. Pass --ref-col.")


def transcribe(model, proc, ds, ref_col, batch, dev, dtype):
    refs, hyps = [], []
    for i in range(0, len(ds), batch):
        chunk = ds[i : i + batch]
        arrays = [a["array"] for a in chunk["audio"]]
        feats = proc(arrays, sampling_rate=16000, return_tensors="pt").input_features.to(dev, dtype)
        with torch.no_grad():
            ids = model.generate(feats, max_new_tokens=225)
        hyps += proc.batch_decode(ids, skip_special_tokens=True)
        refs += chunk[ref_col]
        print(f"  {len(refs)}/{len(ds)}", end="\r", flush=True)
    print()
    return refs, hyps


def score(tag, refs, hyps, cer_m, wer_m):
    craw = 100 * cer_m.compute(predictions=hyps, references=refs)
    cnrm = 100 * cer_m.compute(
        predictions=[norm(x) for x in hyps], references=[norm(x) for x in refs]
    )
    wraw = 100 * wer_m.compute(predictions=hyps, references=refs)
    print(f"\n[{tag}]  N={len(refs)}   CER(raw)={craw:.1f}   CER(no-space)={cnrm:.1f}   WER={wraw:.1f}")
    return cnrm


def load_model(name, dev):
    dtype = torch.float16 if dev == "cuda" else torch.float32
    proc = WhisperProcessor.from_pretrained(name)
    model = WhisperForConditionalGeneration.from_pretrained(name, torch_dtype=dtype).to(dev).eval()
    model.generation_config.language = "km"
    model.generation_config.task = "transcribe"
    return proc, model, dtype


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="sengtha/whisper-base-khmer")
    ap.add_argument("--dataset", default="google/fleurs")
    ap.add_argument("--config", default="km_kh", help='dataset config; "" for none')
    ap.add_argument("--split", default="test")
    ap.add_argument("--ref-col", default=None, help="transcript column (auto-detect if omitted)")
    ap.add_argument("--n", type=int, default=300, help="samples to eval")
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--examples", type=int, default=15)
    ap.add_argument("--baseline", action="store_true", help="also score openai/whisper-base")
    args = ap.parse_args()

    dev = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"device={dev}  model={args.model}  data={args.dataset} {args.config or ''} [{args.split}]")

    ds = load_dataset(
        args.dataset, args.config or None, split=args.split, trust_remote_code=True
    )
    ds = ds.cast_column("audio", Audio(sampling_rate=16000))
    ds = ds.select(range(min(args.n, ds.num_rows)))
    ref_col = args.ref_col or pick_ref_col(ds.column_names)
    print(f"reference column: {ref_col}")

    cer_m, wer_m = evaluate.load("cer"), evaluate.load("wer")

    proc, model, dtype = load_model(args.model, dev)
    refs, hyps = transcribe(model, proc, ds, ref_col, args.batch, dev, dtype)
    score(args.model, refs, hyps, cer_m, wer_m)

    print("\n--- examples (✓ = exact match after space-normalization) ---")
    for r, h in list(zip(refs, hyps))[: args.examples]:
        print(("✓" if norm(r) == norm(h) else "·"), "REF:", r)
        print("   HYP:", h, "\n")

    if args.baseline:
        print("\nScoring stock openai/whisper-base (zero-shot) for comparison…")
        bproc, bmodel, bdtype = load_model("openai/whisper-base", dev)
        brefs, bhyps = transcribe(bmodel, bproc, ds, ref_col, args.batch, dev, bdtype)
        score("openai/whisper-base", brefs, bhyps, cer_m, wer_m)


if __name__ == "__main__":
    main()
