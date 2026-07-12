# Fine-tune Qwen3-0.6B for smarter Khmer (S10 model) — Kaggle batch

The S10's ceiling is ~0.6B, so we make the 0.6B *better* by fine-tuning it on
your Khmer dataset. Start from the already-trimmed Khmer Qwen3
(`alphaedge-ai/Qwen3-0.6B-khm-32768`): it keeps the 32k vocab that fits the S10
and is Khmer-adapted, so you only need **SFT** (no full continued-pretrain like
the Gemma run).

This runs as a **Kaggle batch job** (Save & Run All → background, up to 12h) —
one notebook does everything: train → merge → convert to GGUF → upload. No
interactive prompts (batch can't answer them), so the HF token comes from
**Kaggle Secrets**.

## Setup (once, before running)

1. New Kaggle notebook. **Add Data →** attach your Khmer dataset.
2. **Settings:** Accelerator = **GPU T4 ×2** is fine (we pin to one GPU),
   **Internet = On** (needed to pull the base model + push to HF).
3. **Add-ons → Secrets →** add a secret named **`HF_TOKEN`** = your HF **Write**
   token.
4. Paste the cell below, fix the dataset path, then **Save Version → "Save & Run
   All (Commit)"**. It runs in the background; check back in an hour or two.

## Your data

A list of Khmer **context / question / answer** rows (reuse your Gemma SFT
data, reshaped):

```json
{"context": "…ខ្មែរ…", "question": "…?", "answer": "…ខ្មែរ…"}
```

## The notebook (one batch cell)

```python
import os
os.environ["CUDA_VISIBLE_DEVICES"] = "0"          # T4 x2 device-split crashes training
from kaggle_secrets import UserSecretsClient
HF_TOKEN = UserSecretsClient().get_secret("HF_TOKEN")

import subprocess, sys
subprocess.run([sys.executable,"-m","pip","install","-q",
                "transformers>=4.51","trl>=0.12","peft","datasets","accelerate"])

import json, torch, pathlib
from datasets import Dataset
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import LoraConfig
from trl import SFTTrainer, SFTConfig
from huggingface_hub import login, HfApi
login(HF_TOKEN)

BASE = "alphaedge-ai/Qwen3-0.6B-khm-32768"
OUT_REPO = "sengtha/Qwen3-0.6B-khm-ft-Q8_0-GGUF"

tok = AutoTokenizer.from_pretrained(BASE)
model = AutoModelForCausalLM.from_pretrained(BASE, torch_dtype=torch.float16, device_map={"": 0})

# --- your data -> iAny's exact inference prompt (adapt the path) ---
raw = json.load(open("/kaggle/input/YOUR-DATASET/data.json"))
def to_chat(ex):
    user = ("Answer the question using only the context below, from the user's notes.\n"
            "Be brief. Answer in Khmer (ភាសាខ្មែរ).\n\n"
            f"Context:\n{ex['context']}\n\nQuestion: {ex['question']}\n/no_think")
    return {"messages": [{"role": "user", "content": user},
                         {"role": "assistant", "content": ex["answer"]}]}
ds = Dataset.from_list([to_chat(e) for e in raw])

# --- LoRA SFT (fp16 for T4) ---
peft_cfg = LoraConfig(r=16, lora_alpha=32, lora_dropout=0.05, task_type="CAUSAL_LM",
    target_modules=["q_proj","k_proj","v_proj","o_proj","gate_proj","up_proj","down_proj"])
args = SFTConfig(output_dir="out", num_train_epochs=3,
    per_device_train_batch_size=2, gradient_accumulation_steps=8,
    learning_rate=2e-4, fp16=True, gradient_checkpointing=True,
    max_length=1024, logging_steps=10, save_strategy="no", report_to="none")
SFTTrainer(model=model, args=args, train_dataset=ds,
           peft_config=peft_cfg, processing_class=tok).train()

merged = model.merge_and_unload()
merged.save_pretrained("khm-ft"); tok.save_pretrained("khm-ft")

# --- convert to GGUF (force the qwen2 pre-tokenizer for the trimmed tokenizer) ---
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

# --- upload the GGUF (token from secrets, no prompt) ---
api = HfApi(token=HF_TOKEN)
api.create_repo(OUT_REPO, exist_ok=True)
api.upload_file(path_or_fileobj="model.gguf",
                path_in_repo="Qwen3-0.6B-khm-ft-Q8_0.gguf", repo_id=OUT_REPO)
print("DONE ->", OUT_REPO)
```

## After it finishes

The batch run uploads `sengtha/Qwen3-0.6B-khm-ft-Q8_0-GGUF` at the end (it
survives the session wipe because it's on HF). Send me that repo name → I point
iAny at it → rebuild → your fine-tuned Khmer model on the S10.

## Notes / lessons baked in

- **T4 has no bf16** → fp16 (as in your Gemma run).
- **CUDA_VISIBLE_DEVICES=0** → avoids the T4×2 device-split crash.
- **Token via Kaggle Secrets** → batch can't answer a getpass prompt.
- **Upload to HF at the end** → outputs persist past the batch session.
- **Data is the lever.** A few hundred good Khmer (context, question, answer)
  rows already beat the base model; a few thousand is great. Same dataset later
  feeds bigger fine-tunes for the Pi/PWA tiers.
