# Fine-tune Qwen3-0.6B Khmer on RunPod (CPT + Stage B SFT) → ft3

Out of Kaggle hours? Run the whole fine-tune on RunPod. This is the **same proven
LoRA pipeline** as `FINETUNE-QWEN-KHMER.md` (Stage A CPT on raw Khmer → Stage B
SFT on your Q&A → merge → GGUF), adapted for RunPod and **run detached** so a
phone/Jupyter disconnect can't kill it. It produces **ft3** from your *richer*
`sengtha/khmer-qa` dataset (fuller answers), and exports both Q8 and Q4.

> Earlier this doc tried full-parameter bf16 CPT on an A100 — it crawled at
> ~0.10 it/s and was abandoned for the Kaggle LoRA run. This is the LoRA approach
> that actually works, now on RunPod.

> Why re-run CPT too (not just SFT)? Stacking a new SFT on top of the *already
> SFT'd* ft2 bakes the old terse style in. A clean run from the trimmed base
> (CPT → new SFT) gives the fuller-answer style without fighting the old one. On
> a fast RunPod GPU the CPT redo is only ~1–2h.

## 1. Pod

- **GPU:** a **24 GB card is plenty** (RTX A5000 / L4 / 3090) — LoRA on a frozen
  0.6B is light. A100 works too but is overkill. **Use a separate pod from TTS.**
  You can reuse the pod you built the Q&A dataset on.
