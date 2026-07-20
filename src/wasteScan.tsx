import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider, useI18n } from './i18n'
import { WasteScanView } from './views/WasteScanView'
import './styles.css'

/**
 * Standalone "Waste scan" experiment (served at /waste-scan) — point the camera
 * at an item, see its material classified live on-device (the /waste-trained
 * model via onnxruntime-web). A try-it tool for everyone, like /traffic; the
 * consent-gated collector for improving the model lives at /waste.
 */
function WasteScanApp() {
  const { lang, setLang } = useI18n()
  const km = lang === 'km'
  return (
    <div className="voice-shell">
      <header className="voice-topbar">
        <div className="voice-brand">
          <span aria-hidden>♻️</span>
          <div>
            <h1>{km ? 'ស្កេនសំរាម' : 'Waste scan'}</h1>
            <p>{km ? 'ស្គាល់ប្រភេទសម្ភារៈ ក្រៅបណ្ដាញ' : 'Identify the material, on-device & offline'}</p>
          </div>
        </div>
        <button className="voice-lang" onClick={() => setLang(km ? 'en' : 'km')}>
          {km ? 'EN' : 'ខ្មែរ'}
        </button>
      </header>

      <main className="voice-main">
        <WasteScanView />
      </main>
    </div>
  )
}

createRoot(document.getElementById('waste-scan-root')!).render(
  <StrictMode>
    <I18nProvider>
      <WasteScanApp />
    </I18nProvider>
  </StrictMode>,
)
