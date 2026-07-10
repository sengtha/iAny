# Kaggle Walkthrough — Stage 1 (Teach Gemma 270M Khmer)

A copy-paste notebook for the continued-pretraining stage on **free Kaggle
GPU**. Goal of this run: get the base model to *continue Khmer text
sensibly*. Do NOT expect answers yet — that's Stage 2. Start small and
cheap; scale the corpus only after the sanity check passes.

Read `FINETUNE-KHMER.md` for the why; this file is the how.

---

## 0. One-time Kaggle setup

1. Create a **Hugging Face** account → open
   `huggingface.co/google/gemma-3-270m-it` → **accept the license**
   (required, instant). Then Settings → Access Tokens → create a **read**
   token.
2. On Kaggle: **New Notebook**. In the right sidebar:
   - **Settings → Accelerator → `GPU T4 x2`** (or P100). Free.
   - **Settings → Internet → On** (needed to download model + data).
   - **Add-ons → Secrets → add `HF_TOKEN`** = your Hugging Face token.
3. Know the limits: 30 GPU-hrs/week, ~12h max per session, ~9h idle
   timeout. Everything you write to `/kaggle/working` is saved as notebook
   output (persists; ≤20 GB). `/kaggle/temp` is wiped. **Checkpoint to
   `/kaggle/working`.**

---

## Cell 0 — Force a single GPU (run FIRST, before anything else)

Kaggle's "GPU T4 ×2" gives two GPUs, and the trainer tries to split the
270M model across both — which crashes with a `tensors on cuda:1 vs
cuda:0` device error. A 270M model fits on one T4 with room to spare, so
pin it to one card. This must run before `torch` is imported.

```python
import os
os.environ["CUDA_VISIBLE_DEVICES"] = "0"
```

## Cell 1 — Install

```python
!pip install -q -U "transformers>=4.49" "trl>=0.12" datasets accelerate peft sentencepiece
import torch
print("GPU:", torch.cuda.get_device_name(0))
# IMPORTANT: torch.cuda.is_bf16_supported() returns True on the T4, but the
# T4 (Turing) has NO native bf16 — it's emulated and flaky. Force fp16 on
# any non-Ampere card. (A100/H100 = real bf16.)
name = torch.cuda.get_device_name(0)
BF16_OK = ("A100" in name) or ("H100" in name)   # T4/P100 -> False -> fp16
print("use bf16:", BF16_OK)
```

## Cell 2 — Hugging Face login (reads your Kaggle secret)

```python
from kaggle_secrets import UserSecretsClient
from huggingface_hub import login
login(UserSecretsClient().get_secret("HF_TOKEN"))
```

## Cell 3 — Build a small Khmer corpus (start with Wikipedia)

```python
from datasets import load_dataset
import re

KHMER = re.compile(r'[ក-៿]')

def khmer_ratio(s):
    if not s: return 0.0
    k = sum(1 for c in s if KHMER.match(c))
    return k / max(1, len(s))

# Khmer Wikipedia — small, clean, a good first signal (~a few tens of MB).
wiki = load_dataset("wikimedia/wikipedia", "20231101.km", split="train")

def clean(ex):
    t = re.sub(r'\s+', ' ', ex["text"]).strip()
    return {"text": t}

wiki = wiki.map(clean)
wiki = wiki.filter(lambda e: len(e["text"]) > 200 and khmer_ratio(e["text"]) > 0.5)
print("docs:", len(wiki))
print(wiki[0]["text"][:300])
```

> Later, concatenate more sources (CulturaX `km`, the Royal Academy
> dictionary `seanghay/khmer-dictionary-44k`, ~15% English to avoid
> forgetting) into the same `text` column and re-run. Corpus quality is
> the #1 lever — but get one clean pass working first.

## Cell 4 — Load the base model

```python
from transformers import AutoModelForCausalLM, AutoTokenizer
import torch

BASE = "google/gemma-3-270m-it"
tok = AutoTokenizer.from_pretrained(BASE)
model = AutoModelForCausalLM.from_pretrained(
    BASE,
    # Load weights in fp32 for a full fine-tune. Loading fp16 weights
    # crashes training with "Attempting to unscale FP16 gradients" — the
    # trainer's mixed precision (fp16=True) needs an fp32 master copy.
    dtype=torch.bfloat16 if BF16_OK else torch.float32,
)
print("params (M):", sum(p.numel() for p in model.parameters()) / 1e6)
```

## Cell 5 — Train (continued pretraining)

```python
from trl import SFTTrainer, SFTConfig

cfg = SFTConfig(
    output_dir="/kaggle/working/ckpt-cpt",
    per_device_train_batch_size=4,      # raise if VRAM allows
    gradient_accumulation_steps=8,
    learning_rate=1e-4,
    lr_scheduler_type="cosine",
    warmup_ratio=0.05,                  # protect the huge embedding matrix
    num_train_epochs=1,
    bf16=BF16_OK, fp16=not BF16_OK,     # <-- KEY: fp16 on free Kaggle
    logging_steps=25,
    save_steps=500,
    save_total_limit=2,
    max_length=1024,                    # 1024 trains fast; raise later
    dataset_text_field="text",
    report_to="none",
)

trainer = SFTTrainer(model=model, train_dataset=wiki, args=cfg)
trainer.train()
trainer.save_model("/kaggle/working/gemma-270m-km-base")
tok.save_pretrained("/kaggle/working/gemma-270m-km-base")
```

