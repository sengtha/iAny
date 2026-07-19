# iAny — open Khmer models

All of iAny's Khmer models are published on Hugging Face and downloaded on-device
(mirrored through the app's `/models` proxy). Browse everything — including
training iterations and work-in-progress — on the profile:

### 👉 https://huggingface.co/sengtha

Part of iAny's mission is to **release the best Khmer models open source, with the
community and for the community.** The community data collectors (`/voice`,
`/scan`, `/sign`) feed the next versions.

## Models used in iAny

| Model | Purpose | Format | Used by | Base / lineage |
|---|---|---|---|---|
| [sengtha/iany-khmer-tiny-v1-ONNX](https://huggingface.co/sengtha/iany-khmer-tiny-v1-ONNX) | Khmer answering LLM (~270M, the small default) | ONNX | PWA (Transformers.js) | Gemma 270M (Gemma Terms) |
| [sengtha/Qwen3-0.6B-khm-ft3-Q8_0-GGUF](https://huggingface.co/sengtha/Qwen3-0.6B-khm-ft3-Q8_0-GGUF) | Khmer answering LLM | GGUF (Q4/Q8) | Mobile (llama.rn) | Qwen3-0.6B (Apache-2.0) |
| [sengtha/whisper-tiny-khmer](https://huggingface.co/sengtha/whisper-tiny-khmer) | Khmer speech-to-text (STT) | GGML + CT2 + ONNX | App + mobile (whisper.rn) | Whisper tiny (MIT) |
| [sengtha/khmer-tts-female-v2](https://huggingface.co/sengtha/khmer-tts-female-v2) | Khmer text-to-speech (female voice) | ONNX (VITS) | App (Radio + TTS) | VITS · DDD-Cambodia (CC-BY-SA-4.0) |
| [sengtha/khmer-ocr](https://huggingface.co/sengtha/khmer-ocr) | Khmer OCR — detector + recognizer | ONNX | App + mobile | seanghay/KhmerOCR (MIT) |
| MediaPipe Hand Landmarker | Hand tracking for the `/sign` collector | `.task` | `/sign` | Google (Apache-2.0) — mirrored from Google's model storage, no HF repo needed |

> **Licensing:** each Hugging Face repo card is the authoritative source for that
> model's license. The lineage column shows what the model is derived from.
> Models and datasets carry their own licenses — separate from iAny's Apache-2.0
> **code** license (see `NOTICE`).

## Datasets

### Released by iAny (from community contributions)

Open Khmer data collected through the community tools, released **CC-BY-SA-4.0**
with opt-in contributor credit:

- 🎤 **[sengtha/iany-khmer-voice](https://huggingface.co/datasets/sengtha/iany-khmer-voice)**
  — Khmer read speech (audio + transcript) from [`/voice`](https://iany.app/voice),
  for training open Khmer STT. **Live now** and growing as people contribute; it's
  folded into the whisper-base fine-tune (see `docs/RUNPOD-KHMER-STT.md`).
- 📷 `/scan` (Khmer OCR) and 🤟 `/sign` (Khmer Sign Language landmarks) — collecting
  now, to be released the same way.

### External data used

- [DDD-Cambodia/khmer-speech-dataset](https://huggingface.co/datasets/DDD-Cambodia/khmer-speech-dataset) — CC-BY-SA-4.0 (TTS/STT)
- [seanghay/km-speech-corpus](https://huggingface.co/datasets/seanghay/km-speech-corpus) — CC-BY-4.0 (STT)
- [Sokheng/khmer-synthetic-ocr-v1-100k](https://huggingface.co/datasets/Sokheng/khmer-synthetic-ocr-v1-100k) — CC-BY-4.0 (OCR)

## Help improve them

Every recording, photo, and sign contributed makes the next model better:

- 🎤 **[iany.app/voice](https://iany.app/voice)** — read Khmer aloud (STT)
- 📷 **[iany.app/scan](https://iany.app/scan)** — photograph + correct Khmer text (OCR)
- 🤟 **[iany.app/sign](https://iany.app/sign)** — sign Khmer words (Sign Language)
