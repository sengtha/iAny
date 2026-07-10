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

## Cell 1 — Install

```python
!pip install -q -U "transformers>=4.49" "trl>=0.12" datasets accelerate peft sentencepiece
import torch
print("GPU:", torch.cuda.get_device_name(0))
# T4/P100 = no bf16. Ampere (A100) = bf16 ok. We detect below.
BF16_OK = torch.cuda.is_bf16_supported()
print("bf16 supported:", BF16_OK)   # False on free Kaggle → we use fp16
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
    torch_dtype=torch.bfloat16 if BF16_OK else torch.float16,
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

## Cell 6 — Sanity check (THE milestone of this stage)

```python
from transformers import pipeline
gen = pipeline("text-generation", model="/kaggle/working/gemma-270m-km-base",
               tokenizer=tok, device=0)

for prompt in [
    "ប្រទេសកម្ពុជាមានរាជធានីឈ្មោះ",
    "អាហារខ្មែរដ៏ពេញនិយមមួយគឺ",
    "ការសិក្សាមានសារៈសំខាន់ព្រោះ",
]:
    out = gen(prompt, max_new_tokens=40, do_sample=False)[0]["generated_text"]
    print("»", out, "\n")
```

**Pass = the continuations are readable, on-topic Khmer** (not perfect —
just coherent Khmer words forming plausible phrases). If it's script soup:
train longer (more epochs / bigger corpus), don't proceed. Only move to
Stage 2 once this reads like real Khmer.

## Cell 7 — Keep the result

The folder `/kaggle/working/gemma-270m-km-base` is saved as notebook
output automatically. To reuse it in your Stage 2 notebook without
retraining, push it to your own HF repo (private is fine):

```python
model.push_to_hub("YOUR_HF_USERNAME/gemma-270m-km-base", private=True)
tok.push_to_hub("YOUR_HF_USERNAME/gemma-270m-km-base", private=True)
```

---

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