- Template **RunPod PyTorch 2.x**, container disk **40 GB**, Internet on.
- These GPUs support **bf16** (unlike Kaggle's T4), so we use bf16 — more stable
  than fp16.

## 2. Write the pipeline to a file (Jupyter cell — `%%writefile`)

```python
%%writefile /workspace/finetune.py
import os, subprocess, sys, json, glob, re, pathlib, torch
subprocess.run([sys.executable,"-m","pip","install","-q",
    "transformers>=4.51","trl>=0.12","peft","datasets","accelerate","huggingface_hub"], check=True)
from datasets import Dataset, load_dataset
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import LoraConfig, get_peft_model
from trl import SFTTrainer, SFTConfig
from huggingface_hub import login, HfApi, hf_hub_download

login("hf_xxxxxxxx")                                  # <-- your HF WRITE token
BASE      = "alphaedge-ai/Qwen3-0.6B-khm-32768"       # trimmed 32k Khmer vocab (fits S10)
QA_REPO   = "sengtha/khmer-qa"                         # your richer Q&A dataset
FT_REPO   = "sengtha/Qwen3-0.6B-khm-ft3"              # safetensors out
GGUF_REPO = "sengtha/Qwen3-0.6B-khm-ft3-Q8_0-GGUF"    # gguf out (Q8 + Q4)

tok = AutoTokenizer.from_pretrained(BASE)
if tok.pad_token is None: tok.pad_token = tok.eos_token
model = AutoModelForCausalLM.from_pretrained(BASE, torch_dtype=torch.bfloat16, device_map={"":0})

# one LoRA adapter through BOTH stages (kept resident, so SFT builds on CPT)
peft_cfg = LoraConfig(r=16, lora_alpha=32, lora_dropout=0.05, task_type="CAUSAL_LM",
    target_modules=["q_proj","k_proj","v_proj","o_proj","gate_proj","up_proj","down_proj"])
model = get_peft_model(model, peft_cfg)

# ---------- Stage A: CPT on raw Khmer (FineWeb-2) ----------
texts, CAP = [], 150_000
try:
    fw = load_dataset("HuggingFaceFW/fineweb-2", "khm_Khmr", split="train", streaming=True)
    for ex in fw:
        t = (ex.get("text") or "").strip()
        if t: texts.append(t)
        if len(texts) >= CAP: break
    print("FineWeb-2 Khmer docs:", len(texts), flush=True)
except Exception as e:
    print("fineweb-2 failed -> wikipedia:", e, flush=True)
    wiki = load_dataset("wikimedia/wikipedia", "20231101.km", split="train")
    texts += [t for t in wiki["text"] if t and t.strip()]

# optional extra Khmer text: drop .txt/.tsv into /workspace/cpt_extra/ (Khmer col kept)
KH = re.compile(r'[ក-៿]')
for f in glob.glob("/workspace/cpt_extra/**/*", recursive=True):
    if not pathlib.Path(f).is_file(): continue
    try:
        for line in open(f, encoding="utf-8", errors="ignore"):
            km = next((p.strip() for p in line.split("\t") if KH.search(p)), None)
            if km: texts.append(km)
    except Exception as e: print("skip", f, e, flush=True)
texts = texts[:300_000]
print("CPT blocks:", len(texts), flush=True)

cpt_ds = Dataset.from_dict({"text": texts})
cpt_args = SFTConfig(output_dir="cpt", max_steps=4000,
    per_device_train_batch_size=16, gradient_accumulation_steps=1,
    learning_rate=2e-4, bf16=True, gradient_checkpointing=True,
    max_length=512, packing=True, logging_steps=25, save_strategy="no", report_to="none")
SFTTrainer(model=model, args=cpt_args, train_dataset=cpt_ds, processing_class=tok).train()
print("CPT done", flush=True)

# ---------- Stage B: SFT on the richer Khmer Q&A (from HF) ----------
# prompt MUST match the app's ask.ts exactly (complete-answer style), or the model
# learns a different style than it's asked for at inference.
qa = json.load(open(hf_hub_download(QA_REPO, "data.json", repo_type="dataset")))
def to_chat(ex):
    user = ("Answer the question using only the context below, from the user's notes.\n"
            "Give a complete answer in Khmer (ភាសាខ្មែរ), 2–4 sentences, including the "
            "relevant details from the context. Do not just repeat the question.\n\n"
            f"Context:\n{ex['context']}\n\nQuestion: {ex['question']}\n/no_think")
    return {"messages":[{"role":"user","content":user},{"role":"assistant","content":ex["answer"]}]}
sft_ds = Dataset.from_list([to_chat(e) for e in qa])
sft_args = SFTConfig(output_dir="sft", num_train_epochs=3,
    per_device_train_batch_size=4, gradient_accumulation_steps=4,
    learning_rate=2e-4, bf16=True, gradient_checkpointing=True,
    max_length=1024, logging_steps=10, save_strategy="no", report_to="none")
SFTTrainer(model=model, args=sft_args, train_dataset=sft_ds, processing_class=tok).train()
print("SFT on", len(sft_ds), "rows", flush=True)

# ---------- merge + SAVE SAFETENSORS FIRST (a GGUF failure must never lose weights) ----------
merged = model.merge_and_unload()
merged.save_pretrained("khm-ft3"); tok.save_pretrained("khm-ft3")
api = HfApi()
api.create_repo(FT_REPO, exist_ok=True)
api.upload_folder(folder_path="khm-ft3", repo_id=FT_REPO)
print("SAFETENSORS SAVED ->", FT_REPO, flush=True)

# ---------- GGUF: qwen2 pre-tok patch, then Q8 + Q4 from f16 ----------
subprocess.run("apt-get update -qq && apt-get install -y -qq cmake build-essential git", shell=True)
subprocess.run("test -d llama.cpp || git clone --depth 1 https://github.com/ggml-org/llama.cpp", shell=True, check=True)
subprocess.run([sys.executable,"-m","pip","install","-q","-r","llama.cpp/requirements.txt"], check=True)
# transformers>=4.51 (needed to TRAIN Qwen3) saves extra_special_tokens as a LIST,
# then crashes its own tokenizer loader during convert ("'list' object has no
# attribute 'keys'"). The convert runs as a subprocess, so pin a convert-safe
# transformers on disk here — training already finished in this process.
subprocess.run([sys.executable,"-m","pip","install","-q","transformers==4.46.3"], check=True)
# force get_vocab_base_pre() -> "qwen2" (the trimmed vocab isn't in llama.cpp's hash list)
for p in pathlib.Path("llama.cpp").rglob("*.py"):
    s = p.read_text()
    if "def get_vocab_base_pre" in s:
        out=[]
        for ln in s.splitlines():
            out.append(ln)
            if ln.strip().startswith("def get_vocab_base_pre"):
                out.append(ln[:len(ln)-len(ln.lstrip())] + '    return "qwen2"')
        p.write_text("\n".join(out)); print("patched", p, flush=True)
subprocess.run([sys.executable,"llama.cpp/convert_hf_to_gguf.py","khm-ft3",
                "--outfile","khm-ft3-f16.gguf","--outtype","f16"], check=True)
subprocess.run("cd llama.cpp && cmake -B build -DLLAMA_CURL=OFF && "
               "cmake --build build --config Release -j 4 --target llama-quantize", shell=True, check=True)
subprocess.run(["./llama.cpp/build/bin/llama-quantize","khm-ft3-f16.gguf","q8.gguf","Q8_0"], check=True)
subprocess.run(["./llama.cpp/build/bin/llama-quantize","khm-ft3-f16.gguf","q4.gguf","Q4_K_M"], check=True)
api.create_repo(GGUF_REPO, exist_ok=True)
api.upload_file(path_or_fileobj="q8.gguf", path_in_repo="Qwen3-0.6B-khm-ft3-Q8_0.gguf", repo_id=GGUF_REPO)
api.upload_file(path_or_fileobj="q4.gguf", path_in_repo="Qwen3-0.6B-khm-ft3-Q4_K_M.gguf", repo_id=GGUF_REPO)
print("DONE ->", GGUF_REPO, "(Q8 + Q4)", flush=True)
```

## 3. Run it DETACHED (survives disconnects)

In the **Terminal** (not a cell — a cell dies if the kernel is interrupted):

```bash
cd /workspace
nohup python finetune.py > ft.out 2>&1 &
echo "pid $!"
tail -f ft.out            # watch; Ctrl-C stops WATCHING, not training
```

Close the tab / lock the phone — it keeps running. Reconnect with
`tail -f /workspace/ft.out`. Expect, in order: FineWeb doc count → CPT `{'loss'…}`
lines → `CPT done` → SFT loss lines → `SAFETENSORS SAVED` → `patched …` →
`DONE -> …ft3…-GGUF (Q8 + Q4)`. Total ~1.5–3h depending on GPU.

## 4. When it prints DONE

Everything is on HF (survives the pod). **Tell me the repo is ready** and I'll:
- point the app at `sengtha/Qwen3-0.6B-khm-ft3-Q8_0-GGUF` (prefers Q4, falls back
  to Q8), add it to the worker allow-list; you rebuild + Redownload to A/B
  **ft3 vs ft2**.

Keep ft2 as the fallback — if ft3 is worse on something, we switch back in one line.

## Notes / knobs
- **Safetensors saved before GGUF** — a convert failure can never lose the trained
  weights (we learned this the hard way).
- **Q4 from f16** (not requantized from Q8) — best Q4 quality, and you get both in
  one run.
- **More/better data = smarter:** raise `CAP` for more CPT, add OSCAR-2301 `km`
  (gated) or ParaCrawl (drop into `/workspace/cpt_extra/`), and grow `khmer-qa`.
  The same dataset later trains bigger models (1.7B/7B) for better phones + IoT.
- **If GGUF convert errors on the tokenizer** (`tokenizer.model not found`), copy
  the base tokenizer into `khm-ft3/` before the convert line:
  `for f in ["tokenizer.json","tokenizer_config.json","vocab.json","merges.txt"]:`
  `    try: hf_hub_download(BASE, f, local_dir="khm-ft3")`
  `    except Exception: pass`
- **Disk:** the f16 + Q8 + Q4 gguf + llama.cpp build need ~5 GB on top of the
  model; 40 GB container disk is comfortable. `df -h /` if unsure.
