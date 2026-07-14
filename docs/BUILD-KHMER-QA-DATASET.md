# Build a richer Khmer Q&A dataset for SFT (RunPod)

The CPT-only fine-tune reads Khmer but answers **terse** (single-span extraction),
because the first dataset only had short extractive answers (`answer` had to be a
literal substring of the context). This builder fixes that: it synthesizes a
**mix of task types** — extractive *and* fuller 1–3 sentence answers (explain /
summarize) — so the SFT teaches the model to answer completely, not just grab a
word. The dataset is reusable: SFT the 0.6B for the S10 today, and bigger models
(1.7B / 7B) for better phones and IoT later, from the **same** data.

## Where to run it (RunPod)

This needs a GPU + internet, **separate from TTS training** (don't share VRAM).
A **~32 GB GPU** (RTX PRO 4500 / A5000 / 4090) is ideal.

> **Disk matters.** A 14B model downloads ~28 GB of fp16 weights (4-bit saves
> VRAM, NOT download size), so it will NOT fit a 30 GB container disk. Use
> **Qwen2.5-7B** (~15 GB) unless you gave the pod ≥60 GB disk. On a 32 GB card 7B
> runs in **bf16 (no quantization)** — faster than 4-bit and simpler.

Template: **RunPod PyTorch 2.x**, container disk **40 GB+**, Internet on.

## Speed: batch it

Generating one row at a time is slow (~7–18 h for 2.5k on a 14B). The builder
below **batches** generations (24 at once) → ~**40–75 min** for 2.5k rows on a
32 GB card, and runs **detached** so a phone disconnect can't kill it.

## The builder (write to a file, run detached)

In a Jupyter cell, `%%writefile /workspace/build_qa.py` with the code below, then
launch it with `nohup` (next section).

```python
import subprocess, sys
subprocess.run([sys.executable,"-m","pip","install","-q",
                "transformers>=4.44","accelerate","datasets","huggingface_hub"])
import torch, re, json, random
from transformers import AutoModelForCausalLM, AutoTokenizer
from datasets import load_dataset
from huggingface_hub import login, HfApi

login("hf_xxxxxxxx")                      # <-- your HF WRITE token
TARGET, BATCH = 2500, 24                   # BATCH: lower to 12 if you hit CUDA OOM

# 7B fits a 30GB disk and runs in bf16 (no quant) on a 32GB card — faster than
# 4-bit. For better Khmer on a big-disk/48GB pod, use Qwen/Qwen2.5-14B-Instruct.
GEN = "Qwen/Qwen2.5-7B-Instruct"
tok = AutoTokenizer.from_pretrained(GEN); tok.padding_side = "left"   # decoder-only batch gen
if tok.pad_token is None: tok.pad_token = tok.eos_token
model = AutoModelForCausalLM.from_pretrained(GEN, torch_dtype=torch.bfloat16, device_map={"":0}).eval()

# ---- Khmer source paragraphs (clean, factual). Mix in your own notes for domain Q&A. ----
wiki = load_dataset("wikimedia/wikipedia", "20231101.km", split="train")
paras = []
for art in wiki:
    for p in art["text"].split("\n"):
        p = p.strip()
        if 200 <= len(p) <= 1200: paras.append(p)
    if len(paras) >= TARGET*3: break
random.shuffle(paras); print("paras:", len(paras), flush=True)

# ---- Task types: mix extractive + fuller answers so the SFT isn't only terse.
# Each = (name, instruction, few-shot, grounding threshold). Answers are Khmer. ----
TASKS = [
  ("extract","បង្កើតសំណួរខ្លីមួយ ដែលចម្លើយស្ថិតនៅក្នុងអត្ថបទ ហើយផ្តល់ចម្លើយខ្លីត្រឹមត្រូវ (ពាក្យ ឬឃ្លា)។",
   'អត្ថបទ៖ ភ្នំពេញ គឺជារាជធានីរបស់ប្រទេសកម្ពុជា។\n{"question":"តើរាជធានីរបស់កម្ពុជាឈ្មោះអ្វី?","answer":"ភ្នំពេញ"}\n',0.9),
  ("explain","បង្កើតសំណួរ 'ហេតុអ្វី' ឬ 'យ៉ាងណា' មួយ ហើយឆ្លើយជា ១-៣ ប្រយោគ ដោយផ្អែកលើអត្ថបទ។",
   'អត្ថបទ៖ ទន្លេសាបហូរបញ្ច្រាសនៅរដូវវស្សា ដោយសារទឹកមេគង្គឡើងខ្ពស់ រុញទឹកចូលបឹង។\n{"question":"ហេតុអ្វីទន្លេសាបហូរបញ្ច្រាស?","answer":"ដោយសារនៅរដូវវស្សា ទឹកទន្លេមេគង្គឡើងខ្ពស់ ហើយរុញទឹកឲ្យហូរបញ្ច្រាសចូលបឹង។"}\n',0.45),
  ("summarize","សង្ខេបខ្លឹមសារនៃអត្ថបទ ជា ១-២ ប្រយោគ។ សំណួរគឺ 'តើអត្ថបទនេះនិយាយអំពីអ្វី?'។",
   'អត្ថបទ៖ អង្គរវត្ត ជាប្រាសាទដ៏ធំ សាងសង់នៅសតវត្សទី១២។\n{"question":"តើអត្ថបទនេះនិយាយអំពីអ្វី?","answer":"អត្ថបទនិយាយអំពីប្រាសាទអង្គរវត្ត ដែលសាងសង់នៅសតវត្សទី១២។"}\n',0.5),
]
SYS = "ប្រើតែព័ត៌មានក្នុងអត្ថបទ។ កុំបង្កើតព័ត៌មានថ្មី។ ឆ្លើយជា JSON តែមួយបន្ទាត់ ដែលមាន key 'question' និង 'answer'។"

# grounding via char 5-gram overlap: extractive answers overlap ~fully; paraphrased
# answers must still share most of their content with the context (blocks made-up facts).
def shingles(s, n=5):
    s = re.sub(r"\s+", "", s or ""); return {s[i:i+n] for i in range(max(0, len(s)-n+1))}
def grounded(a, c, thr):
    sh = shingles(a); return bool(sh) and len(sh & shingles(c)) / len(sh) >= thr
def prompt(para, task):
    user = f"{task[1]}\n\nឧទាហរណ៍៖\n{task[2]}\nឥឡូវនេះ ឆ្លើយជា JSON តែមួយបន្ទាត់៖\nអត្ថបទ៖ {para}\n"
    return tok.apply_chat_template([{"role":"system","content":SYS},{"role":"user","content":user}],
                                   tokenize=False, add_generation_prompt=True)
def parse(txt, para, task):
    m = re.search(r"\{.*\}", txt, re.S)
    if not m: return None
    try: j = json.loads(m.group(0))
    except Exception: return None
    q, a = str(j.get("question","")).strip(), str(j.get("answer","")).strip()
    if len(q) < 5 or len(a) < 2 or len(a) > len(para) + 80: return None
    if not grounded(a, para, task[3]): return None
    return {"context": para, "question": q, "answer": a, "type": task[0]}

# ---- BATCHED generation: 24 prompts per forward pass = ~5-10x faster ----
rows, idx = [], 0
while len(rows) < TARGET and idx < len(paras):
    batch = []
    while len(batch) < BATCH and idx < len(paras):
        batch.append((paras[idx], TASKS[idx % len(TASKS)])); idx += 1   # cycle tasks
    enc = tok([prompt(p, t) for p, t in batch], return_tensors="pt", padding=True).to(model.device)
    with torch.no_grad():
        out = model.generate(**enc, max_new_tokens=256, do_sample=True, temperature=0.7,
                             top_p=0.9, pad_token_id=tok.pad_token_id)
    dec = tok.batch_decode(out[:, enc["input_ids"].shape[1]:], skip_special_tokens=True)
    for (p, t), txt in zip(batch, dec):
        r = parse(txt, p, t)
        if r: rows.append(r)
    print(len(rows), "rows /", idx, "seen", flush=True)

from collections import Counter
print("by type:", Counter(r["type"] for r in rows), flush=True)
json.dump(rows, open("/workspace/khmer_qa.json","w"), ensure_ascii=False, indent=1)
api = HfApi()
api.create_repo("sengtha/khmer-qa", repo_type="dataset", exist_ok=True)
api.upload_file(path_or_fileobj="/workspace/khmer_qa.json", path_in_repo="data.json",
                repo_id="sengtha/khmer-qa", repo_type="dataset")
print("DONE ->", len(rows), "rows to sengtha/khmer-qa (data.json)", flush=True)
```

## Run it detached

```bash
cd /workspace
nohup python build_qa.py > qa.out 2>&1 &
tail -f qa.out          # each line: "rows / seen"; Ctrl-C stops WATCHING only
```

~**40–75 min** for 2,500 rows on a 32 GB card. Reconnect anytime with
`tail -f /workspace/qa.out`. If it OOMs, lower `BATCH` to 12 and relaunch.

## Then: re-run Stage B SFT

The output schema is unchanged (`{context, question, answer}` — plus a `type`
field the trainer ignores), so the existing Stage B fine-tune consumes it as-is.
Because you're out of Kaggle hours, run the fine-tune on **RunPod** too:

- The fine-tune is a **LoRA SFT on a 0.6B** — light; a 24 GB pod (even the same
  one you built the data on) finishes it quickly.
- Point Stage B at `sengtha/khmer-qa` and train. Then convert to GGUF (§ in
  `FINETUNE-QWEN-KHMER.md`), and **make a Q4_K_M** (§"Make a Q4_K_M for the S10").
- Upload as **ft3** (e.g. `sengtha/Qwen3-0.6B-khm-ft3-...-GGUF`), tell me the repo,
  and I'll point the app at it. Keep ft2 as a fallback to A/B against.

> **One check:** make sure Stage B does **not** re-apply an `answer in context`
> substring filter — that would silently drop all the new fuller (explain/
> summarize) rows and you'd be back to terse. It should train on every row. Ping
> me and I'll adapt the fine-tune notebook for RunPod + confirm no such filter.

## Notes / how to make it better
- **Balance the mix.** The `by type:` print shows the extract/explain/summarize
  split. Cycling keeps it ~even; adjust `TASKS` order/weights to taste.
- **Grounding threshold.** `explain`/`summarize` use a looser 0.45–0.5 char-5-gram
  overlap (paraphrase reuses fewer exact strings). If too many get rejected, lower
  it; if you see made-up facts, raise it.
- **Better generator = better data.** Qwen2.5-14B is strong; SeaLLMs-v3 / Gemma-2
  have stronger Khmer (accept their licenses first).
- **Mix in your own notes** as extra `paras` for domain-relevant Q&A — that's what
  makes iAny answer *your* content well.
- **Scale:** 2–3k rows is solid; raise `TARGET` for more. The same dataset trains
  every model size, so it's worth building once and building it well.
