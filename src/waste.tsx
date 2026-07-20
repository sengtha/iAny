import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider, useI18n } from './i18n'
import { ContributeWasteView } from './views/ContributeWasteView'
import './styles.css'

/**
 * Standalone "Waste sort" page (served at /waste) — a community collector for
 * waste/recyclable item photos, feeding an offline waste-type classifier
 * (recycling education + sorting help; see docs/ENVIRONMENT-AI.md). Separate route,
 * like /crop and /water.
 */
function WasteApp() {
  const { lang, setLang } = useI18n()
  const km = lang === 'km'
  return (
    <div className="voice-shell">
      <header className="voice-topbar">
        <div className="voice-brand">
          <span aria-hidden>♻️</span>
          <div>
            <h1>{km ? 'តម្រៀបសំរាម' : 'Waste sort'}</h1>
            <p>{km ? 'ជួយបង្កើត AI ចាត់ថ្នាក់សំណល់ បើកចំហ' : 'Help build an open waste-sorting AI'}</p>
          </div>
        </div>
        <button className="voice-lang" onClick={() => setLang(km ? 'en' : 'km')}>
          {km ? 'EN' : 'ខ្មែរ'}
        </button>
      </header>

      <main className="voice-main">
        <ContributeWasteView />
      </main>
    </div>
  )
}

createRoot(document.getElementById('waste-root')!).render(
  <StrictMode>
    <I18nProvider>
      <WasteApp />
    </I18nProvider>
  </StrictMode>,
)
