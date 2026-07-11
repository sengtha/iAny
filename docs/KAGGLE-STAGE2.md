# Kaggle Walkthrough — Stage 2 (Teach the RAG Task)

Fine-tunes your Stage-1 model (`sengtha/gemma-270m-km-base-v2`) to do
iAny's actual job: given Khmer context + a question, produce a **grounded
Khmer answer** that cites `[1]`, extracts from the context, and **refuses**
when the answer isn't present.

Key design: the training **answers are extracted verbatim from real Khmer
Wikipedia**, so they are perfect Khmer by construction. The model learns
to locate and quote the right passage — the ideal behavior for a tiny
model, and far easier than free-form generation (where Stage 1 struggled).
No teacher model needed for v1 — questions are templated, answers are real.

Same Kaggle setup as Stage 1 (GPU T4, Internet On, `HF_TOKEN` = **write**
token secret). Run as a **Save Version → Save & Run All** batch job.

---

## Cell 0 — single GPU
```python
import os
os.environ["CUDA_VISIBLE_DEVICES"] = "0"
```

## Cell 1 — install
```python
!pip install -q -U "transformers>=4.49" "trl>=0.12" datasets accelerate peft sentencepiece
import torch
name = torch.cuda.get_device_name(0); print("GPU:", name)
BF16_OK = ("A100" in name) or ("H100" in name)
```

## Cell 2 — login (secret, works in batch)
```python
from kaggle_secrets import UserSecretsClient
from huggingface_hub import login
login(UserSecretsClient().get_secret("HF_TOKEN"))
```

## Cell 3 — build the RAG training set (extractive, real Khmer)
```python
from datasets import load_dataset, Dataset
import re, random
random.seed(42)

wiki = load_dataset("wikimedia/wikipedia", "20231101.km", split="train")

def sentences(t):
    return [s.strip() for s in re.split(r'(?<=។)\s*', t) if len(s.strip()) > 20]

Q_TEMPLATES = [
    "តើ {t} គឺជាអ្វី?",
    "សូមពន្យល់អំពី {t}។",
    "{t} មានលក្ខណៈយ៉ាងណា?",
    "តើ {t} សំខាន់យ៉ាងណា?",
]
REFUSAL = "ខ្ញុំមិនមានព័ត៌មាននេះនៅក្នុងឯកសារទេ។"

articles = [a for a in wiki if len(a["text"]) > 300]
titles = [a["title"] for a in articles]
examples = []
for a in articles:
    title = a["title"]
    sents = sentences(re.sub(r"\s+", " ", a["text"]))
    if len(sents) < 2:
        continue
    context = f"[1] {title}\n" + " ".join(sents[:4])[:600]
    answer = "យោងតាម [1] " + " ".join(sents[:2])[:300]
    examples.append({
        "context": context,
        "question": random.choice(Q_TEMPLATES).format(t=title),
        "answer": answer,
    })
    # ~25% "not in context" negatives -> teach refusal (kills hallucination)
    if random.random() < 0.25:
        other = random.choice(titles)
        if other != title:
            examples.append({
                "context": context,
                "question": random.choice(Q_TEMPLATES).format(t=other),
                "answer": REFUSAL,
            })

random.shuffle(examples)
print("examples:", len(examples))
print(examples[0])
```

## Cell 4 — load the Stage-1 model (v2) as the base
```python
from transformers import AutoModelForCausalLM, AutoTokenizer
import torch
BASE = "sengtha/gemma-270m-km-base-v2"    # <-- your Stage 1 result
tok = AutoTokenizer.from_pretrained(BASE)
model = AutoModelForCausalLM.from_pretrained(BASE, dtype=torch.bfloat16 if BF16_OK else torch.float32)
print("loaded", BASE)
```

