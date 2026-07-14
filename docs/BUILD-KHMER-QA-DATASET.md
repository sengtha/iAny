# Build a richer Khmer Q&A dataset for SFT (RunPod)

The CPT-only fine-tune reads Khmer but answers **terse** (single-span extraction),
because the first dataset only had short extractive answers (`answer` had to be a
literal substring of the context). This builder fixes that: it synthesizes a
**mix of task types** — extractive *and* fuller 1–3 sentence answers (explain /
summarize) — so the SFT teaches the model to answer completely, not just grab a
word. The dataset is reusable: SFT the 0.6B for the S10 today, and bigger models
(1.7B / 7B) for better phones and IoT later, from the **same** data.

## Where to run it (RunPod)

This needs a GPU + internet, and it's **separate from TTS training** — don't run
it on the pod that's training the voice (they'd fight over VRAM). Two options:
- **A new, cheaper pod** — a **24 GB GPU** (RTX A5000 / L4 / 3090) runs the 4-bit
  generator fine and costs less than an A100. Recommended.
- **Or wait** until TTS training is done and reuse that A100.

Template: **RunPod PyTorch 2.x**, container disk 40 GB, Internet on. Open Jupyter.

## The notebook

```python
import subprocess, sys
subprocess.run([sys.executable,"-m","pip","install","-q",
                "transformers>=4.44","accelerate","datasets","bitsandbytes","huggingface_hub"])
import torch, re, json, random
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
from datasets import load_dataset
from huggingface_hub import login, HfApi

login("hf_xxxxxxxx")                      # <-- your HF WRITE token (RunPod: no kaggle secrets)
TARGET = 2500                             # rows to build (up from 1000)

# Generator: on a 24GB+ GPU you can afford a stronger model for better Khmer.
# Qwen2.5-14B-Instruct (4-bit ~9GB) is ungated + strong. For even better Khmer,
# try SeaLLMs/SeaLLMs-v3-7B-Chat (SEA-tuned) if you accept its license, or drop
# to Qwen2.5-7B-Instruct on a 16GB card.
GEN = "Qwen/Qwen2.5-14B-Instruct"
tok = AutoTokenizer.from_pretrained(GEN)
model = AutoModelForCausalLM.from_pretrained(GEN, device_map="auto",
    quantization_config=BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_compute_dtype=torch.bfloat16))

# ---- Khmer source paragraphs (clean, factual). Wikipedia is convenient; mix in
# your own notes as extra contexts for domain-relevant Q&A. ----
wiki = load_dataset("wikimedia/wikipedia", "20231101.km", split="train")
paras = []
for art in wiki:
    for p in art["text"].split("\n"):
        p = p.strip()
        if 200 <= len(p) <= 1200: paras.append(p)
    if len(paras) >= TARGET*3: break
random.shuffle(paras)
print("candidate paragraphs:", len(paras), flush=True)

# ---- Task types: mix extractive + fuller answers so the SFT isn't only terse.
# Each = (name, instruction, few-shot, grounding threshold). Answers are Khmer. ----
TASKS = [
  ("extract",
   "បង្កើតសំណួរខ្លីមួយ ដែលចម្លើយស្ថិតនៅក្នុងអត្ថបទ ហើយផ្តល់ចម្លើយខ្លីត្រឹមត្រូវ (ពាក្យ ឬឃ្លា)។",
   'អត្ថបទ៖ ភ្នំពេញ គឺជារាជធានីរបស់ប្រទេសកម្ពុជា។\n'
   '{"question":"តើរាជធានីរបស់កម្ពុជាឈ្មោះអ្វី?","answer":"ភ្នំពេញ"}\n', 0.9),
  ("explain",
   "បង្កើតសំណួរ 'ហេតុអ្វី' ឬ 'យ៉ាងណា' មួយ ហើយឆ្លើយជា ១-៣ ប្រយោគ ដោយផ្អែកលើអត្ថបទតែប៉ុណ្ណោះ។",
   'អត្ថបទ៖ ទន្លេសាបហូរបញ្ច្រាសនៅរដូវវស្សា ដោយសារទឹកទន្លេមេគង្គឡើងខ្ពស់ រុញទឹកចូលបឹង។\n'
   '{"question":"ហេតុអ្វីទឹកទន្លេសាបហូរបញ្ច្រាសនៅរដូវវស្សា?","answer":"ដោយសារនៅរដូវវស្សា ទឹកទន្លេមេគង្គឡើងខ្ពស់ ហើយរុញទឹកឲ្យហូរបញ្ច្រាសចូលបឹងទន្លេសាប។"}\n', 0.45),
  ("summarize",
   "សង្ខេបខ្លឹមសារនៃអត្ថបទ ជា ១-២ ប្រយោគ។ សំណួរគឺ 'តើអត្ថបទនេះនិយាយអំពីអ្វី?'។",
   'អត្ថបទ៖ អង្គរវត្ត ជាប្រាសាទដ៏ធំ សាងសង់នៅសតវត្សទី១២ ជានិមិត្តរូបនៃប្រទេសកម្ពុជា។\n'
   '{"question":"តើអត្ថបទនេះនិយាយអំពីអ្វី?","answer":"អត្ថបទនិយាយអំពីប្រាសាទអង្គរវត្ត ដែលសាងសង់នៅសតវត្សទី១២ និងជានិមិត្តរូបរបស់កម្ពុជា។"}\n', 0.5),
]

SYS = ("អ្នកជាជំនួយការបង្កើតទិន្នន័យ។ ប្រើតែព័ត៌មានក្នុងអត្ថបទ។ កុំបង្កើតព័ត៌មានថ្មី។ "
       "ឆ្លើយជា JSON តែមួយបន្ទាត់ ដែលមាន key 'question' និង 'answer'។")

# grounding via char 5-gram overlap: extractive answers overlap ~fully; paraphrased
# answers must still share most of their content with the context (blocks made-up facts).
def shingles(s, n=5):
    s = re.sub(r"\s+", "", s or "")
    return {s[i:i+n] for i in range(max(0, len(s)-n+1))}
def grounded(ans, ctx, thr):
    a = shingles(ans)
    return bool(a) and len(a & shingles(ctx)) / len(a) >= thr

def gen_one(para, task):
    name, instr, fewshot, thr = task
    user = (f"{instr}\n\nឧទាហរណ៍៖\n{fewshot}\n"
            f"ឥឡូវនេះ សម្រាប់អត្ថបទខាងក្រោម ឆ្លើយជា JSON តែមួយបន្ទាត់៖\nអត្ថបទ៖ {para}\n")
    msgs = [{"role":"system","content":SYS},{"role":"user","content":user}]
    enc = tok.apply_chat_template(msgs, add_generation_prompt=True, return_tensors="pt", return_dict=True)
    enc = {k: v.to(model.device) for k, v in enc.items()}
    with torch.no_grad():
        out = model.generate(**enc, max_new_tokens=256, do_sample=True, temperature=0.7, top_p=0.9)
    txt = tok.decode(out[0][enc["input_ids"].shape[1]:], skip_special_tokens=True)
    m = re.search(r"\{.*\}", txt, re.S)
    if not m: return None
    try:
        j = json.loads(m.group(0))
    except Exception:
        return None
    q, a = str(j.get("question","")).strip(), str(j.get("answer","")).strip()
    if len(q) < 5 or len(a) < 2: return None
    if len(a) > len(para) + 80: return None          # answer shouldn't dwarf context
    if not grounded(a, para, thr): return None       # anti-hallucination
    return {"context": para, "question": q, "answer": a, "type": name}

rows, i = [], 0
for para in paras:
    task = TASKS[i % len(TASKS)]; i += 1              # cycle tasks for balance
    r = gen_one(para, task)
    if r: rows.append(r)
    if len(rows) and len(rows) % 50 == 0: print(len(rows), "rows", flush=True)
    if len(rows) >= TARGET: break

from collections import Counter
print("by type:", Counter(r["type"] for r in rows), flush=True)
json.dump(rows, open("khmer_qa.json","w"), ensure_ascii=False, indent=1)

api = HfApi()
api.create_repo("sengtha/khmer-qa", repo_type="dataset", exist_ok=True)
api.upload_file(path_or_fileobj="khmer_qa.json", path_in_repo="data.json",
                repo_id="sengtha/khmer-qa", repo_type="dataset")
print("DONE ->", len(rows), "rows to sengtha/khmer-qa (data.json)")
```

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
