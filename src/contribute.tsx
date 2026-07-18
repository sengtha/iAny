import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { I18nProvider } from './i18n'
import { ContributePageView } from './views/ContributePageView'
import './landing.css'

// Register the service worker so a visitor can install iAny from this page too.
registerSW({ immediate: true })

createRoot(document.getElementById('contribute-root')!).render(
  <StrictMode>
    <I18nProvider>
      <ContributePageView />
    </I18nProvider>
  </StrictMode>,
)
