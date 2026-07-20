import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider, useI18n } from './i18n'
import { ContributeHealthTestView } from './views/ContributeHealthTestView'
import './styles.css'

/**
 * Standalone "Rapid-test photos" page (served at /health-test) — a community
 * collector for RDT result-strip photos, feeding an offline RDT reader (reads the
 * result line, not a diagnosis; see docs/HEALTH-AI.md). Separate route, like /crop.
 */
function HealthTestApp() {
  const { lang, setLang } = useI18n()
  const km = lang === 'km'
  return (
    <div className="voice-shell">
      <header className="voice-topbar">
        <div className="voice-brand">
          <span aria-hidden>🧪</span>
          <div>
            <h1>{km ? 'រូបតេស្តរហ័ស' : 'Rapid-test photos'}</h1>
            <p>{km ? 'ជួយបង្កើត AI អានលទ្ធផលតេស្ត បើកចំហ' : 'Help build an open test-reading AI'}</p>
          </div>
        </div>
        <button className="voice-lang" onClick={() => setLang(km ? 'en' : 'km')}>
          {km ? 'EN' : 'ខ្មែរ'}
        </button>
      </header>

      <main className="voice-main">
        <ContributeHealthTestView />
      </main>
    </div>
  )
}

createRoot(document.getElementById('health-test-root')!).render(
  <StrictMode>
    <I18nProvider>
      <HealthTestApp />
    </I18nProvider>
  </StrictMode>,
)
