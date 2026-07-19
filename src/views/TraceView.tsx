import { useRef, useState } from 'react'
import { useI18n } from '../i18n'
import { khmerOcr } from '../ai/khmerOcr'
import {
  capsuleId,
  checkCapsule,
  computeTrust,
  photoSignature,
  registerCapsule,
  type FreshCapture,
  type PhotoSig,
  type RegistryInfo,
  type TraceCapsule,
  type VerifyResult,
} from '../lib/trace'

/**
 * iAny Trace (/trace) — keyless, offline proof-of-origin as a trust score.
 * Two modes: Create a capsule from a product, or Verify a received product
 * against a capsule. All on-device. Bilingual EN/KM.
 */
export function TraceView() {
  const { lang } = useI18n()
  const km = lang === 'km'
  const L = (en: string, khmer: string) => (km ? khmer : en)
  const [mode, setMode] = useState<'create' | 'verify'>('create')

  return (
    <div className="contribute trace">
      <div className="trace-tabs">
        <button className={mode === 'create' ? 'active' : ''} onClick={() => setMode('create')}>
          ➕ {L('Create', 'បង្កើត')}
        </button>
        <button className={mode === 'verify' ? 'active' : ''} onClick={() => setMode('verify')}>
          ✓ {L('Verify', 'ផ្ទៀងផ្ទាត់')}
        </button>
      </div>
      {mode === 'create' ? <Create L={L} /> : <Verify L={L} />}
      <p className="voice-minor-note">
        {L(
          'Trust score = combined evidence that the product matches its documented origin — not a guarantee of authenticity. 100% offline.',
          'ពិន្ទុទំនុកចិត្ត = ភស្តុតាងរួមបញ្ចូលគ្នាថាផលិតផលត្រូវនឹងប្រភពដើមដែលបានកត់ត្រា — មិនមែនជាការធានាភាពត្រឹមត្រូវទេ។ ដំណើរការក្រៅបណ្ដាញ ១០០%។',
        )}
      </p>
    </div>
  )
}

type LFn = (en: string, khmer: string) => string

/* ------------------------------------------------------------------ create */

