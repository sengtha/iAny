---
license: cc-by-sa-4.0
language:
- km
library_name: transformers
pipeline_tag: automatic-speech-recognition
base_model: openai/whisper-base
tags:
- whisper
- khmer
- speech-to-text
- asr
- onnx
- ggml
- on-device
- iany
datasets:
- DDD-Cambodia/khmer-speech-dataset
- sengtha/iany-khmer-voice
metrics:
- cer
- wer
model-index:
- name: whisper-base-khmer
  results:
  - task:
      type: automatic-speech-recognition
      name: Khmer Speech Recognition
    dataset:
      name: FLEURS (km_kh)
      type: google/fleurs
      config: km_kh
      split: test
    metrics:
    - type: cer
      value: 22.8
      name: CER (space-normalized)
    - type: cer
      value: 23.9
      name: CER (raw)
---

# whisper-base-khmer

A **Khmer speech-to-text (STT)** model — [`openai/whisper-base`](https://huggingface.co/openai/whisper-base) fine-tuned on Khmer speech. Built for **[iAny](https://iany.app)**, the offline, on-device Khmer AI platform, and released open source so anyone can build Khmer voice tools.

> Runs fully **on-device / offline** in the [iAny](https://iany.app) app and mobile app. Part of iAny's mission: *the best open Khmer AI, with the community and for the community.*

## What it does

Transcribes spoken **Khmer** audio (16 kHz mono) into Khmer text. Multilingual Whisper already knows Khmer; this fine-tune sharpens it on real Khmer corpora + community phone/room audio.

## Formats in this repo

| Format | Files | For |
|---|---|---|
| **PyTorch / Transformers** | `model.safetensors`, `config.json`, tokenizer | training, server, research |
| **ONNX** | `onnx/encoder_model.onnx`, `onnx/decoder_model_merged.onnx` | **browser / PWA** (Transformers.js) |
| **GGML** | `ggml-base-khmer-q5_1.bin` | **mobile / edge** (whisper.cpp / whisper.rn) |

(CTranslate2 for faster-whisper can be produced with `ct2-transformers-converter`.)

## Usage

**🤗 Transformers**
```python
from transformers import pipeline
asr = pipeline("automatic-speech-recognition", model="sengtha/whisper-base-khmer",
               chunk_length_s=30, generate_kwargs={"language": "km", "task": "transcribe"})
print(asr("audio.wav")["text"])
```

**Transformers.js (in the browser)**
```js
import { pipeline } from '@huggingface/transformers'
const asr = await pipeline('automatic-speech-recognition', 'sengtha/whisper-base-khmer', { dtype: 'fp32' })
const { text } = await asr(audioFloat32Array, { language: 'km', task: 'transcribe' })
```

**whisper.cpp (GGML, on mobile/edge)**
```bash
./whisper-cli -m ggml-base-khmer-q5_1.bin -l km -f audio.wav
```

## Training data

- **[DDD-Cambodia/khmer-speech-dataset](https://huggingface.co/datasets/DDD-Cambodia/khmer-speech-dataset)** — large multi-speaker Khmer read speech (CC-BY-SA-4.0).
- **[sengtha/iany-khmer-voice](https://huggingface.co/datasets/sengtha/iany-khmer-voice)** — real phone/room audio contributed at [iany.app/voice](https://iany.app/voice) (CC-BY-SA-4.0), **oversampled** so the model weights real-world conditions. This set grows with community contributions, and the model is periodically retrained.

## Evaluation

Character Error Rate (CER) is the meaningful metric for Khmer; report **space-normalized** CER since Khmer has no word spaces and Whisper inserts them. WER is not meaningful for Khmer (ambiguous word segmentation).

| Test set | CER (space-normalized) | CER (raw) |
|---|---|---|
| **FLEURS `km_kh` test** (standard benchmark, out-of-domain read speech) | **~22.8** | ~23.9 |
| In-domain dev (training corpora) | **~19** | — |

FLEURS is clean, formal read speech with foreign proper nouns, so it's a **harder, out-of-domain** stress test — treat it as a comparability anchor, not a ceiling.

## Limitations

- Best on **clear, careful speech**; spontaneous/noisy phone audio in a room is harder for a base-size model. More community `/voice` data + retraining is the path to better real-world accuracy.
- Weak on **numbers** and **embedded English/proper nouns**.
- On low-confidence audio it can emit byte-fallback characters (rare); downstream apps may strip U+FFFD.

## Intended use & responsible use

Voice input, dictation aids, transcription, and Khmer accessibility tools. It is an aid, not a certified transcription service — review output where accuracy matters.

## License & attribution

Released under **CC-BY-SA-4.0**, inherited from the DDD-Cambodia training data. **You must credit DDD-Cambodia** and share derivatives alike. The base model `openai/whisper-base` is MIT.

## Citation / credit

Trained and released by **[iAny](https://iany.app)** (E-KHMER Technology). Thanks to DDD-Cambodia and every contributor at [iany.app/voice](https://iany.app/voice). Training recipe: [github.com/sengtha/iAny · docs/RUNPOD-KHMER-STT.md](https://github.com/sengtha/iAny/blob/main/docs/RUNPOD-KHMER-STT.md).
