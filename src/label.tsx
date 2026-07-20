import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider, useI18n } from './i18n'
import { LabelReaderView } from './views/LabelReaderView'
import './styles.css'

/**
 * Standalone "Label reader" page (served at /label) — reads the Cambodian
 * product-registration code (ច.ប.ផ) off a packaged product with the app's
 * on-device Khmer OCR + a parser (see src/lib/cbfCode.ts). Separate route, like
 * /scan and /braille (both also OCR-based tools).
 */
function LabelApp() {
  const { lang, setLang } = useI18n()
  const km = lang === 'km'
  return (
    <div className="voice-shell">
      <header className="voice-topbar">
        <div className="voice-brand">
          <span aria-hidden>🏷️</span>
          <div>
            <h1>{km ? 'អានស្លាក ច.ប.ផ' : 'Label reader'}</h1>
            <p>{km ? 'អានលេខចុះបញ្ជីផលិតផល ក្រៅបណ្ដាញ' : 'Read the ច.ប.ផ registration code, offline'}</p>
          </div>
        </div>
        <button className="voice-lang" onClick={() => setLang(km ? 'en' : 'km')}>
          {km ? 'EN' : 'ខ្មែរ'}
        </button>
      </header>

      <main className="voice-main">
        <LabelReaderView />
      </main>
    </div>
  )
}

createRoot(document.getElementById('label-root')!).render(
  <StrictMode>
    <I18nProvider>
      <LabelApp />
    </I18nProvider>
  </StrictMode>,
)
