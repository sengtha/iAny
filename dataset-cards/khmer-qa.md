---
license: cc-by-sa-4.0
language:
- km
task_categories:
- question-answering
- text-generation
tags:
- khmer
- question-answering
- instruction-tuning
- sft
- synthetic
- rag
- iany
size_categories:
- 1K<n<10K
pretty_name: Khmer Q&A (context-grounded)
---

# Khmer Q&A — context-grounded (khmer-qa)

An open **Khmer question-answering / instruction-tuning** dataset for fine-tuning Khmer answering LLMs. Each example is a `(context, question, answer)` triple where the answer is **grounded in the context** — ideal for teaching a model to answer from retrieved passages (RAG-style), in Khmer.

Built for **[iAny](https://iany.app)**, the offline, on-device Khmer AI platform, and released open source. It's used to SFT iAny's on-device Khmer LLM (and can train larger models from the **same** data).

## What's in it

A single file, **`data.json`** — a JSON array of ~**2,500** rows:

| Field | Type | Description |
|---|---|---|
| `context` | string | a factual Khmer paragraph (the grounding source) |
| `question` | string | a Khmer question about the context |
| `answer` | string | the Khmer answer — a short span **or** a 1–3 sentence explanation/summary |
| `type` | string | task type: `extract` · `explain` · `summarize` |

The **mix of task types** is deliberate: an earlier extractive-only set made models answer too tersely (single-word spans). This set adds fuller `explain`/`summarize` answers so an SFT teaches the model to answer *completely*, not just grab a word.

Example:
```json
{
  "context": "ភ្នំពេញ គឺជារាជធានីរបស់ប្រទេសកម្ពុជា។",
  "question": "តើរាជធានីរបស់កម្ពុជាឈ្មោះអ្វី?",
  "answer": "ភ្នំពេញ",
  "type": "extract"
}
```

## How it was built

- **Source passages:** clean factual paragraphs from **Khmer Wikipedia** (`wikimedia/wikipedia`, `20231101.km`).
- **Q&A generation:** synthesized by **Qwen2.5-Instruct** (7B / 14B) with few-shot Khmer prompts, one prompt per task type.
- **Grounding filter:** each answer must overlap the context by a character-5-gram threshold (strict for `extract`, looser for `explain`/`summarize`), which blocks made-up facts while allowing paraphrase.

Full recipe: [github.com/sengtha/iAny · docs/BUILD-KHMER-QA-DATASET.md](https://github.com/sengtha/iAny/blob/main/docs/BUILD-KHMER-QA-DATASET.md).

## Load it

```python
from datasets import load_dataset
ds = load_dataset(
    "json",
    data_files="https://huggingface.co/datasets/sengtha/khmer-qa/resolve/main/data.json",
    split="train",
)
print(ds[0])
```

## Intended use

**Supervised fine-tuning (SFT) / instruction-tuning** of Khmer LLMs to answer grounded in a provided context. Format a training prompt from `context` + `question` and target `answer`; the `type` field is for analysis/balancing and can be ignored by the trainer.

## Limitations & responsible use

- **Synthetic.** Answers are model-generated (grounded on Wikipedia, not human-verified) — expect some noise despite the grounding filter. Review a sample before relying on it.
- **Domain:** general/encyclopedic (Khmer Wikipedia). Mix in your own domain passages for domain-specific Q&A.
- Not a benchmark or a source of ground-truth facts — it's SFT training data.

## License & attribution

Released under **CC-BY-SA-4.0**: the `context` passages derive from **Khmer Wikipedia** (CC-BY-SA-4.0), so the dataset inherits it and share-alike — **attribute Wikipedia** and share derivatives alike. Q&A generated with **Qwen2.5** (Apache-2.0). Built and released by **[iAny](https://iany.app)** (E-KHMER Technology).
