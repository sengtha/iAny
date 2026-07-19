import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider, useI18n } from './i18n'
import { TraceView } from './views/TraceView'
import './styles.css'

/**
 * Standalone "iAny Trace" page (served at /trace) — keyless, offline
 * proof-of-origin as a trust score. Separate route like /voice, /scan.
 */
function TraceApp() {
  const { lang, setLang } = useI18n()
  const km = lang === 'km'
  return (
    <div className="voice-shell">
      <header className="voice-topbar">
        <div className="voice-brand">
          <span aria-hidden>🔖</span>
          <div>
            <h1>{km ? 'iAny Trace — ប្រភពដើម' : 'iAny Trace'}</h1>
            <p>{km ? 'ភស្តុតាងប្រភពដើម ក្រៅបណ្ដាញ ១០០%' : 'Offline proof of origin — a trust score'}</p>
          </div>
        </div>
        <button className="voice-lang" onClick={() => setLang(km ? 'en' : 'km')}>
          {km ? 'EN' : 'ខ្មែរ'}
        </button>
      </header>
      <main className="voice-main">
        <TraceView />
      </main>
    </div>
  )
}

createRoot(document.getElementById('trace-root')!).render(
  <StrictMode>
    <I18nProvider>
      <TraceApp />
    </I18nProvider>
  </StrictMode>,
)
