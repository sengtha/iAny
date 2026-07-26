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
  publish,
  publishedIds,
  type GardenObservation,
  type Measure,
} from '../../grove/web/store'
import { anchorCall, plotLiveCount, readPlotStatus, type CsbPlotStatus } from '../../grove/core/csb'

/**
 * 🌳 Garden (/garden) — create **signed, verifiable** garden/tree observations on
 * your phone (the source of truth). Measure a plant → estimate its CO₂ → sign it
 * with your device key. Records are stored locally and exportable to any node /
 * dashboard / CamboVerse. See grove/SPEC.md. Estimates, not certified credits.
 */
const SPECIES = ['mango', 'coconut', 'jackfruit', 'longan', 'guava', 'tamarind', 'teak', 'banana', 'other']
/** Where the optional CSB read endpoint is remembered. Empty = chain off. */
const CSB_KEY = 'grove.csb.base.v1'
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
  const [published, setPublished] = useState<Set<string>>(() => publishedIds())
  const [publishing, setPublishing] = useState(false)
  const [publishMsg, setPublishMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const unpublished = useMemo(() => obs.filter((o) => !published.has(o.id)).length, [obs, published])

  // ---- optional: the chain's half (see grove/ANCHORING.md) ----------------
  // Everything below is additive. The garden works, signs, exports and publishes
  // with no chain at all; anchoring only adds a date somebody else agrees with
  // and a place a licensed verifier can put their name.
  const [csbBase, setCsbBase] = useState(() => localStorage.getItem(CSB_KEY) ?? '')
  const [chain, setChain] = useState<CsbPlotStatus | null>(null)
  const [copied, setCopied] = useState(false)

  const plotId = plot.trim() || 'home-garden-01'
  /** Newest record for the plot being edited — the one an anchor would commit. */
  const newest = useMemo(
    () => [...obs].reverse().find((o) => o.plot === plotId) ?? null,
    [obs, plotId],
  )

  useEffect(() => {
    if (!csbBase.trim()) { setChain(null); return }
    let stale = false
    void readPlotStatus(csbBase, plotId).then((s) => { if (!stale) setChain(s) })
    return () => { stale = true }
  }, [csbBase, plotId, obs.length])

  /**
   * Living plants in this plot — what the chain means by `liveCount`.
   *
   * The plot's total, NOT the newest record's own count. A record covers one
   * planting; a plot usually holds several, so anchoring the newest record's
   * count alone would tell the chain a three-tree garden has one tree — and
   * that number is what a title's supply and a pledge's survival threshold
   * are read from.
   */
  const liveCount = useMemo(() => plotLiveCount(obs, plotId), [obs, plotId])

  /** Calldata for anchoring `newest`, chained onto whatever the chain holds now. */
  const anchor = useMemo(() => {
    if (!newest) return null
    // `prev` must be the chain's CURRENT head, not this phone's idea of it — the
    // plot may have been anchored from another device, and CSB refuses an anchor
    // that would fork a plot's history.
    const head = chain?.anchored ? chain.head?.observationId ?? null : null
    try {
      return anchorCall({ ...newest, prev: head ? head.replace(/^0x/, '') : null }, { liveCount })
    } catch {
      return null
    }
  }, [newest, chain, liveCount])

  const alreadyAnchored =
    !!newest && !!chain?.head && chain.head.observationId.replace(/^0x/, '') === newest.id

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

  async function onPublish() {
    setPublishing(true)
    setPublishMsg('')
    try {
      const r = await publish()
      setPublished(publishedIds())
      setPublishMsg(
        r.accepted > 0
          ? (km ? `✅ បានផ្សព្វផ្សាយ ${r.accepted} កំណត់ត្រា` : `✅ Published ${r.accepted}`)
          : (km ? 'ទាំងអស់បានផ្សព្វផ្សាយរួច' : 'All already published'),
      )
      if (r.rejected > 0) setPublishMsg((m) => `${m} · ${r.rejected} ${km ? 'បដិសេធ' : 'rejected'}`)
    } catch (e) {
      setPublishMsg((km ? 'បរាជ័យ៖ ' : 'Failed: ') + (e instanceof Error ? e.message : String(e)))
    }
    setPublishing(false)
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
            <div className="garden-list-actions">
              <button className="voice-ghost small" onClick={onPublish} disabled={publishing || unpublished === 0}>
                {publishing ? '…' : `🌐 ${km ? 'ផ្សព្វផ្សាយ' : 'Publish'}${unpublished > 0 ? ` (${unpublished})` : ''}`}
              </button>
              <button className="voice-ghost small" onClick={download}>⬇ {km ? 'នាំចេញ JSON' : 'Export JSON'}</button>
            </div>
          </div>
          {publishMsg ? <p className="garden-publish-msg">{publishMsg}</p> : null}
          {[...obs].reverse().slice(0, 30).map((o) => (
            <div key={o.id} className="garden-row">
              <span className="garden-row-sp">{km ? SP_KM[o.species] ?? o.species : o.species}{o.count > 1 ? ` ×${o.count}` : ''}</span>
              <span className="garden-row-co2">{o.co2Kg} kg CO₂</span>
              <span className="garden-row-id" title={o.id}>
                {published.has(o.id) ? '🌐' : '✅'} {o.id.slice(0, 8)}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="garden-chain">
        <div className="garden-chain-head">
          <b>⛓ {km ? 'ចងភ្ជាប់លើ CSB' : 'Anchor on CSB'}</b>
          <small>{km ? 'ស្រេចចិត្ត' : 'optional'}</small>
        </div>
        <p className="garden-chain-lead">
          {km
            ? 'ហត្ថលេខាបញ្ជាក់ថា “នរណានិយាយ” មិនមែន “ពិតឬអត់”។ ការចងភ្ជាប់បន្ថែមកាលបរិច្ឆេទដែលអ្នកដទៃយល់ព្រម និងកន្លែងឲ្យអ្នកផ្ទៀងផ្ទាត់មានអាជ្ញាបណ្ណដាក់ឈ្មោះ។ មានតែ hash ទេដែលចេញទៅ។'
            : 'A signature proves who said something, never that it is true. Anchoring adds a date somebody else agrees with, and a place a licensed field verifier can put their name. Only the hash leaves this phone — never the plot name, the photo, or your location.'}
        </p>

        <label className="voice-field">
          <span>{km ? 'អាសយដ្ឋាន CSB' : 'CSB read endpoint'}</span>
          <input
            type="text" value={csbBase} spellCheck={false} placeholder="https://csb.example"
            onChange={(e) => {
              setCsbBase(e.target.value)
              localStorage.setItem(CSB_KEY, e.target.value)
            }}
          />
        </label>

        {!csbBase.trim() ? null : !chain?.available ? (
          <p className="garden-chain-note">
            {km ? 'មិនអាចទាក់ទង CSB បានទេ — សួនរបស់អ្នកនៅតែដំណើរការធម្មតា។' : 'CSB not reachable — your garden works exactly as before.'}
            {chain?.reason ? <> <small>({chain.reason})</small></> : null}
          </p>
        ) : !chain.anchored ? (
          <p className="garden-chain-note">
            {km ? 'សួននេះមិនទាន់ចងភ្ជាប់ទេ។' : 'This plot has never been anchored.'}
          </p>
        ) : (
          <div className="garden-chain-status">
            <div><span>{km ? 'កំណត់ត្រាបានចង' : 'Anchored records'}</span><b>{chain.records}</b></div>
            <div>
              <span>{km ? 'ដើមឈើបានផ្ទៀងផ្ទាត់' : 'Verified trees'}</span>
              <b>{chain.verifiedCount ? chain.verifiedCount : (km ? 'រង់ចាំ' : 'awaiting a verifier')}</b>
            </div>
            {chain.verifier ? (
              <div>
                <span>{km ? 'ផ្ទៀងផ្ទាត់ដោយ' : 'Verified by'}</span>
                <b>{chain.verifier.label || chain.verifier.classes.join(', ')}</b>
              </div>
            ) : null}
            {chain.title ? (
              <div>
                <span>{km ? 'ប័ណ្ណសួន' : 'Grove title'}</span>
                <b>{chain.title.supply} {chain.title.symbol}</b>
              </div>
            ) : null}
          </div>
        )}

        {anchor && !alreadyAnchored ? (
          <>
            <p className="garden-chain-note">
              {km
                ? 'បើកនៅ CSB ដើម្បីពិនិត្យ និងចុះហត្ថលេខាដោយកាបូបផ្ទាល់ខ្លួន។ Gas ឥតគិតថ្លៃ។'
                : 'Open it on CSB to read what it commits and sign with your own wallet. Gas on CSB is free, so anchoring costs a signature.'}
            </p>
            {/* Copying 330 characters of hex on a phone is a bad time, so the
                primary path is a link that carries it. The calldata is not a
                secret — it is the same public hash anyone can recompute from
                the record — so putting it in a URL discloses nothing. */}
            <a
              className="voice-primary big garden-chain-sign"
              href={`${csbBase.replace(/\/+$/, '')}/anchor.html?data=${anchor.data}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              ⛓ {km ? 'ចុះហត្ថលេខានៅ CSB' : 'Sign on CSB'}
            </a>
            <div className="garden-chain-call">
              <code title={anchor.data}>{anchor.data.slice(0, 42)}…</code>
              <button
                className="voice-ghost small"
                onClick={() => {
                  void navigator.clipboard?.writeText(anchor.data)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                }}
              >
                {copied ? '✓' : (km ? '⧉ ចម្លង' : '⧉ Copy')}
              </button>
            </div>
            <p className="garden-chain-note">
              <small>
                {km ? 'ដើម' : 'trees'}: {anchor.liveCount} · plot {anchor.plotId.slice(0, 10)}… ·{' '}
                {anchor.prevId.startsWith('0x0000') ? (km ? 'កំណត់ត្រាដំបូង' : 'first record') : `prev ${anchor.prevId.slice(0, 10)}…`}
              </small>
            </p>
          </>
        ) : alreadyAnchored ? (
          <p className="garden-chain-note">
            ✓ {km ? 'កំណត់ត្រាចុងក្រោយបានចងរួចហើយ។' : 'Your newest record for this plot is already anchored.'}
          </p>
        ) : null}

        <p className="garden-chain-note">
          <small>
            {km
              ? 'CSB កត់ត្រា ដើមឈើ មិនមែនកាបូន។ គ្មានអ្វីនៅទីនេះជាក្រេឌីតកាបូនទេ។'
              : 'CSB records trees, not carbon. Nothing here is a carbon credit — it is a count somebody can walk out and check.'}
          </small>
        </p>
      </div>

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
