import { useEffect, useRef, useState } from 'react'
import { useTraceCaps } from './context'
import type { SttState } from './adapters'
import {
  addAttestation,
  capsuleId,
  checkCapsule,
  complianceReport,
  computeTrust,
  EVENT_TYPES,
  fetchAttestations,
  fetchPage,
  photoSignature,
  proofTier,
  publishCapsule,
  registerCapsule,
  tierFromCapsule,
  verifyChain,
  type Attestation,
  type ChainResult,
  type EventType,
  type Tier,
  type FreshCapture,
  type PhotoSig,
  type RegistryInfo,
  type TraceCapsule,
  type VerifyResult,
} from '../core/trace'

/**
 * iAny Trace (/trace) — keyless, offline proof-of-origin as a trust score.
 * Two modes: Create a capsule from a product, or Verify a received product
 * against a capsule. All on-device. Bilingual EN/KM.
 */
export function TraceView({ lang }: { lang: 'en' | 'km' }) {
  const km = lang === 'km'
  const L = (en: string, khmer: string) => (km ? khmer : en)
  const [mode, setMode] = useState<'create' | 'verify' | 'journey'>('create')

  // Consumer provenance page: /trace?p=<capsule id>
  const [pageId, setPageId] = useState<string | null>(null)
  const [pageCapsule, setPageCapsule] = useState<TraceCapsule | null>(null)
  const [pageAtt, setPageAtt] = useState<Attestation[]>([])
  const [pageState, setPageState] = useState<'off' | 'loading' | 'ready' | 'missing'>('off')

  useEffect(() => {
    const id = new URLSearchParams(location.search).get('p')
    if (!id || !/^[0-9a-f]{64}$/.test(id)) return
    setPageId(id)
    setPageState('loading')
    void fetchPage(id).then((c) => {
      setPageCapsule(c)
      setPageState(c ? 'ready' : 'missing')
    })
    void fetchAttestations(id).then(setPageAtt)
  }, [])

  if (pageState !== 'off') {
    return (
      <ProvenancePage
        id={pageId!}
        capsule={pageCapsule}
        attestations={pageAtt}
        state={pageState}
        L={L}
        onAttested={() => pageId && void fetchAttestations(pageId).then(setPageAtt)}
      />
    )
  }

  return (
    <div className="contribute trace">
      {/* Two plain choices instead of a row of tabs — a maker vs. a buyer. */}
      <div className="trace-modes">
        <button className={mode === 'create' ? 'active' : ''} onClick={() => setMode('create')}>
          <span className="trace-mode-ic" aria-hidden>🏷️</span>
          <b>{L('Make a proof', 'បង្កើតភស្តុតាង')}</b>
          <small>{L("I'm the maker / seller", 'ខ្ញុំជាអ្នកផលិត / លក់')}</small>
        </button>
        <button className={mode === 'verify' ? 'active' : ''} onClick={() => setMode('verify')}>
          <span className="trace-mode-ic" aria-hidden>🔍</span>
          <b>{L('Check a proof', 'ពិនិត្យភស្តុតាង')}</b>
          <small>{L('I received a product', 'ខ្ញុំបានទទួលផលិតផល')}</small>
        </button>
      </div>

      {mode === 'create' ? <Create L={L} /> : mode === 'verify' ? <Verify L={L} /> : <Journey L={L} />}

      {/* Journey / compliance is an exporter feature — tucked away, not a top tab. */}
      {mode === 'journey' ? (
        <button className="trace-adv-link" onClick={() => setMode('create')}>
          ← {L('Back', 'ត្រឡប់')}
        </button>
      ) : (
        <button className="trace-adv-link" onClick={() => setMode('journey')}>
          🧭 {L('Advanced: verify a full journey & export compliance', 'កម្រិតខ្ពស់៖ ផ្ទៀងផ្ទាត់ដំណើរពេញ និងនាំចេញអនុលោមភាព')} →
        </button>
      )}

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

/* ------------------------------------------ learned "better matching" opt-in */

interface MatcherState {
  available: boolean
  on: boolean
  phase: 'off' | 'loading' | 'ready'
  progress: number
  toggle: () => void
  embed: (blob: Blob) => Promise<number[] | null>
}

/** Wraps the optional MatcherAdapter: lazy-load on first toggle, then attach a
 *  learned embedding to each photo. No adapter → `available:false` (button hidden). */
function useMatcher(): MatcherState {
  const { matcher } = useTraceCaps()
  const [on, setOn] = useState(false)
  const [phase, setPhase] = useState<'off' | 'loading' | 'ready'>('off')
  const [progress, setProgress] = useState(0)
  const toggle = () => {
    if (!matcher) return
    if (on) { setOn(false); return }
    if (phase === 'ready') { setOn(true); return }
    setPhase('loading'); setProgress(0)
    void matcher.prepare((f) => setProgress(f))
      .then(() => { setPhase('ready'); setOn(true) })
      .catch(() => setPhase('off'))
  }
  const embed = (blob: Blob) => (on && matcher ? matcher.embed(blob) : Promise.resolve(null))
  return { available: !!matcher, on, phase, progress, toggle, embed }
}

function MatcherToggle({ m, L }: { m: MatcherState; L: LFn }) {
  const { matcher } = useTraceCaps()
  if (!m.available || !matcher) return null
  const size = matcher.sizeMb ? ` · ${matcher.sizeMb} MB` : ''
  const label =
    m.phase === 'loading'
      ? `${L('Loading matcher', 'កំពុងផ្ទុកម៉ូឌែល')}… ${Math.round(m.progress * 100)}%`
      : m.on
        ? `✓ ${L('Better matching on', 'ការផ្គូផ្គងកាន់តែល្អ (បើក)')}`
        : `✨ ${L('Better matching', 'ការផ្គូផ្គងកាន់តែល្អ')} (${L('small download', 'ទាញយកតូច')}${size})`
  return (
    <button
      type="button"
      className={`voice-ghost trace-scan ${m.on ? 'trace-matcher-on' : ''}`}
      disabled={m.phase === 'loading'}
      onClick={m.toggle}
    >
      {label}
    </button>
  )
}

/* ------------------------------------------------------------------ create */

/** Message when some/all picked photos couldn't be decoded (e.g. HEIC). */
function photoErrorText(failed: number, total: number, L: LFn): string {
  return failed >= total
    ? L("Couldn't read that photo. Some phones save HEIC — try JPEG/PNG (in Camera settings, set 'Most Compatible').",
        "មិនអាចអានរូបនោះបានទេ។ ទូរស័ព្ទខ្លះរក្សាទុកជា HEIC — សូមប្រើ JPEG/PNG (ក្នុងការកំណត់កាមេរ៉ា ជ្រើស 'ត្រូវគ្នាបំផុត')។")
    : L(`${failed} photo(s) couldn't be read and were skipped.`,
        `រូបភាព ${failed} មិនអាចអានបាន ត្រូវបានរំលង។`)
}

function Create({ L }: { L: LFn }) {
  const [photos, setPhotos] = useState<{ sig: PhotoSig }[]>([])
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [boxText, setBoxText] = useState('')
  const [producer, setProducer] = useState('')
  const [product, setProduct] = useState('')
  const [witness, setWitness] = useState('')
  const [note, setNote] = useState('')
  const [gps, setGps] = useState<{ lat: number; lng: number; acc: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [capsule, setCapsule] = useState<TraceCapsule | null>(null)
  const [reg, setReg] = useState<RegistryInfo | null>(null)
  const [pageUrl, setPageUrl] = useState<string | null>(null)
  const [eventType, setEventType] = useState<EventType>('harvest')
  const [prev, setPrev] = useState<{ id: string; step: number } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const prevRef = useRef<HTMLInputElement>(null)
  const m = useMatcher()

  async function addPhotos(files: FileList) {
    setBusy(true)
    setPhotoError(null)
    // Process each photo independently: one un-decodable image (e.g. an iPhone
    // HEIC that this browser can't read) must not drop the whole batch, which
    // would leave the proof stuck with no photos. A failed embedding likewise
    // falls back to the classical signature rather than losing the photo.
    const results = await Promise.allSettled(
      [...files].map(async (f) => {
        const sig = await photoSignature(f)
        const emb = await m.embed(f).catch(() => null)
        return { sig: emb ? { ...sig, embed: emb } : sig }
      }),
    )
    const ok = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
    const failed = results.length - ok.length
    if (ok.length) setPhotos((p) => [...p, ...ok])
    if (failed) setPhotoError(photoErrorText(failed, results.length, L))
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
      v: 2,
      match: { photos: photos.map((p) => p.sig), boxText },
      context: {
        gps,
        capturedAt: new Date().toISOString(),
        producer, product, note, witness,
      },
      event: { type: eventType, step: (prev?.step ?? 0) + 1 },
      prev: prev?.id ?? null,
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
        <TierBadge tier={tierFromCapsule(capsule)} L={L} />
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
        {pageUrl ? (
          <div className="trace-share">
            <div className="trace-share-url">{location.origin}{pageUrl}</div>
            <button className="voice-ghost" onClick={() => void navigator.clipboard?.writeText(location.origin + pageUrl)}>
              ⧉ {L('Copy public link', 'ចម្លងតំណសាធារណៈ')}
            </button>
          </div>
        ) : (
          <button className="voice-ghost" onClick={async () => setPageUrl(await publishCapsule(capsule))}>
            🔗 {L('Publish shareable page (for buyers)', 'ផ្សាយទំព័រចែករំលែក (សម្រាប់អ្នកទិញ)')}
          </button>
        )}
        <div className="voice-controls">
          <button className="voice-ghost" onClick={() => {
            // Continue the journey: the next event links to the one just made.
            setPrev({ id: capsule.id, step: capsule.event?.step ?? 1 })
            setCapsule(null); setReg(null); setPageUrl(null); setPhotos([]); setBoxText('')
          }}>
            ↳ {L('Add next step', 'បន្ថែមជំហានបន្ទាប់')}
          </button>
          <button className="voice-ghost" onClick={() => {
            setPrev(null); setEventType('harvest')
            setCapsule(null); setReg(null); setPageUrl(null); setPhotos([]); setBoxText('')
          }}>
            {L('New journey', 'ដំណើរថ្មី')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple hidden
        onChange={(e) => e.target.files && addPhotos(e.target.files)} />
      <input ref={prevRef} type="file" accept="application/json,.json" hidden
        onChange={async (e) => {
          const f = e.target.files?.[0]
          if (!f) return
          try {
            const c = JSON.parse(await f.text()) as TraceCapsule
            setPrev({ id: c.id, step: c.event?.step ?? 1 })
            if (!producer && c.context.producer) setProducer(c.context.producer)
            if (!product && c.context.product) setProduct(c.context.product)
          } catch { /* not a capsule */ }
          e.target.value = ''
        }} />

      {/* Step 1 — the only thing a maker must do: photograph the product. */}
      <p className="trace-lead">
        {L('Take a photo of your product. That is your proof. Everything else is optional — add it only if you want a stronger proof.',
           'ថតរូបផលិតផលរបស់អ្នក។ នោះជាភស្តុតាងរបស់អ្នក។ អ្វីផ្សេងទៀតជាជម្រើស — បន្ថែមតែពេលអ្នកចង់បានភស្តុតាងកាន់តែរឹងមាំ។')}
      </p>
      <div className="trace-thumbs big">
        {photos.map((p, i) => <img key={i} src={p.sig.thumb} alt="" />)}
        <button className="trace-add" onClick={() => fileRef.current?.click()}>
          <span aria-hidden>📷</span>
          <small>{photos.length ? L('Add photo', 'បន្ថែមរូប') : L('Take photo', 'ថតរូប')}</small>
        </button>
      </div>
      {photoError && <p className="voice-error">⚠ {photoError}</p>}
      {photos.length > 0 && (
        <div className="trace-angles">
          {[L('Front', 'ខាងមុខ'), L('Back / label', 'ខាងក្រោយ / ស្លាក'), L('Close-up', 'រូបជិត')].map((a, i) => (
            <span key={i} className={photos.length > i ? 'done' : ''}>{photos.length > i ? '✓' : i + 1} {a}</span>
          ))}
        </div>
      )}
      <small className="hint">
        {L('Tip: a few angles — especially a close-up of texture — make the match stronger and harder to fake.',
           'គន្លឹះ៖ ថតពីរបីមុំ — ជាពិសេសរូបជិតនៃវាយនភាព — ធ្វើឲ្យការផ្គូផ្គងកាន់តែរឹងមាំ និងពិបាកក្លែងបន្លំ។')}
      </small>
      <MatcherToggle m={m} L={L} />

      {/* Step 2 — optional details, hidden until asked for. */}
      <details className="trace-more">
        <summary>🏷️ {L('Add product details', 'បន្ថែមព័ត៌មានផលិតផល')} <span>{L('optional', 'ស្រេចចិត្ត')}</span></summary>
        <div className="trace-more-body">
          <div className="trace-row">
            <label className="voice-field"><span>{L('Producer', 'អ្នកផលិត')}</span>
              <input value={producer} onChange={(e) => setProducer(e.target.value)}
                placeholder={L('your name / farm', 'ឈ្មោះ / កសិដ្ឋាន')} /></label>
            <label className="voice-field"><span>{L('Product', 'ផលិតផល')}</span>
              <input value={product} onChange={(e) => setProduct(e.target.value)}
                placeholder={L('what it is', 'ជាអ្វី')} /></label>
          </div>

          <label className="voice-field">
            <span>{L('Text on the box / label', 'អក្សរនៅលើប្រអប់ / ស្លាក')}</span>
            <textarea lang="km" rows={2} value={boxText} onChange={(e) => setBoxText(e.target.value)}
              placeholder={L('brand, batch, weight, dates…', 'ម៉ាក បាច់ ទម្ងន់ កាលបរិច្ឆេទ…')} />
          </label>
          <ScanLabel L={L} onText={(t) => setBoxText((b) => (b ? b + ' ' : '') + t)} />

          <label className="voice-field">
            <span>{L('Note / story', 'កំណត់ចំណាំ / រឿង')}</span>
            <textarea lang="km" rows={2} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder={L('harvest date, origin, anything…', 'ថ្ងៃប្រមូលផល ប្រភព អ្វីៗ…')} />
          </label>
          <VoiceStory L={L} onText={(t) => setNote((n) => (n ? n + ' ' : '') + t)} />
        </div>
      </details>

      {/* Step 3 — optional trust boosters (witness, location). */}
      <details className="trace-more">
        <summary>🤝 {L('Make it more trusted', 'ធ្វើឲ្យគួរឲ្យទុកចិត្តជាង')} <span>{L('optional', 'ស្រេចចិត្ត')}</span></summary>
        <div className="trace-more-body">
          <label className="voice-field">
            <span>{L('Witness — a co-op or buyer who vouches', 'សាក្សី — សហករណ៍ ឬអ្នកទិញដែលធានា')}</span>
            <input value={witness} onChange={(e) => setWitness(e.target.value)}
              placeholder={L('who can vouch for this origin', 'អ្នកដែលអាចធានាប្រភពនេះ')} />
          </label>
          <div className="trace-gps">
            <button className="voice-ghost" onClick={locate}>📍 {L('Add location', 'បញ្ចូលទីតាំង')}</button>
            {gps && <span>{gps.lat}, {gps.lng} (±{gps.acc}m)</span>}
          </div>
        </div>
      </details>

      {/* Advanced — journeys are for exporters/co-ops; hidden by default. */}
      <details className="trace-more">
        <summary>🧭 {L('Part of a journey?', 'ជាផ្នែកនៃដំណើរ?')} <span>{L('advanced', 'កម្រិតខ្ពស់')}</span></summary>
        <div className="trace-more-body">
          <div className="trace-events">
            {EVENT_TYPES.map((t) => (
              <button key={t} type="button" className={eventType === t ? 'active' : ''} onClick={() => setEventType(t)}>
                {eventLabel(t, L)}
              </button>
            ))}
          </div>
          {prev ? (
            <p className="voice-tip">🔗 {L('Continues step', 'បន្តជំហាន')} {prev.step} → {prev.step + 1}
              {' '}<button className="trace-linkclear" onClick={() => setPrev(null)}>✕</button></p>
          ) : (
            <button className="voice-ghost trace-scan" onClick={() => prevRef.current?.click()}>
              🔗 {L('Continue a previous event (link its file)', 'បន្តព្រឹត្តិការណ៍មុន (ភ្ជាប់ឯកសារ)')}
            </button>
          )}
        </div>
      </details>

      <StrengthMeter L={L} tier={proofTier({
        photos: photos.length,
        hasLabel: !!boxText.trim(),
        hasGeo: !!gps,
        hasWitness: !!witness.trim(),
        inChain: !!prev,
      })} />

      <button className="voice-primary big" disabled={busy || photos.length === 0} onClick={create}>
        {busy ? `${L('Processing', 'កំពុងដំណើរការ')}…`
          : photos.length === 0 ? `📷 ${L('Add a photo to start', 'បន្ថែមរូបដើម្បីចាប់ផ្តើម')}`
          : `✓ ${L('Create proof', 'បង្កើតភស្តុតាង')}`}
      </button>
    </>
  )
}

/* ------------------------------------------------------------------ verify */

function Verify({ L, preload }: { L: LFn; preload?: TraceCapsule }) {
  const [capsule, setCapsule] = useState<TraceCapsule | null>(preload ?? null)
  const [integrityOk, setIntegrityOk] = useState(true)
  const [photos, setPhotos] = useState<PhotoSig[]>([])
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [boxText, setBoxText] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<VerifyResult | null>(null)
  const [registry, setRegistry] = useState<RegistryInfo | null>(null)
  const capRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const m = useMatcher()

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
    setPhotoError(null)
    // Resilient like Create: skip an un-decodable image instead of losing the
    // whole batch, and fall back to the classical signature if embedding fails.
    const results = await Promise.allSettled(
      [...files].map(async (f) => {
        const sig = await photoSignature(f)
        const emb = await m.embed(f).catch(() => null)
        return emb ? { ...sig, embed: emb } : sig
      }),
    )
    const ok = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
    const failed = results.length - ok.length
    if (ok.length) setPhotos((p) => [...p, ...ok])
    if (failed) setPhotoError(photoErrorText(failed, results.length, L))
    setBusy(false)
  }

  // If the origin proof itself used better matching, prompt the verifier to turn
  // it on so both sides carry embeddings (otherwise it falls back to classical).
  const originHasEmbed = !!capsule?.match.photos.some((p) => p.embed?.length)

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
          <div><TierBadge tier={tierFromCapsule(capsule)} L={L} /></div>
        </div>
      </div>

      <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple hidden
        onChange={(e) => e.target.files && addPhotos(e.target.files)} />
      <label className="voice-field"><span>📸 {L('Photograph what you received', 'ថតអ្វីដែលអ្នកបានទទួល')}</span></label>
      <div className="trace-thumbs">
        {photos.map((p, i) => <img key={i} src={p.thumb} alt="" />)}
        <button className="trace-add" onClick={() => fileRef.current?.click()}>＋</button>
      </div>
      {photoError && <p className="voice-error">⚠ {photoError}</p>}
      {originHasEmbed && !m.on && (
        <small className="hint">✨ {L('This proof used better matching — turn it on for the most accurate result.',
          'ភស្តុតាងនេះប្រើការផ្គូផ្គងកាន់តែល្អ — សូមបើកវាដើម្បីលទ្ធផលត្រឹមត្រូវបំផុត។')}</small>
      )}
      <MatcherToggle m={m} L={L} />
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
  const { ocr } = useTraceCaps()
  const ref = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  if (!ocr) return null // no OCR engine injected → user types the label
  return (
    <>
      <input ref={ref} type="file" accept="image/*" capture="environment" hidden
        onChange={async (e) => {
          const f = e.target.files?.[0]
          if (!f) return
          setBusy(true)
          try {
            const t = await ocr.recognizeImage(f)
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

/* ------------------------------------------------ voice story (Khmer STT) --- */

function VoiceStory({ onText, L }: { onText: (t: string) => void; L: LFn }) {
  const { stt } = useTraceCaps()
  const [st, setSt] = useState<SttState>({ phase: 'idle' })
  useEffect(() => (stt ? stt.subscribe(setSt) : undefined), [stt])
  if (!stt || !stt.supported()) return null // no STT engine injected

  const rec = st.phase === 'recording'
  const busy = st.phase === 'loading' || st.phase === 'transcribing'
  const toggle = async () => {
    if (rec) {
      const t = await stt.stopAndTranscribe()
      if (t.trim()) onText(t.trim())
    } else {
      await stt.startRecording()
    }
  }
  const label = rec
    ? `⏹ ${L('Stop & add', 'ឈប់ & បន្ថែម')}`
    : st.phase === 'loading'
      ? `${L('Loading voice model', 'កំពុងផ្ទុកម៉ូឌែលសំឡេង')}${st.download != null ? ` ${Math.round(st.download * 100)}%` : ''}…`
      : st.phase === 'transcribing'
        ? `${L('Transcribing', 'កំពុងបម្លែង')}…`
        : `🎤 ${L('Speak the story (Khmer)', 'និយាយរឿង (ខ្មែរ)')}`
  return (
    <button type="button" className={`voice-ghost trace-scan ${rec ? 'trace-rec' : ''}`} disabled={busy} onClick={toggle}>
      {label}
    </button>
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

/* -------------------------------------------------- consumer provenance --- */

function ProvenancePage({
  id, capsule, attestations, state, L, onAttested,
}: {
  id: string
  capsule: TraceCapsule | null
  attestations: Attestation[]
  state: 'loading' | 'ready' | 'missing' | 'off'
  L: LFn
  onAttested: () => void
}) {
  const [verifying, setVerifying] = useState(false)

  if (state === 'loading') {
    return <div className="contribute trace"><p className="voice-tip">{L('Loading…', 'កំពុងផ្ទុក…')}</p></div>
  }
  if (state === 'missing' || !capsule) {
    return (
      <div className="contribute trace">
        <p className="voice-error">{L('This provenance page was not found (or you are offline).', 'រកមិនឃើញទំព័រប្រភពនេះ (ឬអ្នកនៅក្រៅបណ្ដាញ)។')}</p>
      </div>
    )
  }
  if (verifying) {
    return (
      <div className="contribute trace">
        <button className="voice-ghost" onClick={() => setVerifying(false)}>← {L('Back to page', 'ត្រឡប់ទៅទំព័រ')}</button>
        <Verify L={L} preload={capsule} />
      </div>
    )
  }

  const c = capsule.context
  const hero = capsule.match.photos[0]?.thumb
  return (
    <div className="trace-page">
      {hero && <img className="trace-page-hero" src={hero} alt="" />}
      <div className="trace-page-body">
        <h2>{c.product || L('Product', 'ផលិតផល')}</h2>
        <div style={{ margin: '4px 0 8px' }}><TierBadge tier={tierFromCapsule(capsule)} L={L} /></div>
        {c.producer && <div className="trace-page-producer">👤 {c.producer}</div>}

        {capsule.match.photos.length > 1 && (
          <div className="trace-thumbs">
            {capsule.match.photos.slice(1).map((p, i) => <img key={i} src={p.thumb} alt="" />)}
          </div>
        )}

        {c.note && <p className="trace-page-story" lang="km">{c.note}</p>}

        <div className="trace-page-facts">
          {c.gps && (
            <a href={`https://www.google.com/maps?q=${c.gps.lat},${c.gps.lng}`} target="_blank" rel="noreferrer">
              📍 {c.gps.lat}, {c.gps.lng}
            </a>
          )}
          <span>🕒 {new Date(c.capturedAt).toLocaleDateString()}</span>
        </div>

        {(c.witness || attestations.length > 0) && (
          <div className="trace-page-witness">
            <h3>🤝 {L('Vouched for by', 'ធានាដោយ')}</h3>
            {c.witness && <div className="trace-witness-row">{c.witness} <em>({L('named at origin', 'មានឈ្មោះនៅប្រភព')})</em></div>}
            {attestations.map((a, i) => (
              <div key={i} className="trace-witness-row">
                <b>{a.name}</b>{a.role ? ` · ${a.role}` : ''}{a.note ? ` — ${a.note}` : ''}
                <em> · {new Date(a.createdAt).toLocaleDateString()}</em>
              </div>
            ))}
          </div>
        )}

        <button className="voice-primary big" onClick={() => setVerifying(true)}>
          ✓ {L('Verify this product yourself', 'ផ្ទៀងផ្ទាត់ផលិតផលនេះដោយខ្លួនឯង')}
        </button>

        <AttestForm id={id} L={L} onAttested={onAttested} />

        <p className="voice-minor-note">
          {L('This is a self-published origin story, strengthened by the witnesses above. Verify it yourself with the button.',
             'នេះជារឿងប្រភពដែលបានផ្សាយដោយខ្លួនឯង ព្រងឹងដោយសាក្សីខាងលើ។ សូមផ្ទៀងផ្ទាត់ដោយប៊ូតុង។')}
        </p>
      </div>
    </div>
  )
}

/* --------------------------------------------------- proof-strength tiers --- */

function tierName(level: number, L: LFn): string {
  return [
    '',
    L('Basic', 'មូលដ្ឋាន'),
    L('Good', 'ល្អ'),
    L('Strong', 'រឹងមាំ'),
    L('Full journey', 'ដំណើរពេញ'),
  ][level] ?? ''
}

function tierHint(key: Tier['nextKey'], L: LFn): string {
  return {
    photo2label: L('Add the box / label text to reach "Good".', 'បន្ថែមអក្សរនៅលើប្រអប់ / ស្លាក ដើម្បីទៅ "ល្អ"។'),
    geowitness: L('Add location or a witness to reach "Strong".', 'បន្ថែមទីតាំង ឬសាក្សី ដើម្បីទៅ "រឹងមាំ"។'),
    journey: L('Link it into a journey for the top level.', 'ភ្ជាប់ទៅដំណើរ សម្រាប់កម្រិតខ្ពស់បំផុត។'),
  }[key ?? 'journey'] ?? ''
}

/** Live strength meter (shown in Create). Encourages, never blocks. */
function StrengthMeter({ tier, L }: { tier: Tier; L: LFn }) {
  return (
    <div className={`trace-strength lvl-${tier.level}`}>
      <div className="trace-strength-top">
        <div className="trace-strength-dots">
          {[1, 2, 3, 4].map((n) => <i key={n} className={n <= tier.level ? 'on' : ''} />)}
        </div>
        <b>{L('Level', 'កម្រិត')} {tier.level} · {tierName(tier.level, L)}</b>
      </div>
      {tier.nextKey && <small>{tierHint(tier.nextKey, L)}</small>}
    </div>
  )
}

/** Compact badge (shown on a finished proof / verify / provenance). */
function TierBadge({ tier, L }: { tier: Tier; L: LFn }) {
  return (
    <span className={`trace-tier-badge lvl-${tier.level}`}>
      🛡️ {L('Level', 'កម្រិត')} {tier.level} · {tierName(tier.level, L)}
    </span>
  )
}

/* -------------------------------------------------- journey (event chain) --- */

function eventLabel(t: string, L: LFn): string {
  return {
    harvest: L('Harvest', 'ប្រមូលផល'),
    process: L('Process', 'កែច្នៃ'),
    pack: L('Pack', 'ខ្ចប់'),
    ship: L('Ship', 'ដឹកជញ្ជូន'),
    receive: L('Receive', 'ទទួល'),
    other: L('Other', 'ផ្សេងៗ'),
  }[t] ?? t
}

function Journey({ L }: { L: LFn }) {
  const [result, setResult] = useState<ChainResult | null>(null)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLInputElement>(null)

  async function load(files: FileList) {
    setBusy(true)
    const caps: TraceCapsule[] = []
    for (const f of files) {
      try { caps.push(JSON.parse(await f.text()) as TraceCapsule) } catch { /* skip */ }
    }
    setResult(caps.length ? await verifyChain(caps) : null)
    setBusy(false)
  }

  function download(kind: 'json' | 'csv') {
    if (!result) return
    const rep = complianceReport(result.ordered)
    const blob = new Blob([kind === 'json' ? rep.json : rep.csv],
      { type: kind === 'json' ? 'application/json' : 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `trace-journey.${kind}`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <>
      <input ref={ref} type="file" accept="application/json,.json" multiple hidden
        onChange={(e) => e.target.files && load(e.target.files)} />
      <p className="voice-tip">
        {L('Load all the proof files of a journey (harvest → … → receive) to verify the chain and export a compliance report.',
           'ផ្ទុកឯកសារភស្តុតាងទាំងអស់នៃដំណើរមួយ (ប្រមូលផល → … → ទទួល) ដើម្បីផ្ទៀងផ្ទាត់ខ្សែសង្វាក់ និងនាំចេញរបាយការណ៍អនុលោមភាព។')}
      </p>
      <button className="voice-primary big" disabled={busy} onClick={() => ref.current?.click()}>
        {busy ? `${L('Checking', 'កំពុងពិនិត្យ')}…` : `🧭 ${L('Load journey files', 'ផ្ទុកឯកសារដំណើរ')}`}
      </button>

      {result && (
        <>
          <div className={`trace-chain-status ${result.ok ? 'ok' : 'bad'}`}>
            {result.ok ? `✓ ${L('Chain verified — tamper-evident end to end', 'ខ្សែសង្វាក់បានផ្ទៀងផ្ទាត់ — គ្មានការកែប្រែ')}`
              : `⚠ ${L('Chain has problems', 'ខ្សែសង្វាក់មានបញ្ហា')}`}
          </div>
          <div className="trace-timeline">
            {result.ordered.map((n, i) => (
              <div key={i} className={`trace-tl-node ${n.integrityOk && n.linkOk ? '' : 'bad'}`}>
                <div className="trace-tl-dot">{n.integrityOk && n.linkOk ? '✓' : '✕'}</div>
                <div className="trace-tl-body">
                  <b>{i + 1}. {eventLabel(n.capsule.event?.type ?? 'event', L)}</b>
                  <div className="trace-tl-meta">
                    {new Date(n.capsule.context.capturedAt).toLocaleDateString()}
                    {n.capsule.context.gps && ` · 📍 ${n.capsule.context.gps.lat}, ${n.capsule.context.gps.lng}`}
                    {n.capsule.context.producer && ` · ${n.capsule.context.producer}`}
                  </div>
                </div>
              </div>
            ))}
          </div>
          {result.issues.length > 0 && (
            <ul className="trace-issues">{result.issues.map((s, i) => <li key={i}>{s}</li>)}</ul>
          )}
          <div className="voice-controls">
            <button className="voice-ghost" onClick={() => download('csv')}>⬇ CSV</button>
            <button className="voice-primary" onClick={() => download('json')}>
              ⬇ {L('Compliance report', 'របាយការណ៍អនុលោមភាព')}
            </button>
          </div>
          <p className="voice-minor-note">
            {L('For export due-diligence (e.g. EU EUDR): geolocation + a tamper-evident chain of custody. Geolocation is self-reported at capture.',
               'សម្រាប់ការត្រួតពិនិត្យនាំចេញ (ឧ. EU EUDR)៖ ទីតាំង + ខ្សែសង្វាក់ការកាន់កាប់ដែលមិនអាចកែប្រែ។ ទីតាំងជាការរាយការណ៍ដោយខ្លួនឯង។')}
          </p>
        </>
      )}
    </>
  )
}

function AttestForm({ id, L, onAttested }: { id: string; L: LFn; onAttested: () => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [note, setNote] = useState('')
  const [done, setDone] = useState(false)

  if (done) return <p className="voice-tip">✓ {L('Thank you — your confirmation was added.', 'អរគុណ — ការបញ្ជាក់របស់អ្នកត្រូវបានបន្ថែម។')}</p>
  if (!open) {
    return (
      <button className="voice-ghost" onClick={() => setOpen(true)}>
        🤝 {L('I can vouch for this (co-op / buyer)', 'ខ្ញុំអាចធានារឿងនេះ (សហករណ៍ / អ្នកទិញ)')}
      </button>
    )
  }
  return (
    <div className="trace-attest">
      <label className="voice-field"><span>{L('Your name', 'ឈ្មោះរបស់អ្នក')}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label className="voice-field"><span>{L('Role (co-op, buyer…)', 'តួនាទី (សហករណ៍ អ្នកទិញ…)')}</span>
        <input value={role} onChange={(e) => setRole(e.target.value)} /></label>
      <label className="voice-field"><span>{L('Note (optional)', 'កំណត់ចំណាំ (ស្រេចចិត្ត)')}</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <button className="voice-primary" disabled={!name.trim()}
        onClick={async () => { if (await addAttestation(id, { name: name.trim(), role, note })) { setDone(true); onAttested() } }}>
        {L('Add my confirmation', 'បន្ថែមការបញ្ជាក់')}
      </button>
    </div>
  )
}
