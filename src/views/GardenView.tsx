import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../i18n'
import { getLocation, type GeoPoint } from '../lib/geo'
import {
  createObservation,
  loadObservations,
  loadPlots,
  photoHashOf,
  estimateCarbon,
  exportBundle,
  type GardenObservation,
  type Measure,
} from '../../grove/web/store'

/**
 * 🌳 Garden (/garden) — create **signed, verifiable** garden/tree observations on
 * your phone (the source of truth). Measure a plant → estimate its CO₂ → sign it
 * with your device key. Records are stored locally and exportable to any node /
 * dashboard / CamboVerse. See grove/SPEC.md. Estimates, not certified credits.
 */
const SPECIES = ['mango', 'coconut', 'jackfruit', 'longan', 'guava', 'tamarind', 'teak', 'banana', 'other']
const SP_KM: Record<string, string> = {
  mango: 'ស្វាយ', coconut: 'ដូង', jackfruit: 'ខ្នុរ', longan: 'មៀន', guava: 'ត្របែក',
  tamarind: 'អំពិល', teak: 'ម៉ៃសាក់', banana: 'ចេក', other: 'ផ្សេង',
}

export function GardenView() {
  const { lang } = useI18n()
  const km = lang === 'km'
  const [obs, setObs] = useState<GardenObservation[]>(() => loadObservations())
  const [plot, setPlot] = useState(() => loadPlots()[0] ?? 'home-garden-01')
  const [species, setSpecies] = useState('mango')
  const [count, setCount] = useState(1)
  const [dbh, setDbh] = useState('')
  const [height, setHeight] = useState('')
  const [gps, setGps] = useState<GeoPoint | null>(null)
  const [locating, setLocating] = useState(false)
  const [image, setImage] = useState<Blob | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])

  const measure: Measure = useMemo(() => {
    const d = parseFloat(dbh), h = parseFloat(height)
    if (d > 0 && h > 0) return { method: 'dbh_height', dbh_cm: d, height_m: h }
    if (d > 0) return { method: 'dbh', dbh_cm: d }
    if (h > 0) return { method: 'height', height_m: h }
    return { method: 'manual', biomassKg: 0 }
  }, [dbh, height])

  const est = useMemo(() => {
    const per = estimateCarbon(measure, species)
    return { per: per.co2Kg, total: Math.round(per.co2Kg * Math.max(1, count) * 100) / 100 }
  }, [measure, species, count])

  const totalCo2 = useMemo(() => Math.round(obs.reduce((s, o) => s + o.co2Kg, 0) * 100) / 100, [obs])

  async function onPick(file: File) {
    setError('')
    const scaled = await downscale(file, 1280)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setImage(scaled)
    setPreviewUrl(URL.createObjectURL(scaled))
  }

  async function addLocation() {
    setLocating(true)
    setGps(await getLocation())
    setLocating(false)
  }

  async function save() {
    if (!image) { setError(km ? 'សូមថតរូបរុក្ខជាតិជាមុន' : 'Take a photo of the plant first'); return }
    if (measure.method === 'manual') { setError(km ? 'បញ្ចូលទំហំ (អង្កត់ផ្ចិត ឬកម្ពស់)' : 'Enter a size (trunk width or height)'); return }
    setSaving(true)
    setError('')
    try {
      const photoHash = await photoHashOf(image)
      await createObservation({
        plot: plot.trim() || 'home-garden-01',
        species, count: Math.max(1, count), measure,
        gps, observedAt: new Date().toISOString(), photoHash,
      })
      setObs(loadObservations())
      // reset the item, keep the plot
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      setImage(null); setPreviewUrl(''); setDbh(''); setHeight(''); setCount(1)
      if (fileRef.current) fileRef.current.value = ''
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setSaving(false)
  }

  function download() {
    const blob = new Blob([exportBundle()], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'grove-garden.json'
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  return (
    <div className="contribute garden">
      <p className="contribute-lead">
        {km
          ? 'កត់ត្រារុក្ខជាតិក្នុងសួនរបស់អ្នក — វាស់ ប៉ាន់ស្មាន CO₂ ហើយចុះហត្ថលេខាលើឧបករណ៍អ្នក។ ការប៉ាន់ស្មាន មិនមែនក្រេឌីតកាបូនផ្លូវការ។'
          : 'Log the plants in your garden — measure, estimate CO₂, and sign it on your device. Estimates, not certified carbon credits.'}
      </p>

      <div className="garden-summary">
        <div><b>{obs.length}</b> {km ? 'កំណត់ត្រា' : 'records'}</div>
        <div><b>{totalCo2}</b> kg CO₂ {km ? 'ប៉ាន់ស្មាន' : 'estimated'}</div>
      </div>

      <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void onPick(f) }} />

      {!image ? (
        <div className="ocr-drop" onClick={() => fileRef.current?.click()}>
          <div className="ocr-drop-icon">🌳</div>
          <div className="ocr-drop-title">{km ? 'ថតរូបរុក្ខជាតិ / ដើមឈើ' : 'Photograph a plant / tree'}</div>
          <div className="ocr-drop-sub">{km ? 'ដើមមួយក្នុងមួយកំណត់ត្រា' : 'one plant per record'}</div>
        </div>
      ) : (
        <>
          <img className="ocr-preview" src={previewUrl} alt="" />

          <label className="voice-field">
            <span>{km ? 'ប្រភេទ' : 'Species'}</span>
            <div className="crop-chips">
              {SPECIES.map((s) => (
                <button key={s} type="button" className={species === s ? 'active' : ''} onClick={() => setSpecies(s)}>
                  {km ? SP_KM[s] : s}
                </button>
              ))}
            </div>
          </label>

          <div className="garden-measure">
            <label className="voice-field">
              <span>{km ? 'អង្កត់ផ្ចិតដើម (សម) នៅ ១.៣ម' : 'Trunk width (cm) at 1.3 m'}</span>
              <input type="number" inputMode="decimal" min="0" value={dbh} placeholder="e.g. 20"
                onChange={(e) => setDbh(e.target.value)} />
            </label>
            <label className="voice-field">
              <span>{km ? 'កម្ពស់ (ម)' : 'Height (m)'}</span>
              <input type="number" inputMode="decimal" min="0" value={height} placeholder="e.g. 8"
                onChange={(e) => setHeight(e.target.value)} />
            </label>
            <label className="voice-field">
              <span>{km ? 'ចំនួន' : 'Count'}</span>
              <input type="number" inputMode="numeric" min="1" value={count}
                onChange={(e) => setCount(Math.max(1, parseInt(e.target.value) || 1))} />
            </label>
          </div>

          <div className="garden-est">
            ≈ <b>{est.total}</b> kg CO₂ {count > 1 ? <small>({est.per} × {count})</small> : null}
          </div>

          <label className="voice-field">
            <span>{km ? 'សួន (plot)' : 'Plot'}</span>
            <input type="text" value={plot} maxLength={40} onChange={(e) => setPlot(e.target.value)} />
          </label>

          <button className="voice-ghost small" onClick={addLocation} disabled={locating}>
            📍 {gps ? (km ? 'ទីតាំងបានបន្ថែម' : 'Location added') : locating ? (km ? 'កំពុងរក…' : 'Getting…') : (km ? 'បន្ថែមទីតាំង' : 'Add location')}
          </button>

          {error ? <p className="voice-error">{error}</p> : null}
          <div className="voice-controls">
            <button className="voice-ghost" onClick={() => { setImage(null); setPreviewUrl(''); if (fileRef.current) fileRef.current.value = '' }}>↺</button>
            <button className="voice-primary big" onClick={save} disabled={saving}>
              {saving ? '…' : `✓ ${km ? 'ចុះហត្ថលេខា & រក្សាទុក' : 'Sign & save'}`}
            </button>
          </div>
        </>
      )}

      {obs.length > 0 ? (
        <div className="garden-list">
          <div className="garden-list-head">
            <b>{km ? 'កំណត់ត្រា' : 'Records'}</b>
            <button className="voice-ghost small" onClick={download}>⬇ {km ? 'នាំចេញ JSON' : 'Export JSON'}</button>
          </div>
          {[...obs].reverse().slice(0, 30).map((o) => (
            <div key={o.id} className="garden-row">
              <span className="garden-row-sp">{km ? SP_KM[o.species] ?? o.species : o.species}{o.count > 1 ? ` ×${o.count}` : ''}</span>
              <span className="garden-row-co2">{o.co2Kg} kg CO₂</span>
              <span className="garden-row-id" title={o.id}>✅ {o.id.slice(0, 8)}</span>
            </div>
          ))}
        </div>
      ) : null}

      <p className="voice-tip">
        {km
          ? 'ទូរស័ព្ទរបស់អ្នកគឺជាប្រភព។ កំណត់ត្រាត្រូវបានចុះហត្ថលេខា និងអាចផ្ទៀងផ្ទាត់ដោយនរណាក៏បាន ក្រៅបណ្ដាញ។'
          : 'Your phone is the source of truth. Records are signed and verifiable by anyone, offline.'}
      </p>
    </div>
  )
}

async function downscale(file: Blob, maxDim: number): Promise<Blob> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height))
  const w = Math.max(1, Math.round(bmp.width * scale))
  const h = Math.max(1, Math.round(bmp.height * scale))
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  c.getContext('2d')!.drawImage(bmp, 0, 0, w, h)
  bmp.close()
  return new Promise((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), 'image/jpeg', 0.85))
}
