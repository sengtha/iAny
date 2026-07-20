#!/usr/bin/env python3
"""
Evaluate a Khmer Whisper STT model — CER + WER with Khmer-aware normalization.

Works two ways:
  • ONLINE  — pull model + test set from Hugging Face (any fresh RunPod/Colab/Kaggle).
  • OFFLINE — point at a LOCAL model dir + a LOCAL `load_from_disk` dataset (e.g. your
    `/workspace/ds_v2`). No downloads — ideal on a CPU-only pod. Uses the dataset's
    pre-extracted `input_features` when present, so there's no audio decoding either.

See docs/RUNPOD-KHMER-STT.md.

Setup (online / fresh pod):
    apt-get update && apt-get install -y libsndfile1 ffmpeg
    pip install -q -U transformers "datasets<4" jiwer librosa soundfile accelerate

Examples:
    # GPU, HF benchmark + baseline:
    python scripts/eval_stt.py --n 300 --baseline
    # CPU + existing pod, fully offline on your local model + prepared dataset:
    python scripts/eval_stt.py --model /workspace/whisper-base-khmer \
        --dataset /workspace/ds_v2 --split test --n 30
    # HF, your real-world clips:
    python scripts/eval_stt.py --dataset sengtha/iany-khmer-voice --config "" --split train

Why two CER numbers: Khmer has no spaces between words, but Whisper inserts them,
which inflates raw CER. `CER(no-space)` strips spaces + zero-width chars and is the
honest figure. WER is near-useless for Khmer (word segmentation is ambiguous) — kept
only as a rough signal. On CPU, keep --n small (20–40): whisper-base is slow there.
"""
import argparse
import os
import re

import torch
import jiwer
from datasets import load_dataset, load_from_disk, Audio, DatasetDict
from transformers import WhisperProcessor, WhisperForConditionalGeneration

REF_CANDIDATES = ["transcription", "sentence", "transcript", "text", "raw_transcription"]
_ZW = re.compile(r"[​‌‍﻿]")  # zero-width space/joiner/BOM
_WS = re.compile(r"\s+")


def norm(s: str) -> str:
    """Khmer-aware: drop zero-width junk + all spaces (Khmer has no word spaces)."""
    return _WS.sub("", _ZW.sub("", s or "")).strip()


def load_split(args):
    """Return a Dataset from a local `load_from_disk` dir or an HF dataset id."""
    if os.path.isdir(args.dataset):
        ds = load_from_disk(args.dataset)
        if isinstance(ds, DatasetDict):
            key = args.split if args.split in ds else ("test" if "test" in ds else list(ds)[-1])
            print(f"local dataset splits {list(ds)} → using '{key}'")
            ds = ds[key]
        else:
            print("⚠ single local split — if this is the TRAIN set, CER will look too good")
    else:
        ds = load_dataset(args.dataset, args.config or None, split=args.split, trust_remote_code=True)
    return ds.select(range(min(args.n, ds.num_rows)))


def references(ds, proc, ref_col):
    """Ground-truth strings: from a text column, or by decoding `labels`."""
    if ref_col and ref_col in ds.column_names:
        return list(ds[ref_col])
    if "labels" in ds.column_names:
        out = []
        for lab in ds["labels"]:
            ids = [t for t in lab if t != -100]
            out.append(proc.tokenizer.decode(ids, skip_special_tokens=True))
        return out
    for c in REF_CANDIDATES:
        if c in ds.column_names:
            return list(ds[c])
    raise SystemExit(f"No transcript column or labels found in {ds.column_names}. Pass --ref-col.")


def features(chunk, proc, dev, dtype):
    """A batch of Whisper input_features — reuse pre-extracted ones, else from audio."""
    if "input_features" in chunk:
        return torch.tensor(chunk["input_features"]).to(dev, dtype)
    arrays = [a["array"] for a in chunk["audio"]]
    return proc(arrays, sampling_rate=16000, return_tensors="pt").input_features.to(dev, dtype)


def transcribe(model, proc, ds, batch, dev, dtype):
    hyps = []
    for i in range(0, len(ds), batch):
        feats = features(ds[i : i + batch], proc, dev, dtype)
        with torch.no_grad():
            ids = model.generate(feats, max_new_tokens=225)
        hyps += proc.batch_decode(ids, skip_special_tokens=True)
        print(f"  {len(hyps)}/{len(ds)}", end="\r", flush=True)
    print()
    return hyps


def _metric(fn, rs, hs):
    """jiwer CER/WER, skipping pairs with an empty reference (jiwer errors on those)."""
    pairs = [(a, b) for a, b in zip(rs, hs) if a and a.strip()]
    return 100 * fn([a for a, _ in pairs], [b for _, b in pairs]) if pairs else float("nan")


def report(tag, refs, hyps):
    craw = _metric(jiwer.cer, refs, hyps)
    cnrm = _metric(jiwer.cer, [norm(x) for x in refs], [norm(x) for x in hyps])
    wraw = _metric(jiwer.wer, refs, hyps)
    print(f"\n[{tag}]  N={len(refs)}   CER(raw)={craw:.1f}   CER(no-space)={cnrm:.1f}   WER={wraw:.1f}")


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
    ap.add_argument("--dataset", default="google/fleurs", help="HF id or a local load_from_disk dir")
    ap.add_argument("--config", default="km_kh", help='dataset config; "" for none')
    ap.add_argument("--split", default="test")
    ap.add_argument("--ref-col", default=None, help="transcript column (auto-detect if omitted)")
    ap.add_argument("--n", type=int, default=300)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--examples", type=int, default=15)
    ap.add_argument("--baseline", action="store_true", help="also score openai/whisper-base")
    args = ap.parse_args()

    dev = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"device={dev}  model={args.model}  data={args.dataset} {args.config or ''} [{args.split}]")
    if dev == "cpu" and args.n > 60:
        print(f"⚠ CPU + n={args.n}: this will be slow. Consider --n 30.")

    ds = load_split(args)
    if "input_features" not in ds.column_names and "audio" in ds.column_names:
        ds = ds.cast_column("audio", Audio(sampling_rate=16000))

    proc, model, dtype = load_model(args.model, dev)

    refs = references(ds, proc, args.ref_col)
    hyps = transcribe(model, proc, ds, args.batch, dev, dtype)
    report(args.model, refs, hyps)

    print("\n--- examples (✓ = exact after space-normalization) ---")
    for r, h in list(zip(refs, hyps))[: args.examples]:
        print(("✓" if norm(r) == norm(h) else "·"), "REF:", r)
        print("   HYP:", h, "\n")

    if args.baseline:
        print("\nScoring stock openai/whisper-base (zero-shot)…")
        bproc, bmodel, bdtype = load_model("openai/whisper-base", dev)
        bhyps = transcribe(bmodel, bproc, ds, args.batch, dev, bdtype)
        report("openai/whisper-base", references(ds, bproc, args.ref_col), bhyps)


if __name__ == "__main__":
    main()
