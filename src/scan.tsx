import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider, useI18n } from './i18n'
import { ContributeOcrView } from './views/ContributeOcrView'
import './styles.css'

/**
 * Standalone "Khmer Scan" page (served at /scan) — a separate route from the
 * iAny app, like /voice, so a community OCR-data drive isn't confused with the
 * knowledge-base product. Light shell (header + language toggle) around the
 * shared ContributeOcrView.
 */
function ScanApp() {
  const { lang, setLang } = useI18n()
  const km = lang === 'km'
  return (
    <div className="voice-shell">
      <header className="voice-topbar">
        <div className="voice-brand">
          <span aria-hidden>📷</span>
          <div>
            <h1>{km ? 'អានអក្សរខ្មែរ' : 'Khmer Scan'}</h1>
            <p>{km ? 'ជួយបង្កើត OCR ខ្មែរបើកចំហ' : 'Help build an open Khmer OCR'}</p>
          </div>
        </div>
        <button className="voice-lang" onClick={() => setLang(km ? 'en' : 'km')}>
          {km ? 'EN' : 'ខ្មែរ'}
        </button>
      </header>

      <main className="voice-main">
        <ContributeOcrView />
      </main>
    </div>
  )
}

createRoot(document.getElementById('scan-root')!).render(
  <StrictMode>
    <I18nProvider>
      <ScanApp />
    </I18nProvider>
  </StrictMode>,
)
