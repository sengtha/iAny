/// <reference lib="webworker" />
/**
 * Khmer STT worker (PWA) — runs whisper-tiny-khmer (ONNX) via transformers.js
 * on WASM, off the UI thread. Receives 16 kHz mono float samples and returns
 * the transcribed Khmer text. Weights download once through the model mirror
 * and are cached by the browser Cache API, so it works offline afterward.
 *
 * Heavier than the mobile GGML path (fp32 encoder+decoder), so the UI only
 * offers the mic on desktop/tablet (fine-pointer) devices.
 */
import {
  env,
  pipeline,
  type AutomaticSpeechRecognitionPipeline,
} from '@huggingface/transformers'
import { STT_MODEL_ID } from '../types'

if (env.backends.onnx?.wasm) {
  env.backends.onnx.wasm.wasmPaths = `${self.location.origin}/ort/`
}
// Weights come from this origin's pull-through mirror (huggingface.co is often
// unreachable on client devices; Cloudflare's network isn't). Never probe for
// local models — the SPA fallback answers every URL with index.html.
env.allowLocalModels = false
env.remoteHost = `${self.location.origin}/models`

type InMsg =
  | { type: 'load' }
  | { type: 'transcribe'; id: string; audio: Float32Array }

let asr: Promise<AutomaticSpeechRecognitionPipeline> | null = null

function load(): Promise<AutomaticSpeechRecognitionPipeline> {
  if (!asr) {
    asr = pipeline('automatic-speech-recognition', STT_MODEL_ID, {
      device: 'wasm',
      dtype: 'fp32', // the repo ships fp32 onnx (encoder_model + decoder_model_merged)
      progress_callback: (p: unknown) => self.postMessage({ type: 'progress', progress: p }),
    })
  }
  return asr
}

self.onmessage = async (e: MessageEvent<InMsg>) => {
  const msg = e.data
  try {
    if (msg.type === 'load') {
      await load()
      self.postMessage({ type: 'ready' })
      return
    }
    if (msg.type === 'transcribe') {
      const transcriber = await load()
      // chunk_length_s lets the pipeline handle clips longer than Whisper's 30 s
      // window (it slices + stitches); short queries are unaffected.
      // no_repeat_ngram_size + condition_on_previous_text:false stop the tiny
      // model's repetition loops ("long repeated Khmer letters" on quiet audio).
      const out = await transcriber(msg.audio, {
        language: 'km',
        task: 'transcribe',
        chunk_length_s: 30,
        stride_length_s: 5,
        no_repeat_ngram_size: 3,
      })
      const text = Array.isArray(out)
        ? out.map((o) => o.text).join(' ')
        : (out as { text: string }).text
      self.postMessage({ type: 'result', id: msg.id, text: (text ?? '').trim() })
    }
  } catch (err) {
    const id = 'id' in msg ? msg.id : ''
    self.postMessage({ type: 'error', id, error: err instanceof Error ? err.message : String(err) })
  }
}
