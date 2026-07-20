import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider, useI18n } from './i18n'
import { ContributeWaterView } from './views/ContributeWaterView'
import './styles.css'

/**
 * Standalone "Water test" page (served at /water) — a community collector for
 * water-quality test-strip photos, feeding an offline strip reader (safe / caution
 * / unsafe — guidance, not a certified measurement; see docs/ENVIRONMENT-AI.md).
 * Separate route, like /crop and /health-test.
 */
function WaterApp() {
  const { lang, setLang } = useI18n()
  const km = lang === 'km'
  return (
    <div className="voice-shell">
      <header className="voice-topbar">
        <div className="voice-brand">
          <span aria-hidden>💧</span>
          <div>
            <h1>{km ? 'តេស្តទឹក' : 'Water test'}</h1>
            <p>{km ? 'ជួយបង្កើត AI ពិនិត្យគុណភាពទឹក បើកចំហ' : 'Help build an open water-quality AI'}</p>
          </div>
        </div>
        <button className="voice-lang" onClick={() => setLang(km ? 'en' : 'km')}>
          {km ? 'EN' : 'ខ្មែរ'}
        </button>
      </header>

      <main className="voice-main">
        <ContributeWaterView />
      </main>
    </div>
  )
}

createRoot(document.getElementById('water-root')!).render(
  <StrictMode>
    <I18nProvider>
      <WaterApp />
    </I18nProvider>
  </StrictMode>,
)