function Create({ L }: { L: LFn }) {
  const [photos, setPhotos] = useState<{ sig: PhotoSig }[]>([])
  const [boxText, setBoxText] = useState('')
  const [producer, setProducer] = useState('')
  const [product, setProduct] = useState('')
  const [witness, setWitness] = useState('')
  const [note, setNote] = useState('')
  const [gps, setGps] = useState<{ lat: number; lng: number; acc: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [capsule, setCapsule] = useState<TraceCapsule | null>(null)
  const [reg, setReg] = useState<RegistryInfo | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function addPhotos(files: FileList) {
    setBusy(true)
    const sigs = await Promise.all([...files].map((f) => photoSignature(f)))
    setPhotos((p) => [...p, ...sigs.map((sig) => ({ sig }))])
    setBusy(false)
  }

  function locate() {
    navigator.geolocation?.getCurrentPosition(
      (p) => setGps({ lat: +p.coords.latitude.toFixed(5), lng: +p.coords.longitude.toFixed(5), acc: Math.round(p.coords.accuracy) }),
      () => setGps(null),
      { enableHighAccuracy: true, timeout: 8000 },
    )
  }

  async function create() {
    setBusy(true)
    const body: Omit<TraceCapsule, 'id'> = {
      v: 1,
      match: { photos: photos.map((p) => p.sig), boxText },
      context: {
        gps,
        capturedAt: new Date().toISOString(),
        producer, product, note, witness,
      },
    }
    const id = await capsuleId(body)
    setCapsule({ ...body, id })
    setBusy(false)
  }

  function download() {
    if (!capsule) return
    const blob = new Blob([JSON.stringify(capsule)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `trace-${capsule.id.slice(0, 8)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  if (capsule) {
    return (
      <div className="trace-done">
        <div className="trace-badge">✓</div>
        <h3>{L('Proof created', 'បង្កើតភស្តុតាងរួចរាល់')}</h3>
        <p className="trace-id">ID: {capsule.id.slice(0, 16)}…</p>
        <div className="trace-thumbs">
          {capsule.match.photos.map((p, i) => (
            <img key={i} src={p.thumb} alt="" />
          ))}
        </div>
        <button className="voice-primary big" onClick={download}>
          ⬇ {L('Save proof file', 'រក្សាទុកឯកសារភស្តុតាង')}
        </button>
        <p className="voice-tip">
          {L('Send this file with the product (share, Bluetooth, upload). The receiver verifies it offline.',
             'ផ្ញើឯកសារនេះជាមួយផលិតផល (ចែករំលែក ប៊្លូធូស អាប់ឡូត)។ អ្នកទទួលអាចផ្ទៀងផ្ទាត់ក្រៅបណ្ដាញ។')}
        </p>
        {reg?.firstSeen ? (
          <p className="voice-tip">✓ {L('Registered online', 'ចុះបញ្ជីលើបណ្ដាញ')}: {new Date(reg.firstSeen).toLocaleString()}</p>
        ) : (
          <button className="voice-ghost" onClick={async () => setReg(await registerCapsule(capsule))}>
            🌐 {L('Register online (optional, trusted timestamp)', 'ចុះបញ្ជីលើបណ្ដាញ (ស្រេចចិត្ត ពេលវេលាដែលទុកចិត្ត)')}
          </button>
        )}
        <button className="voice-ghost" onClick={() => { setCapsule(null); setReg(null); setPhotos([]); setBoxText(''); }}>
          {L('Create another', 'បង្កើតថ្មី')}
        </button>
      </div>
    )
  }

  return (
    <>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple hidden
        onChange={(e) => e.target.files && addPhotos(e.target.files)} />

      <label className="voice-field"><span>📸 {L('Product photos', 'រូបថតផលិតផល')}</span></label>
      <div className="trace-thumbs">
        {photos.map((p, i) => <img key={i} src={p.sig.thumb} alt="" />)}
        <button className="trace-add" onClick={() => fileRef.current?.click()}>＋</button>
      </div>
      <small className="hint">{L('2–3 angles + a close-up of texture work best.', 'ថត ២–៣ មុំ + រូបជិតនៃវាយនភាព ល្អបំផុត។')}</small>

      <label className="voice-field">
        <span>🏷️ {L('Text on the box / label', 'អក្សរនៅលើប្រអប់ / ស្លាក')}</span>
        <textarea lang="km" rows={2} value={boxText} onChange={(e) => setBoxText(e.target.value)}
          placeholder={L('brand, batch, weight, dates…', 'ម៉ាក បាច់ ទម្ងន់ កាលបរិច្ឆេទ…')} />
      </label>
      <ScanLabel L={L} onText={(t) => setBoxText((b) => (b ? b + ' ' : '') + t)} />

      <div className="trace-row">
        <label className="voice-field"><span>{L('Producer', 'អ្នកផលិត')}</span>
          <input value={producer} onChange={(e) => setProducer(e.target.value)} /></label>
        <label className="voice-field"><span>{L('Product', 'ផលិតផល')}</span>
          <input value={product} onChange={(e) => setProduct(e.target.value)} /></label>
      </div>

      <label className="voice-field">
        <span>🤝 {L('Witness — co-op / buyer (optional)', 'សាក្សី — សហករណ៍ / អ្នកទិញ (ស្រេចចិត្ត)')}</span>
        <input value={witness} onChange={(e) => setWitness(e.target.value)}
          placeholder={L('who can vouch for this origin', 'អ្នកដែលអាចធានាប្រភពនេះ')} />
      </label>

      <label className="voice-field">
        <span>{L('Note / story (optional)', 'កំណត់ចំណាំ / រឿង (ស្រេចចិត្ត)')}</span>
        <textarea lang="km" rows={2} value={note} onChange={(e) => setNote(e.target.value)}
          placeholder={L('harvest date, origin, anything…', 'ថ្ងៃប្រមូលផល ប្រភព អ្វីៗ…')} />
      </label>

      <div className="trace-gps">
        <button className="voice-ghost" onClick={locate}>📍 {L('Add location', 'បញ្ចូលទីតាំង')}</button>
        {gps && <span>{gps.lat}, {gps.lng} (±{gps.acc}m)</span>}
      </div>

      <button className="voice-primary big" disabled={busy || photos.length === 0} onClick={create}>
        {busy ? `${L('Processing', 'កំពុងដំណើរការ')}…` : `➕ ${L('Create proof', 'បង្កើតភស្តុតាង')}`}
      </button>
    </>
  )
}

/* ------------------------------------------------------------------ verify */

function Verify({ L }: { L: LFn }) {
  const [capsule, setCapsule] = useState<TraceCapsule | null>(null)
  const [integrityOk, setIntegrityOk] = useState(true)
  const [photos, setPhotos] = useState<PhotoSig[]>([])
  const [boxText, setBoxText] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<VerifyResult | null>(null)
  const [registry, setRegistry] = useState<RegistryInfo | null>(null)
  const capRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function loadCapsule(file: File) {
    setResult(null); setPhotos([]); setBoxText('')
    try {
      const c = JSON.parse(await file.text()) as TraceCapsule
      const { id, ...body } = c
      setIntegrityOk((await capsuleId(body)) === id)
      setCapsule(c)
    } catch {
      setCapsule(null)
    }
  }

  async function addPhotos(files: FileList) {
    setBusy(true)
    const sigs = await Promise.all([...files].map((f) => photoSignature(f)))
    setPhotos((p) => [...p, ...sigs])
    setBusy(false)
  }

  function verify() {
    if (!capsule) return
    const fresh: FreshCapture = { photos, boxText }
    setResult(computeTrust(capsule, fresh, integrityOk))
    // Optional online cross-check (trusted time + double-use). No-op offline.
    void checkCapsule(capsule.id).then(setRegistry)
  }

  if (!capsule) {
    return (
      <div className="trace-import">
        <input ref={capRef} type="file" accept="application/json,.json" hidden
          onChange={(e) => e.target.files?.[0] && loadCapsule(e.target.files[0])} />
        <div className="ocr-drop" onClick={() => capRef.current?.click()}>
          <div className="ocr-drop-icon">📄</div>
          <div className="ocr-drop-title">{L('Load the proof file', 'ផ្ទុកឯកសារភស្តុតាង')}</div>
          <div className="ocr-drop-sub">{L('the .json that came with the product', 'ឯកសារ .json ដែលមកជាមួយផលិតផល')}</div>
        </div>
      </div>
    )
  }

  return (
    <>
      {!integrityOk && <p className="voice-error">⚠ {L('This proof file was modified — treat with caution.', 'ឯកសារភស្តុតាងនេះត្រូវបានកែប្រែ — សូមប្រុងប្រយ័ត្ន។')}</p>}

      <div className="trace-origin">
        <div className="trace-thumbs">
          {capsule.match.photos.map((p, i) => <img key={i} src={p.thumb} alt="" />)}
        </div>
        <div className="trace-ctx">
          {capsule.context.producer && <div>👤 {capsule.context.producer}</div>}
          {capsule.context.product && <div>📦 {capsule.context.product}</div>}
          {capsule.context.witness && <div>🤝 {capsule.context.witness}</div>}
          {capsule.context.gps && <div>📍 {capsule.context.gps.lat}, {capsule.context.gps.lng}</div>}
          <div>🕒 {new Date(capsule.context.capturedAt).toLocaleDateString()}</div>
        </div>
      </div>

      <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple hidden
        onChange={(e) => e.target.files && addPhotos(e.target.files)} />
      <label className="voice-field"><span>📸 {L('Photograph what you received', 'ថតអ្វីដែលអ្នកបានទទួល')}</span></label>
      <div className="trace-thumbs">
        {photos.map((p, i) => <img key={i} src={p.thumb} alt="" />)}
        <button className="trace-add" onClick={() => fileRef.current?.click()}>＋</button>
      </div>
      <label className="voice-field">
        <span>🏷️ {L('Text on the box now', 'អក្សរនៅលើប្រអប់ឥឡូវ')}</span>
        <textarea lang="km" rows={2} value={boxText} onChange={(e) => setBoxText(e.target.value)} />
      </label>
      <ScanLabel L={L} onText={(t) => setBoxText((b) => (b ? b + ' ' : '') + t)} />

      <button className="voice-primary big" disabled={busy || photos.length === 0} onClick={verify}>
        {busy ? `${L('Processing', 'កំពុងដំណើរការ')}…` : `✓ ${L('Check match', 'ពិនិត្យការផ្គូផ្គង')}`}
      </button>

      {result && <ScoreCard result={result} L={L} />}
      {result && registry && (
        registry.registered ? (
          <p className="voice-tip">
            ✓ {L('Registered at origin', 'ចុះបញ្ជីនៅប្រភព')}: {registry.firstSeen ? new Date(registry.firstSeen).toLocaleDateString() : ''}
            {' · '}{L('verified', 'ផ្ទៀងផ្ទាត់')} {registry.verifyCount}×
            {registry.verifyCount > 8 && ` ⚠ ${L('(checked many times — may be copied)', '(ពិនិត្យច្រើនដង — អាចត្រូវបានចម្លង)')}`}
          </p>
        ) : (
          <p className="voice-minor-note">{L('Not in the online registry (offline proof only).', 'មិននៅក្នុងបញ្ជីលើបណ្ដាញ (ភស្តុតាងក្រៅបណ្ដាញតែប៉ុណ្ណោះ)។')}</p>
        )
      )}
    </>
  )
}

/* ------------------------------------------------------ scan-label (OCR) --- */

function ScanLabel({ onText, L }: { onText: (t: string) => void; L: LFn }) {
  const ref = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  return (
    <>
      <input ref={ref} type="file" accept="image/*" capture="environment" hidden
        onChange={async (e) => {
          const f = e.target.files?.[0]
          if (!f) return
          setBusy(true)
          try {
            const t = await khmerOcr.recognizeImage(f)
            if (t.trim()) onText(t.trim())
          } catch {
            /* OCR unavailable — user can type instead */
          } finally {
            setBusy(false)
            e.target.value = ''
          }
        }} />
      <button type="button" className="voice-ghost trace-scan" disabled={busy} onClick={() => ref.current?.click()}>
        {busy ? `${L('Reading label', 'កំពុងអានស្លាក')}…` : `📷 ${L('Scan label', 'ស្កេនស្លាក')}`}
      </button>
    </>
  )
}

/* --------------------------------------------------------------- scorecard */

function ScoreCard({ result, L }: { result: VerifyResult; L: LFn }) {
  const bandText = {
    strong: L('Strong match', 'ផ្គូផ្គងខ្លាំង'),
    good: L('Good match', 'ផ្គូផ្គងល្អ'),
    partial: L('Partial match', 'ផ្គូផ្គងខ្លះ'),
    low: L('Low match', 'ផ្គូផ្គងតិច'),
  }[result.band]
  return (
    <div className={`trace-score band-${result.band}`}>
      <div className="trace-score-num">{result.score}<span>/100</span></div>
      <div className="trace-score-band">{bandText}</div>
      <div className="trace-signals">
        {result.signals.map((s) => (
          <div key={s.key} className={`trace-sig ${s.available ? '' : 'na'}`}>
            <span>{signalLabel(s.key, L)}</span>
            <div className="trace-bar"><i style={{ width: `${Math.round(s.score * 100)}%` }} /></div>
            <b>{s.available ? `${Math.round(s.score * 100)}%` : L('n/a', 'គ្មាន')}</b>
          </div>
        ))}
      </div>
      <p className="voice-tip">
        {L(`Based on ${result.usedSignals} signal(s). This measures consistency with the documented origin, not proof of authenticity.`,
           `ផ្អែកលើ ${result.usedSignals} សញ្ញា។ វាវាស់ភាពត្រូវគ្នាជាមួយប្រភពដើម មិនមែនជាភស្តុតាងនៃភាពត្រឹមត្រូវទេ។`)}
      </p>
    </div>
  )
}

function signalLabel(key: string, L: LFn): string {
  return { visual: L('Appearance', 'រូបរាង'), color: L('Colour', 'ពណ៌'), text: L('Box text', 'អក្សរប្រអប់') }[key] ?? key
}
