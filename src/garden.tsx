import { StrictMode, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider, useI18n } from './i18n'
import { getLocation } from './lib/geo'
import { GardenView } from './views/GardenView'
import './styles.css'

/**
 * Standalone "Garden" page (served at /garden) — create signed, verifiable
 * garden/tree observations on-device (the Grove protocol, see grove/SPEC.md). The
 * phone is the source of truth; records are exportable to any node / CamboVerse.
 */
function GardenApp() {
  const { lang, setLang } = useI18n()
  const km = lang === 'km'
  const [locationEnabled, setLocationEnabled] = useState(false)
  const [locationBusy, setLocationBusy] = useState(false)
  const [locationStatus, setLocationStatus] = useState('')
  const locationRequestId = useRef(0)

  async function toggleLocation() {
    locationRequestId.current += 1
    const requestId = locationRequestId.current
    if (locationEnabled) {
      setLocationEnabled(false)
      setLocationStatus(km ? 'ការប្រើទីតាំងក្នុងសួនបានបិទ។ ការអនុញ្ញាតក្នុងកម្មវិធីរុករកមិនបានផ្លាស់ប្តូរ។' : 'Garden location use is off. Browser permission is unchanged.')
      return
    }
    setLocationBusy(true)
    setLocationStatus('')
    const { point, error } = await getLocation()
    if (requestId !== locationRequestId.current) return
    setLocationBusy(false)
    setLocationEnabled(!!point)
    setLocationStatus(point
      ? (km ? `បានបើកទីតាំង (±${point.acc} ម)។ កត់ត្រាទីតាំងដើមឈើនីមួយៗនៅខាងក្រោម។` : `Location on (±${point.acc} m). Record each tree's location below.`)
      : error === 'denied'
        ? (km ? 'ការចូលប្រើទីតាំងត្រូវបានបដិសេធ។ បើកវាក្នុងការកំណត់កម្មវិធីរុករក។' : 'Location denied. Enable it in your browser or phone settings.')
        : (km ? 'មិនអាចរកទីតាំងបានទេ។ សូមសាកល្បងម្ដងទៀត។' : 'Could not get a location. Try again outdoors.'))
  }
  return (
    <div className="voice-shell">
      <header className="voice-topbar">
        <div className="voice-brand">
          <span aria-hidden>🌳</span>
          <div>
            <h1>{km ? 'សួន' : 'Garden'}</h1>
            <p>{km ? 'កំណត់ត្រាកាបូនសួន ចុះហត្ថលេខាលើឧបករណ៍' : 'Signed garden-carbon records, on your device'}</p>
          </div>
        </div>
        <div className="garden-header-actions">
          <button className="voice-lang garden-location-toggle" onClick={toggleLocation} disabled={locationBusy} aria-pressed={locationEnabled}>
            {locationBusy ? (km ? 'កំពុងរកទីតាំង…' : 'Locating…') : locationEnabled ? (km ? '📍 ទីតាំង: បើក' : '📍 Location: On') : (km ? '📍 ទីតាំង: បិទ' : '📍 Location: Off')}
          </button>
          <button className="voice-lang" onClick={() => setLang(km ? 'en' : 'km')}>
            {km ? 'EN' : 'ខ្មែរ'}
          </button>
        </div>
      </header>
      {locationStatus ? <p className="garden-header-status" role="status">{locationStatus}</p> : null}

      <main className="voice-main">
        <GardenView locationEnabled={locationEnabled} />
      </main>
    </div>
  )
}

createRoot(document.getElementById('garden-root')!).render(
  <StrictMode>
    <I18nProvider>
      <GardenApp />
    </I18nProvider>
  </StrictMode>,
)
