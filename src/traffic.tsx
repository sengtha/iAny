import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider, useI18n } from './i18n'
import { TrafficView } from './views/TrafficView'
import { createTrafficDetector } from './lib/trafficDetector'
import './styles.css'

/**
 * Standalone "Traffic" page (served at /traffic) — a smart-city live vehicle +
 * people counter. On-device object detection (MediaPipe EfficientDet, ~4.6 MB,
 * mirrored via /models and the shared vision WASM), fully offline after the first
 * model download. See docs/SMARTCITY-AI.md.
 */
const detector = createTrafficDetector({
  wasmPath: `${location.origin}/mediapipe`,
  // _f32 filename = a fresh mirror/R2 key, so the switch from the int8 model
  // (which the GPU delegate couldn't detect with) fetches the float32 bytes.
  modelUrl: `${location.origin}/models/sengtha/mediapipe-detector/resolve/main/efficientdet_lite0_f32.tflite`,
})

function TrafficApp() {
  const { lang, setLang } = useI18n()
  const km = lang === 'km'
  return (
    <div className="voice-shell">
      <header className="voice-topbar">
        <div className="voice-brand">
          <span aria-hidden>🚦</span>
          <div>
            <h1>{km ? 'ចរាចរណ៍' : 'Traffic'}</h1>
            <p>{km ? 'រាប់យានយន្ត និងស្ថានភាពចរាចរណ៍ ក្រៅបណ្ដាញ' : 'Count vehicles + traffic status, offline'}</p>
          </div>
        </div>
        <button className="voice-lang" onClick={() => setLang(km ? 'en' : 'km')}>
          {km ? 'EN' : 'ខ្មែរ'}
        </button>
      </header>

      <main className="voice-main">
        <TrafficView detector={detector} />
      </main>
    </div>
  )
}

createRoot(document.getElementById('traffic-root')!).render(
  <StrictMode>
    <I18nProvider>
      <TrafficApp />
    </I18nProvider>
  </StrictMode>,
)
