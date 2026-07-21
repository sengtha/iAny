import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider, useI18n } from './i18n'
import { CropScanView } from './views/CropScanView'
import './styles.css'

/**
 * Standalone "Crop scan" experiment (served at /crop-scan) — point the camera at a
 * leaf, see its crop + health condition classified live on-device (the /crop-trained
 * model via onnxruntime-web). A try-it tool for everyone, like /waste-scan; the
 * consent-gated collector for improving the model lives at /crop.
 */
function CropScanApp() {
  const { lang, setLang } = useI18n()
  const km = lang === 'km'
  return (
    <div className="voice-shell">
      <header className="voice-topbar">
        <div className="voice-brand">
          <span aria-hidden>🌱</span>
          <div>
            <h1>{km ? 'ស្កេនដំណាំ' : 'Crop scan'}</h1>
            <p>{km ? 'ស្គាល់ដំណាំ និងសុខភាព ក្រៅបណ្ដាញ' : 'Identify crop + health, on-device & offline'}</p>
          </div>
        </div>
        <button className="voice-lang" onClick={() => setLang(km ? 'en' : 'km')}>
          {km ? 'EN' : 'ខ្មែរ'}
        </button>
      </header>

      <main className="voice-main">
        <CropScanView />
      </main>
    </div>
  )
}

createRoot(document.getElementById('crop-scan-root')!).render(
  <StrictMode>
    <I18nProvider>
      <CropScanApp />
    </I18nProvider>
  </StrictMode>,
)