## Cell 5 — format + supervised fine-tune
```python
from datasets import Dataset
from trl import SFTTrainer, SFTConfig

# The prompt iAny will send at inference — keep training and inference identical.
PROMPT = "បរិបទ៖\n{context}\n\nសំណួរ៖ {question}\nចម្លើយ៖"

def to_chat(ex):
    return {"messages": [
        {"role": "user", "content": PROMPT.format(context=ex["context"], question=ex["question"])},
        {"role": "assistant", "content": ex["answer"]},
    ]}

ds = Dataset.from_list(examples).map(to_chat, remove_columns=["context","question","answer"])

cfg = SFTConfig(
    output_dir="/kaggle/working/sft", per_device_train_batch_size=4,
    gradient_accumulation_steps=8, learning_rate=2e-5,   # lower LR for SFT
    lr_scheduler_type="cosine", warmup_ratio=0.05, num_train_epochs=3,
    bf16=BF16_OK, fp16=not BF16_OK, logging_steps=50, save_steps=500,
    save_total_limit=1, max_length=1024, report_to="none",
)
SFTTrainer(model=model, train_dataset=ds, args=cfg).train()
```

## Cell 6 — save the finished model
```python
model.push_to_hub("iany-khmer-tiny-v1", private=True)
tok.push_to_hub("iany-khmer-tiny-v1", private=True)
```

## Cell 7 — RAG sanity check (the real test)
```python
from transformers import pipeline
gen = pipeline("text-generation", model=model, tokenizer=tok, device=0)
PROMPT = "បរិបទ៖\n{context}\n\nសំណួរ៖ {question}\nចម្លើយ៖"

tests = [
  {"context": "[1] ភ្នំពេញ\nភ្នំពេញ គឺជារាជធានីនៃប្រទេសកម្ពុជា។ វាមានប្រជាជនប្រមាណពីរលាននាក់។",
   "question": "តើ ភ្នំពេញ គឺជាអ្វី?"},
  {"context": "[1] អង្គរវត្ត\nអង្គរវត្ត គឺជាប្រាសាទដ៏ធំបំផុតនៅលើពិភពលោក ស្ថិតនៅខេត្តសៀមរាប។",
   "question": "តើ អង្គរវត្ត ស្ថិតនៅឯណា?"},
  # a question whose answer is NOT in the context -> should refuse
  {"context": "[1] ភ្នំពេញ\nភ្នំពេញ គឺជារាជធានីនៃប្រទេសកម្ពុជា។",
   "question": "តើ ចិន មានប្រជាជនប៉ុន្មាន?"},
]
for t in tests:
    p = PROMPT.format(**t)
    out = gen(p, max_new_tokens=80, do_sample=False)[0]["generated_text"]
    print("Q:", t["question"])
    print("A:", out[len(p):].strip(), "\n---")
```

---

## What "good" looks like

- **Q1/Q2:** answers in coherent Khmer that quote the context and start
  with `យោងតាម [1]`. Since answers are extractive, the Khmer should be
  clean (it's copied from real text).
- **Q3 (absent):** the refusal sentence, NOT an invented answer. This is
  the most important behavior — it proves the model won't hallucinate.

Size/time: ~15k examples × 3 epochs ≈ 1,400 steps ≈ **4–5 hours** on T4.
Fits the 12h batch limit comfortably.

## If it works → deploy

Tell me and I'll: (1) export `iany-khmer-tiny-v1` to ONNX q4/q8
(embedding layer excluded from q4 — see FINETUNE-KHMER.md), (2) upload to
your R2 bucket, (3) register it as a Settings tier and switch the Khmer
tiny path from the extractive fallback to this model. The app's Khmer
prompt (`buildPrompt`) gets aligned to the `PROMPT` above.

## Iterating (v2 of the RAG model, later)

The templated questions make v1 strongest on definitional questions. To
broaden it: use an open teacher (large Gemma) to generate diverse Khmer
questions per chunk, review a few hundred, mix with the extractive set,
retrain. Keep the ~25% refusal negatives — they are what stop
hallucination. The evaluation set you build is the permanent benchmark.
