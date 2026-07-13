# Best S10 Qwen 0.6B — full CPT + SFT on RunPod (A100)

The Kaggle version was cramped (LoRA, fp16, capped 20M-token CPT). On an A100 we
do it right: **full-parameter fine-tuning**, **bf16**, and a **long, uncapped
CPT** — which is what actually makes the 0.6B fluent in Khmer. Still the same
32k-vocab base so it stays S10-compatible.

## 1. Launch the pod

1. **runpod.io → Deploy → Pods.**
2. GPU: **A100 80GB** (or 40GB is fine for a 0.6B). Use **Community Cloud** for
   cheaper rates.
3. Template: **RunPod PyTorch 2.x** (has CUDA + Jupyter).
4. **Set an environment variable** on the pod: `HF_TOKEN` = your HF **Write**
   token. (Deploy → Edit Template → Environment Variables.)
5. Deploy → **Connect → Jupyter Lab** → new notebook.
6. **Stop the pod the moment it finishes** — billing runs while the pod exists.

Expected: ~2–4h on A100 ≈ **$3–8**.

## 2. The notebook (one cell)

```python
import os, subprocess, sys, glob, re, json, pathlib, torch
HF_TOKEN = os.environ["HF_TOKEN"]                 # set on the pod (step 4)

subprocess.run([sys.executable,"-m","pip","install","-q",
    "transformers>=4.51","trl>=0.12","datasets","accelerate","sentencepiece"])

from datasets import Dataset, load_dataset
from transformers import AutoModelForCausalLM, AutoTokenizer
from trl import SFTTrainer, SFTConfig
from huggingface_hub import login, HfApi
login(HF_TOKEN)

BASE     = "alphaedge-ai/Qwen3-0.6B-khm-32768"
OUT_REPO = "sengtha/Qwen3-0.6B-khm-ft-Q8_0-GGUF"

tok = AutoTokenizer.from_pretrained(BASE)
if tok.pad_token is None: tok.pad_token = tok.eos_token
# bf16 full-precision load; FULL fine-tuning (no LoRA) — best for learning Khmer.
# attn_implementation="sdpa" is a big speedup over eager attention.
model = AutoModelForCausalLM.from_pretrained(BASE, torch_dtype=torch.bfloat16,
    attn_implementation="sdpa", device_map={"": 0})

# ---------- Stage A: FULL continued pre-training on raw Khmer ----------
# FineWeb-2 Khmer (parquet, ungated). A100 has plenty of RAM -> take a lot more
# than the Kaggle run. Raise CAP for even more; this is the fluency lever.
texts, CAP = [], 500_000
fw = load_dataset("HuggingFaceFW/fineweb-2", "khm_Khmr", split="train", streaming=True)
for ex in fw:
    t = (ex.get("text") or "").strip()
    if t: texts.append(t)
    if len(texts) >= CAP: break
print("FineWeb-2 Khmer docs:", len(texts))

# OPTIONAL ParaCrawl: upload your dedup file to an HF dataset repo, then set
# PARA_REPO. Leave as None to train on FineWeb alone (already strong).
PARA_REPO = None            # e.g. "sengtha/khmer-paracrawl"
if PARA_REPO:
    from huggingface_hub import snapshot_download
    d = snapshot_download(PARA_REPO, repo_type="dataset")
    KH = re.compile(r'[ក-៿]')
    for f in glob.glob(d+"/**/*", recursive=True):
        if not pathlib.Path(f).is_file(): continue
        for line in pathlib.Path(f).read_text(errors="ignore").splitlines():
            km = next((p.strip() for p in line.split("\t") if KH.search(p)), None)
            if km: texts.append(km)
    print("with ParaCrawl:", len(texts))

cpt_ds = Dataset.from_dict({"text": texts})
# No gradient_checkpointing: an 80GB A100 doesn't need it for a 0.6B, and it
# recomputes every step (~10x slowdown seen). sdpa attention + fused adamw +
# dataloader workers keep the GPU fed. -> ~1-2 it/s instead of 0.1.
cpt_args = SFTConfig(output_dir="cpt", max_steps=8000,    # ~260M tokens of CPT
    per_device_train_batch_size=16, gradient_accumulation_steps=2,
    learning_rate=1e-4, bf16=True,
    dataloader_num_workers=8, optim="adamw_torch_fused",
    max_length=1024, packing=True, logging_steps=50,
    save_steps=2000, save_total_limit=1, report_to="none")
SFTTrainer(model=model, args=cpt_args, train_dataset=cpt_ds, processing_class=tok).train()

# ---------- Stage B: SFT on your Q&A (upload a json HF dataset, optional) ----------
# Set QA_REPO to an HF dataset of {context,question,answer}; else SFT is skipped.
QA_REPO = None              # e.g. "sengtha/khmer-qa"
if QA_REPO:
    raw = load_dataset(QA_REPO, split="train")
    def to_chat(ex):
        user = ("Answer the question using only the context below, from the user's notes.\n"
                "Be brief. Answer in Khmer (ភាសាខ្មែរ).\n\n"
                f"Context:\n{ex['context']}\n\nQuestion: {ex['question']}\n/no_think")
        return {"messages": [{"role":"user","content":user},
                             {"role":"assistant","content":ex["answer"]}]}
    sft_ds = Dataset.from_list([to_chat(e) for e in raw])
    sft_args = SFTConfig(output_dir="sft", num_train_epochs=3,
        per_device_train_batch_size=8, gradient_accumulation_steps=2,
        learning_rate=5e-5, bf16=True, gradient_checkpointing=True,
        max_length=1024, logging_steps=10, report_to="none")
    SFTTrainer(model=model, args=sft_args, train_dataset=sft_ds, processing_class=tok).train()
    print("SFT rows:", len(sft_ds))
else:
    print("no QA_REPO -> CPT-only model")

model.save_pretrained("khm-ft"); tok.save_pretrained("khm-ft")

# ---------- convert to GGUF (force qwen2 pre-tokenizer for the trimmed vocab) ----------
subprocess.run(["git","clone","--depth","1","https://github.com/ggml-org/llama.cpp"])
subprocess.run([sys.executable,"-m","pip","install","-q","-r","llama.cpp/requirements.txt"])
needle = 'raise NotImplementedError("BPE pre-tokenizer was not recognized - update get_vocab_base_pre()")'
for p in pathlib.Path("llama.cpp").rglob("*.py"):
    s = p.read_text()
    if needle in s: p.write_text(s.replace(needle, 'return "qwen2"'))
subprocess.run([sys.executable,"llama.cpp/convert_hf_to_gguf.py","khm-ft",
                "--outfile","khm-ft-f16.gguf","--outtype","f16"])
subprocess.run("cd llama.cpp && cmake -B build -DLLAMA_CURL=OFF && "
               "cmake --build build --config Release -j --target llama-quantize", shell=True)
subprocess.run(["./llama.cpp/build/bin/llama-quantize","khm-ft-f16.gguf","model.gguf","Q8_0"])

api = HfApi(token=HF_TOKEN)
api.create_repo(OUT_REPO, exist_ok=True)
api.upload_file(path_or_fileobj="model.gguf",
                path_in_repo="Qwen3-0.6B-khm-ft-Q8_0.gguf", repo_id=OUT_REPO)
print("DONE ->", OUT_REPO)
```

## Why this is the "best" version

- **Full fine-tuning (no LoRA)** — LoRA has limited capacity to *learn a
  language*; full-parameter CPT genuinely reshapes the model toward Khmer.
- **bf16** — A100 native, more stable than fp16, no loss scaling issues.
- **~400M-token CPT** (12k steps × ~32k tokens) vs Kaggle's ~20M — this is the
  difference between "reads Khmer" and "fluent Khmer."
- Same 32k-vocab base → the GGUF still loads on the **S10** at ~600 MB / ~26 tok/s.

## Notes

- **Watch RAM once** at the start: 500k FineWeb docs is a few GB — fine on an
  A100 pod (lots of RAM). Raise `CAP` for more; lower if a smaller pod OOMs.
- **ParaCrawl / QA are optional** — upload them to HF dataset repos and set
  `PARA_REPO` / `QA_REPO`. FineWeb-only CPT is already a big upgrade.
- **Stop the pod** after `DONE`. The model is safe on HF.
- Send me **"qwen done"** and I'll point iAny at `OUT_REPO`, rebuild the APK.
