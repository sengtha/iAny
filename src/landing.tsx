import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { I18nProvider } from './i18n'
import { LandingView } from './views/LandingView'
import './landing.css'

// Register the service worker from the front page too, so a visitor can install
// iAny straight from here and the app shell is warm before they open it.
registerSW({ immediate: true })

createRoot(document.getElementById('landing-root')!).render(
  <StrictMode>
    <I18nProvider>
      <LandingView />
    </I18nProvider>
  </StrictMode>,
)