> If you hit CUDA out-of-memory: drop `per_device_train_batch_size` to 2
> (raise `gradient_accumulation_steps` to 16), or `max_length` to 768.

## Cell 6 — Save to Hugging Face FIRST (before anything can wipe it)

`/kaggle/working` does NOT reliably survive a session reset — a timeout or
disconnect wipes it, and the trained weights are gone. So the moment
training finishes, push the in-memory model to your HF account. This
needs a **classic Write token** (Read tokens 403; fine-grained tokens
often lack create-repo). `getpass` avoids Kaggle's secret cache:

```python
from getpass import getpass
from huggingface_hub import login, whoami
login(getpass("Paste your WRITE token: "))
print(whoami()["name"])        # confirm it's you

model.push_to_hub("gemma-270m-km-base-v1", private=True)
tok.push_to_hub("gemma-270m-km-base-v1", private=True)
```

## Cell 7 — Sanity check (THE milestone of this stage)

Use the **in-memory** `model`/`tok` — never reload from the local path
(`pipeline("...local path...")` mis-parses multi-slash paths as HF repo
ids and 403s). Greedy decoding makes weak models loop on one syllable, so
test with sampling + repetition penalty to see true capability:

```python
from transformers import pipeline
gen = pipeline("text-generation", model=model, tokenizer=tok, device=0)

for prompt in [
    "ប្រទេសកម្ពុជាមានរាជធានីឈ្មោះ",
    "អាហារខ្មែរដ៏ពេញនិយមមួយគឺ",
    "ការសិក្សាមានសារៈសំខាន់ព្រោះ",
]:
    out = gen(prompt, max_new_tokens=60, do_sample=True, temperature=0.7,
              top_p=0.9, repetition_penalty=1.3)[0]["generated_text"]
    print("»", out, "\n")
```

**Reading the result:**
- **Coherent Khmer phrases** → on track; more data/epochs sharpens it.
- **Repeats one syllable (ថាថាថា)** → *undertrained*, not broken (note it
  IS producing valid Khmer characters). Fix: bigger corpus + more epochs
  (see below). This is normal for a first small run.
- **Random script / non-Khmer** → corpus or training problem.

---

## Scaling up (the real run, after the first proof-of-signal)

The tiny Wikipedia-only run (~35 MB, 1 epoch, loss ~2.0) proves the
pipeline but undertrains — expect syllable repetition. To get real Khmer,
turn the two levers that matter, in order: **more data**, then **more
epochs**. Replace Cell 3's corpus with a bigger blend:

```python
from datasets import load_dataset, concatenate_datasets, Dataset
import re
KHMER = re.compile(r'[ក-៿]')
def kratio(s): 
    return sum(1 for c in s if KHMER.match(c)) / max(1, len(s))

parts = []
# Wikipedia (clean)
wiki = load_dataset("wikimedia/wikipedia", "20231101.km", split="train")
parts.append(wiki.select_columns(["text"]))
# CulturaX Khmer web text — large; take a slice to keep it manageable
cx = load_dataset("uonlp/CulturaX", "km", split="train", streaming=True)
cx_rows = [{"text": r["text"]} for _, r in zip(range(60000), cx)]
parts.append(Dataset.from_list(cx_rows))
# Royal Academy dictionary — nails vocabulary/spelling
dic = load_dataset("seanghay/khmer-dictionary-44k", split="train")
parts.append(dic.map(lambda e: {"text": f'{e["word"]}: {e.get("definition","")}'}).select_columns(["text"]))

corpus = concatenate_datasets(parts)
corpus = corpus.map(lambda e: {"text": re.sub(r"\s+", " ", e["text"]).strip()})
corpus = corpus.filter(lambda e: len(e["text"]) > 200 and kratio(e["text"]) > 0.5)
print("docs:", len(corpus))   # aim for a few hundred k
```

Then in Cell 5 raise `num_train_epochs=3` and target **loss ~1.3–1.5**.
This is roughly 2–3 GPU-hours (well within the weekly 30). Save a new
version each run: `gemma-270m-km-base-v2`, `-v3`, … and keep the best.

> Field names in `khmer-dictionary-44k` may differ (`word`/`definition`
> vs other keys) — `print(dic[0])` once and adjust the `.map` above.

## Watch out for (Kaggle-specific)

- **bf16 crash** — the classic first-run failure on T4/P100. Cell 1
  detects it; keep `fp16=not BF16_OK`.
- **"Internet must be on"** — dataset/model downloads fail silently
  otherwise. Toggle it in Settings.
- **License 401** — accept the Gemma license on HF with the *same account*
  as your token.
- **Session timeout mid-train** — `save_steps=500` means you resume from
  the last checkpoint (`resume_from_checkpoint=True` in `trainer.train()`)
  instead of restarting.
- **Don't over-invest in v1** — the point of this first run is a yes/no on
  "can it write Khmer at all." Once yes, *then* pour effort into the
  corpus (Stage 1 scale-up) and the Q&A data (Stage 2), which is where
  quality actually comes from.

When Cell 6 passes, tell me — I'll walk you through Stage 2 (the RAG Q&A
data generation and SFT) as the next notebook.
