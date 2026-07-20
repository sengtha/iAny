import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { TraceApp } from '../trace/web/TraceApp'
import type { OcrAdapter, SttAdapter } from '../trace/web/adapters'
import { createMediapipeMatcher } from '../trace/web/mediapipeMatcher'
import { khmerOcr } from './ai/khmerOcr'
import { khmerStt } from './ai/khmerStt'
import './styles.css'

/**
 * iAny's host for the standalone Trace app (served at /trace). Trace itself
 * lives in ../trace and knows nothing about iAny; here we inject iAny's
 * on-device Khmer OCR + STT as optional capabilities.
 */
const ocr: OcrAdapter = { recognizeImage: (b) => khmerOcr.recognizeImage(b) }

// The chat STT is gated to desktop for latency; Trace's one-off voice story is
// fine on phones, so we only require a microphone here.
const micSupported = () =>
  typeof navigator !== 'undefined' &&
  !!navigator.mediaDevices?.getUserMedia &&
  typeof WebAssembly !== 'undefined'

const stt: SttAdapter = {
  supported: micSupported,
  subscribe: (cb) => khmerStt.subscribe((s) => cb({ phase: s.phase, download: s.download })),
  startRecording: () => khmerStt.startRecording(),
  stopAndTranscribe: () => khmerStt.stopAndTranscribe(),
}

// Optional "better matching": MediaPipe Image Embedder (Apache-2.0, ~4 MB),
// mirrored through iAny's /models proxy and the shared MediaPipe vision WASM
// (public/mediapipe, copied by scripts/copy-ort.mjs — same as /sign). Lazy: it
// only downloads when the user turns the toggle on; the classical match is the
// zero-download default.
const matcher = createMediapipeMatcher({
  wasmPath: `${location.origin}/mediapipe`,
  modelUrl: `${location.origin}/models/sengtha/mediapipe-embed/resolve/main/mobilenet_v3_small.tflite`,
  sizeMb: 4,
})

createRoot(document.getElementById('trace-root')!).render(
  <StrictMode>
    <TraceApp ocr={ocr} stt={stt} matcher={matcher} />
  </StrictMode>,
)
