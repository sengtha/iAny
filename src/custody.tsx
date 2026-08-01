import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider, useI18n } from './i18n'
import { CustodyConsoleView } from './views/CustodyConsoleView'
import './styles.css'

/**
 * Standalone Trace **companion console** (served at /custody) — the B2B tool for
 * supply-chain actors (delivery, warehouse, exporter) to join a product's proof
 * with device-signed chain-of-custody events. Kept separate from the consumer
 * /trace page, like /voice and /sign. See trace/core/companion.ts.
 */
function CustodyApp() {
  const { lang, setLang } = useI18n()
  const km = lang === 'km'
  return (
    <div className="voice-shell">
      <header className="voice-topbar">
        <div className="voice-brand">
          <span aria-hidden>🚚</span>
          <div>
            <h1>{km ? 'ខ្សែសង្វាក់ចរាចរណ៍' : 'Trace Custody'}</h1>
            <p>{km ? 'ក្រុមហ៊ុនដឹកជញ្ជូន · ឃ្លាំង · នាំចេញ' : 'Delivery · warehouse · exporter proof'}</p>
          </div>
        </div>
        <button className="voice-lang" onClick={() => setLang(km ? 'en' : 'km')}>
          {km ? 'EN' : 'ខ្មែរ'}
        </button>
      </header>

      <main className="voice-main">
        <CustodyConsoleView />
      </main>
    </div>
  )
}

createRoot(document.getElementById('custody-root')!).render(
  <StrictMode>
    <I18nProvider>
      <CustodyApp />
    </I18nProvider>
  </StrictMode>,
)
