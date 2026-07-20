import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider, useI18n } from './i18n'
import { ContributeReportView } from './views/ContributeReportView'
import './styles.css'

/**
 * Standalone "Community report" page (served at /report) — a geotagged civic /
 * environment issue collector, feeding an offline report-sorting classifier and a
 * community-usable map dataset (see docs/ENVIRONMENT-AI.md).
 */
function ReportApp() {
  const { lang, setLang } = useI18n()
  const km = lang === 'km'
  return (
    <div className="voice-shell">
      <header className="voice-topbar">
        <div className="voice-brand">
          <span aria-hidden>📣</span>
          <div>
            <h1>{km ? 'របាយការណ៍សហគមន៍' : 'Community report'}</h1>
            <p>{km ? 'រាយការណ៍បញ្ហា ជួយសហគមន៍ និង AI បើកចំហ' : 'Report issues — help the community + open AI'}</p>
          </div>
        </div>
        <button className="voice-lang" onClick={() => setLang(km ? 'en' : 'km')}>
          {km ? 'EN' : 'ខ្មែរ'}
        </button>
      </header>

      <main className="voice-main">
        <ContributeReportView />
      </main>
    </div>
  )
}

createRoot(document.getElementById('report-root')!).render(
  <StrictMode>
    <I18nProvider>
      <ReportApp />
    </I18nProvider>
  </StrictMode>,
)
