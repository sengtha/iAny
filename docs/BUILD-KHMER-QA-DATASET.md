# Build a Khmer Q&A dataset for SFT (fixes grounded answering)

The CPT-only fine-tune reads Khmer but picks the wrong answer span (it answered
"គណបក្សសង្គម" for "what is the author's name?"). The fix is **Stage B SFT** on
`{context, question, answer}` rows — but you need that data. This notebook
**synthesizes it**: a strong instruction model reads Khmer paragraphs and writes
a grounded Khmer question + short answer for each.

Runs free on **Kaggle T4**. ~1000 rows in ~1–1.5h. Output → an HF dataset you
attach to the fine-tune's Stage B.

## Setup
New Kaggle notebook, **GPU T4**, Internet **On**, `HF_TOKEN` in **Secrets**.

## The notebook

```python
import subprocess, sys, json
subprocess.run([sys.executable,"-m","pip","install","-q",
                "transformers>=4.44","accelerate","datasets","bitsandbytes"])
from kaggle_secrets import UserSecretsClient
HF_TOKEN = UserSecretsClient().get_secret("HF_TOKEN")

import torch, re
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
from datasets import load_dataset
from huggingface_hub import login, HfApi
login(HF_TOKEN)

TARGET = 1000
# Generator: strong multilingual instruct model, 4-bit so it fits a T4.
# Qwen2.5-7B is ungated + reliable. For better Khmer try SeaLLMs/SeaLLMs-v3-7B-Chat
# or google/gemma-2-9b-it (accept their license on HF first).
GEN = "Qwen/Qwen2.5-7B-Instruct"
tok = AutoTokenizer.from_pretrained(GEN)
model = AutoModelForCausalLM.from_pretrained(GEN, device_map="auto",
    quantization_config=BitsAndBytesConfig(load_in_4bit=True,
        bnb_4bit_compute_dtype=torch.float16))

# Khmer source paragraphs (Wikipedia — clean, factual; good for Q&A).
wiki = load_dataset("wikimedia/wikipedia", "20231101.km", split="train")
paras = []
for art in wiki:
    for p in art["text"].split("\n"):
        p = p.strip()
        if 200 <= len(p) <= 1000: paras.append(p)
    if len(paras) >= TARGET*3: break
print("candidate paragraphs:", len(paras))

# Few-shot in Khmer so the generator returns grounded, short answers as JSON.
FEWSHOT = (
 'អត្ថបទ៖ ភ្នំពេញ គឺជារាជធានី និងជាទីក្រុងធំជាងគេបំផុតរបស់ប្រទេសកម្ពុជា។\n'
 '{"question": "តើរាជធានីរបស់ប្រទេសកម្ពុជាមានឈ្មោះអ្វី?", "answer": "ភ្នំពេញ"}\n\n'
 'អត្ថបទ៖ អង្គរវត្ត ត្រូវបានសាងសង់ឡើងនៅសតវត្សទី១២ ក្នុងរជ្ជកាលព្រះបាទសូរ្យវរ្ម័នទី២។\n'
 '{"question": "តើអង្គរវត្តត្រូវបានសាងសង់នៅសតវត្សទីប៉ុន្មាន?", "answer": "សតវត្សទី១២"}\n\n')
INSTR = ("បង្កើតសំណួរមួយជាភាសាខ្មែរ ដែលចម្លើយមាននៅក្នុងអត្ថបទ ហើយផ្តល់ចម្លើយខ្លីត្រឹមត្រូវ។ "
         "ឆ្លើយជា JSON តែមួយបន្ទាត់៖\n\n")

def gen_qa(para):
    msgs = [{"role": "user", "content": INSTR + FEWSHOT + "អត្ថបទ៖ " + para + "\n"}]
    inp = tok.apply_chat_template(msgs, add_generation_prompt=True, return_tensors="pt").to(model.device)
    with torch.no_grad():
        out = model.generate(inp, max_new_tokens=160, do_sample=True, temperature=0.7, top_p=0.9)
    txt = tok.decode(out[0][inp.shape[1]:], skip_special_tokens=True)
    m = re.search(r'\{.*\}', txt, re.S)
    if not m: return None
    try:
        j = json.loads(m.group(0))
        q, a = str(j.get("question","")).strip(), str(j.get("answer","")).strip()
        # keep only grounded, sane pairs
        if 5 <= len(q) and 1 <= len(a) < len(para) and a in para:
            return {"context": para, "question": q, "answer": a}
    except Exception:
        return None
    return None

rows = []
for para in paras:
    r = gen_qa(para)
    if r: rows.append(r)
    if len(rows) and len(rows) % 50 == 0: print(len(rows), "rows", flush=True)
    if len(rows) >= TARGET: break

json.dump(rows, open("khmer_qa.json","w"), ensure_ascii=False, indent=1)
print("BUILT", len(rows), "Q&A rows")

api = HfApi(token=HF_TOKEN)
api.create_repo("sengtha/khmer-qa", repo_type="dataset", exist_ok=True)
api.upload_file(path_or_fileobj="khmer_qa.json", path_in_repo="data.json",
                repo_id="sengtha/khmer-qa", repo_type="dataset")
print("DONE -> sengtha/khmer-qa (data.json)")
```

## Then: fine-tune WITH Stage B

- **Kaggle fine-tune** (`FINETUNE-QWEN-KHMER.md`): **Add Data →** attach the
  `sengtha/khmer-qa` dataset. Stage B auto-detects `data.json` and runs SFT.
- **RunPod fine-tune** (`RUNPOD-QWEN-KHMER.md`): set `QA_REPO = "sengtha/khmer-qa"`.

That SFT is what makes the model answer *correctly* — it learns to pull the right
span (the name, the date, the number) instead of a random context word.

## Notes / how to make it better
- **`a in para` filter** keeps only *grounded* answers (the answer text actually
  appears in the context) — exactly the extraction skill iAny needs.
- **Better generator = better data.** Qwen2.5-7B is fine; SeaLLMs-v3 / Gemma-2-9B
  have stronger Khmer if you accept their licenses.
- **Mix in your own real notes** as contexts for domain-relevant Q&A.
- **Scale:** a few hundred rows already helps; 1–3k is solid. Raise `TARGET`.
- **Combine with CPT:** the best model = CPT (fluency) **then** this SFT (answering)
  — which the fine-tune notebook already does in order when the Q&A data is present.
