# Fine-tune Qwen3-0.6B for smarter Khmer (S10 model)

The S10's ceiling is ~0.6B, so we don't go bigger — we make the 0.6B *better*
by fine-tuning it on your Khmer dataset. We start from the **already-trimmed
Khmer Qwen3** (`alphaedge-ai/Qwen3-0.6B-khm-32768`): it keeps the 32k vocab
that fits the S10, and it's already Khmer-adapted, so you only need SFT on your
task data — not a full continued-pretrain like the Gemma run.

Key idea: **train on the exact prompt iAny sends at inference**, so the model
learns your task precisely. Run on **Kaggle (T4)** — same as before.

## 1. Your data

You need a list of Khmer examples with **context / question / answer** (the RAG
Q&A data you built for the Gemma SFT — reuse it). Shape each row as:

```json
{"context": "…ខ្មែរ…", "question": "…?", "answer": "…ខ្មែរ…"}
```

If your existing dataset is in the Gemma `បរិបទ/សំណួរ/ចម្លើយ` text format, just
map it into these three fields.

## 2. Notebook (Kaggle T4)

```python
!pip install -q "transformers>=4.51" "trl>=0.12" peft datasets accelerate

import json, torch
from datasets import Dataset
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import LoraConfig
from trl import SFTTrainer, SFTConfig

BASE = "alphaedge-ai/Qwen3-0.6B-khm-32768"
tok = AutoTokenizer.from_pretrained(BASE)
model = AutoModelForCausalLM.from_pretrained(BASE, torch_dtype=torch.float16, device_map="auto")

# --- your data -> iAny's exact inference prompt ---
raw = json.load(open("/kaggle/input/your-khmer-rag/data.json"))  # adapt path

def to_chat(ex):
    user = (
        "Answer the question using only the context below, from the user's notes.\n"
        "Be brief. Answer in Khmer (ភាសាខ្មែរ).\n\n"
        f"Context:\n{ex['context']}\n\n"
        f"Question: {ex['question']}\n/no_think"
    )
    return {"messages": [
        {"role": "user", "content": user},
        {"role": "assistant", "content": ex["answer"]},
    ]}

ds = Dataset.from_list([to_chat(e) for e in raw])

# --- LoRA SFT (safe on T4; T4 has no bf16, so fp16) ---
peft_cfg = LoraConfig(
    r=16, lora_alpha=32, lora_dropout=0.05, task_type="CAUSAL_LM",
    target_modules=["q_proj","k_proj","v_proj","o_proj","gate_proj","up_proj","down_proj"],
)
args = SFTConfig(
    output_dir="out", num_train_epochs=3,
    per_device_train_batch_size=2, gradient_accumulation_steps=8,
    learning_rate=2e-4, fp16=True, gradient_checkpointing=True,
    max_length=1024, logging_steps=10, save_strategy="epoch",
)
trainer = SFTTrainer(model=model, args=args, train_dataset=ds,
                     peft_config=peft_cfg, processing_class=tok)
trainer.train()

# --- merge LoRA into the base and save the full model ---
merged = trainer.model.merge_and_unload()
merged.save_pretrained("khm-ft")
tok.save_pretrained("khm-ft")
print("saved -> ./khm-ft")
```

Tips:
- **Epochs 2–3** is plenty for a small SFT set. If answers overfit/parrot, drop
  to 1–2.
- Keep the `/no_think` in training — it matches iAny and disables Qwen3's
  reasoning block.
- More data = better. Even a few hundred good Khmer (context, question, answer)
  rows help; a few thousand is great.

## 3. Convert the fine-tuned model to GGUF

Same as `docs/CONVERT-KHMER-QWEN-GGUF.md`, but point it at your **local**
`./khm-ft` folder instead of downloading, since the merged model already has
the trimmed tokenizer (so the `return "qwen2"` pre-tokenizer patch still
applies):

```python
# after the patch cell from CONVERT-KHMER-QWEN-GGUF.md:
!python llama.cpp/convert_hf_to_gguf.py khm-ft --outfile khm-ft-f16.gguf --outtype f16
!./llama.cpp/build/bin/llama-quantize khm-ft-f16.gguf Qwen3-0.6B-khm-ft-Q8_0.gguf Q8_0

from huggingface_hub import HfApi
from getpass import getpass
api = HfApi(token=getpass("HF WRITE token: "))
api.create_repo("sengtha/Qwen3-0.6B-khm-ft-Q8_0-GGUF", exist_ok=True)
api.upload_file(path_or_fileobj="Qwen3-0.6B-khm-ft-Q8_0.gguf",
                path_in_repo="Qwen3-0.6B-khm-ft-Q8_0.gguf",
                repo_id="sengtha/Qwen3-0.6B-khm-ft-Q8_0-GGUF")
print("done -> sengtha/Qwen3-0.6B-khm-ft-Q8_0-GGUF")
```

## 4. Ship it

Send the repo name (`sengtha/Qwen3-0.6B-khm-ft-Q8_0-GGUF`) and I point iAny at
it — same wiring as the current model. Rebuild → your *own* Khmer-fine-tuned
model runs on the S10.

## Honest expectation

This will be **noticeably better and more grounded** than the base trimmed
model (it garbled "អ្នកនិពន្ធ"; a fine-tune on your data won't). But it is still
0.6B — great for the S10 tier and IoT, while the PWA (Gemma 4) and a Pi (1.7B–4B)
remain your high-quality tiers. Same dataset feeds all of them.
