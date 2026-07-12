# Fine-tune Qwen3-0.6B to be *smart* in Khmer (S10 model) — Kaggle batch

The S10's ceiling is ~0.6B, so we make the 0.6B *better* by training it on Khmer.
Start from the already-trimmed Khmer Qwen3 (`alphaedge-ai/Qwen3-0.6B-khm-32768`):
it keeps the 32k vocab that fits the S10 and is already Khmer-adapted, so we're
*strengthening* it, not starting cold.

**Two stages, because "smart in Khmer" needs both:**

- **Stage A — Continued pre-training (CPT):** feed it *raw* Khmer text (plain
  paragraphs, no Q/A). This is where the model actually **learns Khmer** —
  vocabulary, grammar, facts. This was missing from the SFT-only version, and
  it's the stage that makes it *smart* rather than just polite.
- **Stage B — SFT:** your `{context, question, answer}` rows, so it learns to
  *use* that Khmer knowledge in iAny's exact answer format.

SFT alone = shallow. CPT + SFT = actually knows things in Khmer.

This runs as **one Kaggle batch job** (Save & Run All → background, up to 12h):
CPT → SFT → merge → convert to GGUF → upload. No interactive prompts (batch
can't answer them), so the HF token comes from **Kaggle Secrets**.

## Setup (once, before running)

1. New Kaggle notebook.
2. **Settings:** Accelerator = **GPU T4 ×2** is fine (we pin to one GPU),
   **Internet = On** (pulls base model + Khmer Wikipedia, pushes to HF).
3. **Add-ons → Secrets →** add secret **`HF_TOKEN`** = your HF **Write** token.
4. *(Recommended)* **Add Data →** attach more Khmer text to make it smarter:
   - **ParaCrawl English-Khmer** (paracrawl.eu → English-Khmer v2 → **DEDUP**):
     1.5M EN↔KM sentence pairs. Download it, upload as a Kaggle dataset. The
     notebook reads the tab-separated file and keeps the Khmer column.
   - Your own Khmer `.txt`, and/or your `{context, question, answer}` `.json`.

   All auto-detected under `/kaggle/input/` — no paths to edit.
5. Paste the cell below, then **Save Version → "Save & Run All (Commit)"**. It
   runs in the background; check back in an hour or two.

## Run it now (checklist)

You've uploaded ParaCrawl DEDUP — here's the exact order:

1. **Paste the full cell** (below) into the notebook, replacing any old version.
   The current cell reads CC-100 **and** your attached ParaCrawl file.
2. **Settings (right panel):** Accelerator = **GPU T4 ×2**, **Internet = On**.
3. **Add-ons → Secrets:** `HF_TOKEN` = your HF **Write** token (checkbox ON).
4. Confirm your ParaCrawl dataset shows under **Input** (right panel).
5. **Save Version → "Save & Run All (Commit)"** → it runs in the background.
6. **Sanity-check the first minute of logs:** you want to see
   `ALL input files: [...paracrawl...]`, a `+N Khmer lines` line for it, and a
   big `CPT blocks total:` (well over 1,000,000). If it's only ~300k, the
   ParaCrawl file wasn't picked up — paste me the `ALL input files:` line.
7. Close the tab. Check back in **~5 hours** (CPT is capped at `max_steps=5000`
   so it always finishes and uploads inside Kaggle's 12h limit).
   When done it prints `DONE -> sengtha/Qwen3-0.6B-khm-ft-Q8_0-GGUF`.
8. Send me **"done"** → I wire it into iAny → you rebuild the APK on your phone.

If step 6 shows the total is huge and CPT is crawling, it's fine to
**Cancel**, add `texts = texts[:800_000]` after the print, and re-run — that
caps it to a ~2–3h job without losing much quality.

## What the notebook trains on

- **CPT corpus (Stage A):** **FineWeb-2 Khmer** (`HuggingFaceFW/fineweb-2`,
  config `khm_Khmr` — parquet, ungated, streamed + capped at 300k docs) —
  **plus** any Khmer text you attach (ParaCrawl, your own text). More raw Khmer
  = smarter. If FineWeb-2 fails to load, it auto-falls back to Khmer Wikipedia so
  the run never dies here. (CC-100 no longer loads — newest `datasets` dropped
  script-based datasets.)
- **SFT rows (Stage B):** your `{context, question, answer}` JSON. A few hundred
  good rows is plenty. If you attach none, Stage B is skipped and you still get
  the CPT-improved model.

Wikipedia alone is small (~10k articles, many stubs) and uneven — that's why the
default is CC-100, with ParaCrawl as the recommended add-on.

## The notebook (one batch cell)

```python
import os
os.environ["CUDA_VISIBLE_DEVICES"] = "0"          # T4 x2 device-split crashes training
from kaggle_secrets import UserSecretsClient
HF_TOKEN = UserSecretsClient().get_secret("HF_TOKEN")

import subprocess, sys
subprocess.run([sys.executable,"-m","pip","install","-q",
                "transformers>=4.51","trl>=0.12","peft","datasets","accelerate"])
# Kaggle ships torchao 0.10, which the latest peft rejects (wants >=0.16). We
# don't use torchao for fp16 LoRA, so remove it -> peft skips the torchao path.
subprocess.run([sys.executable,"-m","pip","uninstall","-y","torchao"])

import json, glob, re, gzip, torch, pathlib
from datasets import Dataset, load_dataset
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import LoraConfig, get_peft_model
from trl import SFTTrainer, SFTConfig
from huggingface_hub import login, HfApi
login(HF_TOKEN)

BASE = "alphaedge-ai/Qwen3-0.6B-khm-32768"
OUT_REPO = "sengtha/Qwen3-0.6B-khm-ft-Q8_0-GGUF"

tok = AutoTokenizer.from_pretrained(BASE)
if tok.pad_token is None: tok.pad_token = tok.eos_token
model = AutoModelForCausalLM.from_pretrained(BASE, torch_dtype=torch.float16, device_map={"": 0})

# One LoRA adapter, trained through BOTH stages (kept resident between them).
peft_cfg = LoraConfig(r=16, lora_alpha=32, lora_dropout=0.05, task_type="CAUSAL_LM",
    target_modules=["q_proj","k_proj","v_proj","o_proj","gate_proj","up_proj","down_proj"])
model = get_peft_model(model, peft_cfg)

# ---------- Stage A: continued pre-training on raw Khmer ----------
# Source 1: FineWeb-2 Khmer (parquet, ungated) — big + cleaner than Wikipedia.
# (CC-100 no longer loads: newest `datasets` dropped script-based datasets.)
# Streamed + capped.
texts, CAP = [], 300_000
try:
    fw = load_dataset("HuggingFaceFW/fineweb-2", "khm_Khmr",
                      split="train", streaming=True)
    for ex in fw:
        t = (ex.get("text") or "").strip()
        if t: texts.append(t)
        if len(texts) >= CAP: break
    print(f"FineWeb-2 Khmer: {len(texts)} docs")
except Exception as e:
    print("fineweb-2 skipped -> wikipedia fallback:", e)
    wiki = load_dataset("wikimedia/wikipedia", "20231101.km", split="train")
    texts += [t for t in wiki["text"] if t and t.strip()]

# Source 2: anything you attached, ANY extension. Detects gzip by magic bytes,
# splits each line on tabs, keeps whichever column is Khmer — so ParaCrawl
# EN<TAB>KM bitext AND plain Khmer text both work regardless of filename.
KH = re.compile(r'[ក-៿]')          # Khmer Unicode block
def read_lines(p):
    with open(p, "rb") as fh:
        gz = fh.read(2) == b"\x1f\x8b"
    op = gzip.open if gz else open
    with op(p, "rt", encoding="utf-8", errors="ignore") as fh:
        return fh.read().splitlines()

# list EVERY input file (except the SFT json) so the log shows what's really there
inputs = [f for f in glob.glob("/kaggle/input/**/*", recursive=True)
          if pathlib.Path(f).is_file() and not f.lower().endswith(".json")]
print("ALL input files:", inputs)
for f in inputs:
    try:
        n0 = len(texts)
        for line in read_lines(f):
            km = next((p.strip() for p in line.split("\t") if KH.search(p)), None)
            if km: texts.append(km)
        print(f"  {f}: +{len(texts)-n0} Khmer lines")
    except Exception as e:
        print(f"  {f}: skipped ({e})")
print(f"CPT blocks total: {len(texts)}")
# Optional: cap total to keep CPT within a few hours -> texts = texts[:800_000]

cpt_ds = Dataset.from_dict({"text": texts})
# max_steps caps CPT so it ALWAYS finishes + uploads inside Kaggle's 12h limit
# (the run only saves at the very end, so a timeout would lose everything).
# 5000 steps x 16 x 1024 ~= 80M tokens -> plenty for a 0.6B to learn Khmer,
# ~5h on T4. Raise it if you have headroom; lower to 3000 for a ~3h run.
cpt_args = SFTConfig(output_dir="cpt", max_steps=5000,
    per_device_train_batch_size=2, gradient_accumulation_steps=8,
    learning_rate=2e-4, fp16=True, gradient_checkpointing=True,
    max_length=1024, packing=True, logging_steps=20, save_strategy="no", report_to="none")
SFTTrainer(model=model, args=cpt_args, train_dataset=cpt_ds,
           processing_class=tok).train()

# ---------- Stage B: SFT on your Q&A (iAny's exact prompt) ----------
qa_files = glob.glob("/kaggle/input/**/*.json", recursive=True)
if qa_files:
    raw = json.load(open(qa_files[0]))
    def to_chat(ex):
        user = ("Answer the question using only the context below, from the user's notes.\n"
                "Be brief. Answer in Khmer (ភាសាខ្មែរ).\n\n"
                f"Context:\n{ex['context']}\n\nQuestion: {ex['question']}\n/no_think")
        return {"messages": [{"role": "user", "content": user},
                             {"role": "assistant", "content": ex["answer"]}]}
    sft_ds = Dataset.from_list([to_chat(e) for e in raw])
    sft_args = SFTConfig(output_dir="sft", num_train_epochs=3,
        per_device_train_batch_size=2, gradient_accumulation_steps=8,
        learning_rate=2e-4, fp16=True, gradient_checkpointing=True,
        max_length=1024, logging_steps=10, save_strategy="no", report_to="none")
    SFTTrainer(model=model, args=sft_args, train_dataset=sft_ds,
               processing_class=tok).train()
    print(f"SFT on {len(sft_ds)} rows")
else:
    print("no Q&A json attached -> skipping SFT (CPT-only model)")

merged = model.merge_and_unload()
merged.save_pretrained("khm-ft"); tok.save_pretrained("khm-ft")

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

# ---------- upload the GGUF (token from secrets, no prompt) ----------
api = HfApi(token=HF_TOKEN)
api.create_repo(OUT_REPO, exist_ok=True)
api.upload_file(path_or_fileobj="model.gguf",
                path_in_repo="Qwen3-0.6B-khm-ft-Q8_0.gguf", repo_id=OUT_REPO)
print("DONE ->", OUT_REPO)
```

## After it finishes

The batch run uploads `sengtha/Qwen3-0.6B-khm-ft-Q8_0-GGUF` at the end (it
survives the session wipe because it's on HF). Send me that repo name → I point
iAny at it → rebuild → your smarter Khmer model on the S10.

## How to make it smarter (the levers, in order)

1. **More raw Khmer for CPT.** #1 factor. Default is CC-100; add **ParaCrawl
   DEDUP** (1.5M EN↔KM pairs, Khmer side extracted) and your own `.txt`. Raise
   `CAP` (or remove it) for more CC-100. 100MB+ total is where real fluency
   shows up.
2. **More epochs on a big corpus** beats many epochs on a tiny one. If CPT data
   is large, 1 epoch is fine; if small, bump to 2–3.
3. **More/better Q&A rows** for SFT — improves *answer style*, not knowledge.

### Corpus options (from the awesome-khmer-language list)

- **FineWeb-2 `khm_Khmr`** — the default. Parquet, ungated, streams cleanly;
  large + well-filtered. (Replaced CC-100, which no longer loads on modern
  `datasets`.)
- **ParaCrawl EN-Khmer DEDUP** — 1.5M clean-ish pairs; Khmer side → CPT, and the
  pairs can later teach EN↔KM translation. Web-mined, so use the DEDUP version.
- **OSCAR-2301 `km`** — even bigger; **gated** (accept terms once, then your HF
  token works). Best upgrade for maximum data. Same `load_dataset` shape.
- **seanghay's HF datasets** — curated Khmer; browse `huggingface.co/seanghay`
  and attach any as text.

## Notes / lessons baked in

- **CPT before SFT** — teaches Khmer knowledge first, answer format second.
- **One LoRA through both stages** — `get_peft_model` once, kept resident, so
  Stage B builds on Stage A instead of resetting.
- **`packing=True` for CPT** — packs raw text into full 1024-token windows
  (efficient for plain-text pretraining).
- **T4 has no bf16** → fp16.
- **CUDA_VISIBLE_DEVICES=0** → avoids the T4×2 device-split crash.
- **Token via Kaggle Secrets** → batch can't answer a getpass prompt.
- **CC-100 needs `trust_remote_code=True`** — it uses a loader script that newer
  `datasets` refuses otherwise; streaming + `CAP` keeps runtime sane.
- **Khmer-column extraction** — the attach loop splits each line on tabs and
  keeps the Khmer field, so ParaCrawl bitext (`EN<TAB>KM`) and plain Khmer
  `.txt` both work with one loop.
- **Auto-detects your attached data** — `.txt`/`.tsv` → CPT corpus, `.json` →
  SFT rows. Attach nothing and it still trains on CC-100 (Wikipedia fallback).
  Same corpus later feeds bigger fine-tunes for the Pi/PWA tiers.
