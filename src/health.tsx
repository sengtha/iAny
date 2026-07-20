import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider, useI18n } from './i18n'
import { HealthView } from './views/HealthView'
import './styles.css'

/**
 * Standalone "Khmer Health" page (served at /health) — offline health EDUCATION
 * (curated topics + read-aloud). Information only, never diagnosis (see
 * docs/HEALTH-AI.md). Separate route from the app, like /voice and /crop.
 */
function HealthApp() {
  const { lang, setLang } = useI18n()
  const km = lang === 'km'
  return (
    <div className="voice-shell">
      <header className="voice-topbar">
        <div className="voice-brand">
          <span aria-hidden>🩺</span>
          <div>
            <h1>{km ? 'សុខភាពខ្មែរ' : 'Khmer Health'}</h1>
            <p>{km ? 'ព័ត៌មានសុខភាព ក្រៅបណ្ដាញ — មិនមែនការវិនិច្ឆ័យ' : 'Offline health info — not a diagnosis'}</p>
          </div>
        </div>
        <button className="voice-lang" onClick={() => setLang(km ? 'en' : 'km')}>
          {km ? 'EN' : 'ខ្មែរ'}
        </button>
      </header>

      <main className="voice-main">
        <HealthView />
      </main>
    </div>
  )
}

createRoot(document.getElementById('health-root')!).render(
  <StrictMode>
    <I18nProvider>
      <HealthApp />
    </I18nProvider>
  </StrictMode>,
)
