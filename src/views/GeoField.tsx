import { useState } from 'react'
import { useI18n } from '../i18n'
import { getLocation, type GeoPoint } from '../lib/geo'

/**
 * Shared "Add location" control for the mapping collectors. Optional by design —
 * a contributor taps to attach an (approximate) GPS point that turns their photo
 * into a map point (litter map / species sighting / civic report).
 */
export function GeoField({ gps, onChange }: { gps: GeoPoint | null; onChange: (g: GeoPoint | null) => void }) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)

  async function locate() {
    setBusy(true)
    onChange(await getLocation())
    setBusy(false)
  }

  return (
    <div className="trace-gps">
      {gps ? (
        <>
          <button className="voice-ghost" onClick={() => onChange(null)}>📍 {t('geoClear')}</button>
          <span>{gps.lat}, {gps.lng} (±{gps.acc}m)</span>
        </>
      ) : (
        <button className="voice-ghost" disabled={busy} onClick={locate}>
          📍 {busy ? `${t('geoLocating')}…` : t('geoAdd')}
        </button>
      )}
    </div>
  )
}
