# iAny Khmer Tiny — Fine-Tuning Guide

Goal: turn `google/gemma-3-270m-it` (the Tiny tier's base model) into
**iAny Khmer Tiny** — a 270M model that answers grounded RAG questions in
correct, simple Khmer. It stays small enough to run on every phone iAny
supports, and deploys to all users through the existing model mirror.

**Why two stages:** the base 270M cannot write Khmer at all. Q&A examples
alone teach a *task*, not a *language* — so we first teach the language
with raw Khmer text (continued pretraining), then teach the task with Q&A
pairs (supervised fine-tuning).

**Budget & timeline:** ~US$50–150 of rented GPU + API credits total.
Elapsed effort ≈ 2–4 weekends, most of it data review — the part only a
native Khmer speaker (you) can do. Expect a v1 → judge → v2 loop.

**Expected result (honest):** short, grammatical, extractive-style Khmer
answers that stick to the provided context, cite `[1]`/`[2]`, and refuse
when the answer is absent. NOT expected: reasoning, synthesis across many
documents, or eloquent prose — it remains a 270M model.

---

## Stage 0 — Setup

You need:

- A machine with Python 3.11+ for data preparation (any laptop).
- A rented GPU for training: one 24 GB card is ample for a 270M model.
  Easiest options: **Google Colab Pro** (~$10/mo, pick an A100/L4 runtime)
  or **RunPod / Lambda** (~$0.4–0.8/hr; total training is a few hours).
- A Hugging Face account (to download the base model; accept the Gemma
  license on the `google/gemma-3-270m-it` page once).
- `wrangler` logged into your Cloudflare account (for the final upload —
  you already have this from iAny deploys).

```bash
pip install -U "transformers>=4.49" trl datasets accelerate peft sentencepiece
```

> All training snippets below are starting points — pin exact versions
> when you begin, and prefer Google's official Gemma fine-tuning recipes
> (ai.google.dev/gemma/docs → "Fine-tuning") if APIs have drifted.

---

## Stage 1 — Teach it Khmer (continued pretraining)

### 1.1 Collect a raw Khmer corpus (target: 300 MB – 2 GB of clean text)

Good open sources, roughly in order of quality:

| Source | What | How |
|---|---|---|
| Khmer Wikipedia | Clean encyclopedic Khmer | `datasets.load_dataset("wikimedia/wikipedia", "20231101.km")` (use latest dump) |
| CulturaX / HPLT `km` subset | Web text, large | `load_dataset("uonlp/CulturaX", "km")` |
| SEA-LION corpus (AI Singapore) | Curated SEA-language web/news | see `aisingapore` on Hugging Face |
| Openly licensed Khmer books/news | Highest quality | manual collection; verify licenses |
| Your own iAny documents | Domain-matching | export a pack, extract text |

### 1.2 Clean it

Quality of this corpus matters more than quantity. Minimum pipeline:

- Keep documents that are ≥70% Khmer script (`[ក-៿]` ratio).
- Drop boilerplate (menus, cookie banners), deduplicate near-identical
  documents (e.g. MinHash via `datasets`' `deduplicate` recipes).
- Normalize: Unicode NFC, strip zero-width chars, collapse whitespace.
- **Your review:** skim ~50 random documents. If a page reads like junk
  to you, write a filter rule for its pattern and re-run. Two or three
  such passes transform the corpus.

Save as one JSONL: `{"text": "..."}` per line → `corpus_km.jsonl`.

### 1.3 Train (continued pretraining)

A 270M model over ~0.5–1B tokens is **hours** on one GPU. Keep ~10–20%
English text mixed in (e.g. a slice of FineWeb-Edu) so it doesn't forget
English.

```python
from transformers import AutoModelForCausalLM, AutoTokenizer, TrainingArguments
from trl import SFTTrainer
from datasets import load_dataset

base = "google/gemma-3-270m-it"
tok = AutoTokenizer.from_pretrained(base)
model = AutoModelForCausalLM.from_pretrained(base, torch_dtype="bfloat16")

data = load_dataset("json", data_files="corpus_km.jsonl", split="train")

trainer = SFTTrainer(
    model=model,
    train_dataset=data,
    args=TrainingArguments(
        output_dir="ckpt-cpt",
        per_device_train_batch_size=8,
        gradient_accumulation_steps=4,
        learning_rate=1e-4,          # full fine-tune; the model is tiny
        num_train_epochs=1,
        bf16=True,
        logging_steps=50,
        save_steps=2000,
    ),
    # SFTTrainer packs raw text when no chat template is applied
    dataset_text_field="text",
    max_seq_length=2048,
)
trainer.train()
trainer.save_model("gemma-270m-km-base")
```

**Sanity check before proceeding:** load the checkpoint and prompt it with
the start of a Khmer sentence. It should *continue in plausible Khmer*.
If it produces script soup, train longer / clean the corpus harder. Do
not move to Stage 2 until this passes — SFT cannot fix a base that can't
write the language.

---

## Stage 2 — Teach it the job (supervised fine-tuning)

### 2.1 Generate the Q&A dataset (target: 5k–20k examples)

Use a **large open-weights teacher** whose license permits training on
its outputs — e.g. `google/gemma-4-E4B-it` or a hosted large Gemma.
(Avoid closed APIs whose terms restrict training on outputs — that would
encumber your dataset forever.)

For each cleaned Khmer document, chunk it exactly like iAny does
(~1,200 chars), then ask the teacher to produce examples in **this exact
schema** (matching `src/rag/ask.ts`'s prompt):

```json
{
  "context": "[1] (ចំណងជើង)\n<chunk text>\n\n[2] (…)\n<chunk text>",
  "question": "<Khmer question a real user would ask>",
  "answer": "<short Khmer answer, citing [1]/[2]>"
}
```

Teacher prompt sketch (give it the chunk, ask for 2–3 triples):

> អ្នកជាគ្រូបង្កើតទិន្នន័យ។ ដោយផ្អែកលើអត្ថបទខាងក្រោម បង្កើតសំណួរ ៣
> ដែលអ្នកប្រើប្រាស់ពិតៗអាចសួរ និងចម្លើយខ្លីៗ ត្រឹមត្រូវ ជាភាសាខ្មែរ
> ដោយដកស្រង់ពីអត្ថបទប៉ុណ្ណោះ ហើយបញ្ជាក់ប្រភពជា [1]…

Mix in, deliberately:

- **~25% "not in context" negatives** — question whose answer is absent;
  gold answer = a short Khmer refusal ("ខ្ញុំមិនទាន់មានព័ត៌មាននេះទេ…").
  This kills the invent-an-answer failure mode you saw.
- **~20% English examples** (same schema) to keep English working.
- **A few hundred mixed-language cases** (Khmer question over English
  context and vice versa).

### 2.2 Review — the step that decides the quality

Sample **300–500 examples** and judge them yourself: is the question
natural? is the answer correct Khmer and actually grounded in the
context? Expect to discard/fix 10–30%. Every systematic error you find,
encode as a filter or a better teacher prompt and regenerate. Your hours
here are worth more than any hyperparameter.

Hold out **~100 examples as the evaluation set** — never trained on.
This becomes iAny's permanent Khmer benchmark for all future models.

### 2.3 Train (SFT on the Stage-1 checkpoint)

Format each example through Gemma's chat template with iAny's real
prompt wrapper (copy `buildPrompt` from `src/rag/ask.ts` so training
matches inference exactly — same headers, same `--- CONTEXT ---` fences):

```python
def to_messages(ex):
    user = IANY_PROMPT_TEMPLATE.format(context=ex["context"], question=ex["question"])
    return {"messages": [
        {"role": "user", "content": user},
        {"role": "assistant", "content": ex["answer"]},
    ]}
```

Train with the same `SFTTrainer` setup, starting from
`gemma-270m-km-base`, `learning_rate=2e-5`, 2–3 epochs. Minutes to an
hour of GPU time. Save as `iany-khmer-tiny-v1`.

---

## Stage 3 — Evaluate

1. Run the 100 held-out questions through the model with iAny's exact
   prompt. A simple script that prints `question / gold / model answer`
   side by side is enough.
2. **You grade each**: ✅ correct & readable Khmer · 🟡 partly right ·
   ❌ wrong/hallucinated/broken. Track three numbers: accuracy on
   answerable questions, refusal rate on negatives, Khmer readability.
3. Compare against the stock model (which will score ~0) and against the
   extractive fallback (quoting passages). **Ship only if it beats the
   extractive fallback in your judgment** — otherwise iterate: more/cleaner
   Stage-1 corpus and better Stage-2 examples are the levers, in that order.

---

## Stage 4 — Convert for the browser

Export to ONNX with quantization (same formats the app already uses):

```bash
pip install -U "optimum[onnxruntime]" onnx onnxruntime
optimum-cli export onnx --model ./iany-khmer-tiny-v1 --task text-generation-with-past ./onnx-out
python -m onnxruntime.quantization.preprocess  # then quantize:
#   q4  -> webgpu   (matmul 4-bit; see onnx-community repos for reference configs)
#   q8  -> wasm/CPU (dynamic int8)
```

The practical reference: mirror the file layout of
`onnx-community/gemma-3-270m-it-ONNX` (config.json, tokenizer files,
`onnx/model_q4.onnx`, `onnx/model_quantized.onnx` — plus `*_data`
side-files if produced). Same layout in = zero app-side surprises.

**Smoke-test locally before deploying:** load the quantized model in
Node with `@huggingface/transformers` pointing at the local folder and
run one Khmer generation. Quantization occasionally breaks a fine-tune;
catch it here, not on users' phones.

---

## Stage 5 — Deploy through iAny's mirror

The mirror serves whatever exists in R2 and only falls through to
upstream on a miss — so a custom model is just objects in the bucket:

```bash
# key layout must match: <model-id>/<file>   (no HF involved)
MODEL_ID="iany/khmer-tiny-v1"
for f in config.json generation_config.json tokenizer.json tokenizer_config.json \
         onnx/model_q4.onnx onnx/model_quantized.onnx; do
  npx wrangler r2 object put "iany-models/$MODEL_ID/$f" --file "onnx-out/$f"
done
```

Then in the app (I'll do this part when your model is ready):

1. Add `iany/khmer-tiny-v1/` to `ALLOWED_PREFIXES` in `worker/index.ts`.
2. Add a `GEN_MODELS` entry (`cpuOk: true`, `minBytes` ~80 MB) — it slots
   into the existing tier UI, resumable downloads, crash recovery and
   model sharing automatically.
3. Remove the Khmer extractive fallback in `src/rag/ask.ts` for this
   model (or keep it as the no-results path).
4. Re-run the Stage-3 eval **on a phone** before announcing.

---

## Checklist

- [ ] Stage 0: GPU access + HF account + Gemma license accepted
- [ ] Stage 1: corpus collected → cleaned → reviewed (50-doc skim × 2)
- [ ] Stage 1: CPT trained → "continues Khmer sensibly" sanity check
- [ ] Stage 2: teacher chosen (open weights!) → 5k+ examples generated
- [ ] Stage 2: 300+ examples personally reviewed; 100 held out for eval
- [ ] Stage 2: SFT trained
- [ ] Stage 3: eval graded; beats extractive fallback → else iterate
- [ ] Stage 4: ONNX q4 + q8 exported; local Node smoke test passes
- [ ] Stage 5: uploaded to R2; app registry updated; on-phone eval

## Pitfalls learned in advance

- **Don't skip the Stage-1 sanity check.** SFT on a Khmer-illiterate base
  produces confident garbage — the failure you already know.
- **Closed-API teachers poison the dataset's license.** Open-weights
  teacher = dataset stays yours forever, reusable for every future base
  (Gemma 4 tiny, Qwen, anything).
- **Train with the exact inference prompt.** A mismatch between training
  format and `buildPrompt` silently costs more quality than any
  hyperparameter.
- **Keep every artifact**: corpus, generation prompts, dataset, eval set,
  training configs. The dataset is the asset; models are re-pressings.
