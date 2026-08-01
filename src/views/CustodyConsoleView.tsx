import { useEffect, useState } from 'react'
import { useI18n } from '../i18n'
import {
  acceptHandoff,
  addCustody,
  clearDelegation,
  fetchCustody,
  fetchHandoffOffer,
  fetchHandoffStatus,
  fetchPartner,
  fetchRevocations,
  getStaffKey,
  importDelegation,
  loadDelegation,
  loadRoster,
  mintDelegation,
  peekPub,
  registerCompany,
  revokeStaff,
  startHandoff,
  verifyDomain,
  vouchFor,
  WELL_KNOWN_PATH,
  type CustodyEvent,
  type CustodyItem,
  type CustodyRole,
  type Delegation,
  type HandoffRelease,
  type PartnerProof,
  type RosterEntry,
} from '../../trace/web/companion'
import { qrSvg } from '../lib/qr'
import { isBarcodeSupported } from '../lib/barcode'
import { QrScanner } from './QrScanner'
import { computeTrust, fetchPage, photoSignature } from '../../trace/core/trace'

/**
 * 🚚 Trace companion console (/custody) — the B2B tool for supply-chain actors
 * (delivery, warehouse, exporter) to JOIN a product's proof with device-signed
 * custody events. Three tabs:
 *   • Add event   — staff sign a handoff/store/deliver event onto a capsule.
 *   • My identity — this device's staff key + import a company delegation.
 *   • Company     — an admin registers the company + enrolls staff (mints a
 *                   delegation to hand back). Keys never leave the device.
 */

const ROLES: CustodyRole[] = ['carrier', 'warehouse', 'exporter', 'distributor', 'inspector', 'other']
const EVENTS: CustodyEvent[] = ['pickup', 'in_transit', 'store', 'handoff', 'deliver', 'inspect']

export function CustodyConsoleView() {
  const { lang } = useI18n()
  const km = lang === 'km'
  // Deep links from /trace: ?h=CODE (a scanned handoff QR → Receive) and
  // ?c=<capsuleId> (a maker handing a product to a partner → capsule pre-filled).
  const params = new URLSearchParams(location.search)
  const handoffCode = params.get('h')
  const deepCapsule = (params.get('c') ?? '').toLowerCase()
  const capsuleParam = /^[0-9a-f]{64}$/.test(deepCapsule) ? deepCapsule : ''
  const [tab, setTab] = useState<'event' | 'handoff' | 'identity' | 'company'>(handoffCode ? 'handoff' : 'event')

  return (
    <div className="contribute">
      <div className="sign-modetabs" role="tablist">
        <button className={`sign-modetab ${tab === 'event' ? 'active' : ''}`} onClick={() => setTab('event')}>
          📦 {km ? 'ព្រឹត្តិការណ៍' : 'Add event'}
        </button>
        <button className={`sign-modetab ${tab === 'handoff' ? 'active' : ''}`} onClick={() => setTab('handoff')}>
          🤝 {km ? 'ប្រគល់' : 'Handoff'}
        </button>
        <button className={`sign-modetab ${tab === 'identity' ? 'active' : ''}`} onClick={() => setTab('identity')}>
          🪪 {km ? 'អត្តសញ្ញាណ' : 'Identity'}
        </button>
        <button className={`sign-modetab ${tab === 'company' ? 'active' : ''}`} onClick={() => setTab('company')}>
          🏢 {km ? 'ក្រុមហ៊ុន' : 'Company'}
        </button>
      </div>

      {tab === 'event' ? <AddEvent km={km} deepCapsule={capsuleParam} />
        : tab === 'handoff' ? <Handoff km={km} deepCode={handoffCode} deepCapsule={capsuleParam} />
          : tab === 'identity' ? <Identity km={km} />
            : <Company km={km} />}
    </div>
  )
}

/* ------------------------------------------------------------- handoff --- */

function Handoff({ km, deepCode, deepCapsule }: { km: boolean; deepCode: string | null; deepCapsule: string }) {
  const [side, setSide] = useState<'send' | 'receive'>(deepCode ? 'receive' : 'send')
  return (
    <>
      <div className="sign-modetabs" role="tablist" style={{ marginTop: 4 }}>
        <button className={`sign-modetab ${side === 'send' ? 'active' : ''}`} onClick={() => setSide('send')}>
          📤 {km ? 'ប្រគល់ (អ្នកផ្ញើ)' : 'Give (sender)'}
        </button>
        <button className={`sign-modetab ${side === 'receive' ? 'active' : ''}`} onClick={() => setSide('receive')}>
          📥 {km ? 'ទទួល (អ្នកទទួល)' : 'Receive'}
        </button>
      </div>
      <p className="voice-lead-sm">
        {km
          ? 'ភាគីទាំងពីរចុះហត្ថលេខាលើការប្រគល់តែមួយ — ភ័ស្តុតាងថាទំនិញបានប្តូរដៃ។ អ្នកផ្ញើបង្កើតលេខកូដ អ្នកទទួលបញ្ចូលវា។'
          : 'Both parties sign the same handoff — proof the goods changed hands. The sender creates a code; the receiver enters it.'}
      </p>
      {side === 'send' ? <HandoffSend km={km} deepCapsule={deepCapsule} /> : <HandoffReceive km={km} deepCode={deepCode} />}
    </>
  )
}

function HandoffSend({ km, deepCapsule }: { km: boolean; deepCapsule: string }) {
  const [capsule, setCapsule] = useState(deepCapsule)
  const [name, setName] = useState('')
  const [gps, setGps] = useState<{ lat: number; lng: number; acc?: number } | null>(null)
  const [code, setCode] = useState('')
  const [received, setReceived] = useState<{ by: string | null; at: string | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Once a code is live, poll until the customer confirms receipt (POD loop).
  useEffect(() => {
    if (!code || received) return
    let stop = false
    const id = window.setInterval(async () => {
      const s = await fetchHandoffStatus(code)
      if (stop) return
      if (s.status === 'received') { setReceived({ by: s.receivedBy ?? null, at: s.at ?? null }); window.clearInterval(id) }
      else if (s.status === 'expired' || s.status === 'notfound') window.clearInterval(id)
    }, 4000)
    return () => { stop = true; window.clearInterval(id) }
  }, [code, received])

  function locate() {
    navigator.geolocation?.getCurrentPosition(
      (p) => setGps({ lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) }),
      () => setError(km ? 'មិនអាចទាញទីតាំង' : 'Could not get location'),
      { enableHighAccuracy: true, timeout: 8000 },
    )
  }
  async function go() {
    const id = capsule.trim().toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(id)) { setError(km ? 'លេខសម្គាល់មិនត្រឹមត្រូវ (៦៤ តួ)' : 'Capsule id must be 64 hex'); return }
    setBusy(true); setError('')
    try {
      const r = await startHandoff({ capsule: id, actorName: name.trim(), gps })
      setCode(r.code)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (received) {
    return (
      <div className="handoff-codebox">
        <div className="handoff-received">✓ {km ? 'បានទទួល' : 'Received'}</div>
        <p className="sign-review-note">
          {received.by ? `${km ? 'ដោយ' : 'by'} ${received.by} · ` : ''}
          {received.at ? new Date(received.at).toLocaleString() : ''}
        </p>
        <p className="voice-minor-note">
          {km ? 'ភ័ស្តុតាងនៃការប្រគល់ត្រូវបានចុះហត្ថលេខា និងកត់ត្រា។' : 'Proof of delivery is signed and recorded.'}
        </p>
        <button className="voice-ghost" onClick={() => { setReceived(null); setCode(''); setCapsule('') }}>
          ↺ {km ? 'ការប្រគល់ថ្មី' : 'New handoff'}
        </button>
      </div>
    )
  }
  if (code) {
    const link = `${location.origin}/custody?h=${code}`
    return (
      <div className="handoff-codebox">
        <p>{km ? 'អ្នកទទួលស្កេន QR ឬបញ្ចូលលេខកូដ៖' : 'Receiver scans the QR, or enters the code:'}</p>
        <div className="handoff-qr" dangerouslySetInnerHTML={{ __html: qrSvg(link) }} />
        <div className="handoff-code">{code}</div>
        <p className="voice-minor-note handoff-waiting">
          ⏳ {km ? 'កំពុងរង់ចាំការបញ្ជាក់ពីអ្នកទទួល…' : 'Waiting for the receiver to confirm…'}
        </p>
        <p className="voice-minor-note">{km ? 'មានសុពលភាព ១ ម៉ោង · ប្រើបានតែម្តង' : 'Valid 1 hour · single use'}</p>
        <button className="voice-ghost" onClick={() => { setCode(''); setCapsule('') }}>
          ↺ {km ? 'ការប្រគល់ថ្មី' : 'New handoff'}
        </button>
      </div>
    )
  }
  return (
    <>
      <fieldset className="voice-fields">
        <label className="voice-field">
          <span>{km ? 'លេខសម្គាល់កាបសែល' : 'Capsule id'}</span>
          <input type="text" value={capsule} placeholder="64 hex…" onChange={(e) => setCapsule(e.target.value)} />
        </label>
        <label className="voice-field">
          <span>{km ? 'ឈ្មោះរបស់អ្នក (ស្រេចចិត្ត)' : 'Your name (optional)'}</span>
          <input type="text" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </label>
      </fieldset>
      <div className="voice-controls">
        <button className="voice-ghost" onClick={locate}>
          📍 {gps ? `${gps.lat.toFixed(3)}, ${gps.lng.toFixed(3)}` : (km ? 'ភ្ជាប់ទីតាំង' : 'Add location')}
        </button>
        <button className="voice-primary big" onClick={go} disabled={busy}>
          {busy ? '…' : `🤝 ${km ? 'បង្កើតលេខកូដ' : 'Create handoff code'}`}
        </button>
      </div>
      {error ? <p className="voice-error">{error}</p> : null}
    </>
  )
}

async function sha256Blob(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Pull a handoff code out of a scanned QR: a /custody?h=CODE URL, or a bare code. */
function codeFromScan(value: string): string | null {
  try {
    const h = new URL(value).searchParams.get('h')
    if (h) return h.toUpperCase()
  } catch { /* not a URL */ }
  const t = value.trim().toUpperCase()
  return /^[A-Z2-9]{4,12}$/.test(t) ? t : null
}

function HandoffReceive({ km, deepCode }: { km: boolean; deepCode: string | null }) {
  const [code, setCode] = useState((deepCode ?? '').toUpperCase())
  const [scanning, setScanning] = useState(false)
  const [offer, setOffer] = useState<HandoffRelease | null>(null)
  const [senderCo, setSenderCo] = useState<{ name: string; verified: boolean } | null>(null)
  const [name, setName] = useState('')
  const [gps, setGps] = useState<{ lat: number; lng: number; acc?: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  // Optional photo-of-item check: hash (committed in the receipt) + a match vs
  // the origin capsule (advisory — only when the product has a published page).
  const [photoHash, setPhotoHash] = useState<string | null>(null)
  const [photoThumb, setPhotoThumb] = useState('')
  const [match, setMatch] = useState<{ score: number; band: string } | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)

  function locate() {
    navigator.geolocation?.getCurrentPosition(
      (p) => setGps({ lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) }),
      () => setError(km ? 'មិនអាចទាញទីតាំង' : 'Could not get location'),
      { enableHighAccuracy: true, timeout: 8000 },
    )
  }

  async function onPhoto(file: File | null) {
    if (!file || !offer) return
    setPhotoBusy(true); setError(''); setMatch(null)
    try {
      const [hash, sig] = await Promise.all([sha256Blob(file), photoSignature(file)])
      setPhotoHash(hash)
      setPhotoThumb(sig.thumb)
      // Re-match against the origin capsule's published signatures, if any.
      const capsule = await fetchPage(offer.capsule)
      if (capsule) {
        const r = computeTrust(capsule, { photos: [sig], boxText: '' }, true)
        setMatch({ score: r.score, band: r.band })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPhotoBusy(false)
    }
  }
  async function lookup(codeArg?: string) {
    const c = (codeArg ?? code).trim().toUpperCase()
    if (!c) return
    setBusy(true); setError(''); setOffer(null); setSenderCo(null)
    const r = await fetchHandoffOffer(c)
    setBusy(false)
    if (!r.ok) {
      setError(r.error === 'expired' ? (km ? 'លេខកូដផុតកំណត់' : 'This code has expired') : (km ? 'រកមិនឃើញលេខកូដ' : 'Code not found'))
      return
    }
    setOffer(r.release)
    if (r.release.fromDelegation) setSenderCo(await fetchPartner(r.release.fromDelegation.company))
  }

  // A scanned QR lands here with ?h=CODE — look it up automatically once.
  useEffect(() => {
    if (deepCode) void lookup(deepCode)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  async function accept() {
    if (!offer) return
    setBusy(true); setError('')
    try {
      const r = await acceptHandoff(code.trim().toUpperCase(), offer, {
        actorName: name.trim(), gps, photoHash, match: match?.score ?? null,
      })
      setDone(r.toCompany
        ? (km ? '✓ បានទទួល ជាមួយក្រុមហ៊ុន' : '✓ Received, attributed to your company')
        : (km ? '✓ បានទទួល (ដោយខ្លួនឯង)' : '✓ Received (self-claimed)'))
      setOffer(null); setCode('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="handoff-codebox">
        <p className="sign-review-note">{done}</p>
        <button className="voice-ghost" onClick={() => setDone('')}>↺ {km ? 'ទទួលមួយទៀត' : 'Receive another'}</button>
      </div>
    )
  }
  return (
    <>
      {scanning ? (
        <QrScanner
          hint={km ? 'តម្រង់ QR ចូលក្នុងស៊ុម' : 'Point the camera at the QR code'}
          unsupported={km ? 'ឧបករណ៍នេះស្កេនមិនបាន — សូមវាយលេខកូដ' : 'This device can’t scan — type the code instead'}
          closeLabel={km ? 'បិទ' : 'Close'}
          onClose={() => setScanning(false)}
          onScan={(value) => {
            setScanning(false)
            const c = codeFromScan(value)
            if (c) { setCode(c); void lookup(c) }
            else setError(km ? 'QR នេះមិនមែនជាលេខកូដប្រគល់' : 'That QR is not a handoff code')
          }}
        />
      ) : null}

      <div className="voice-controls">
        <input className="handoff-codein" value={code} placeholder={km ? 'លេខកូដ' : 'Handoff code'}
          maxLength={12} onChange={(e) => setCode(e.target.value.toUpperCase())} />
        {isBarcodeSupported() ? (
          <button className="voice-ghost" onClick={() => { setError(''); setScanning(true) }}>
            📷 {km ? 'ស្កេន' : 'Scan'}
          </button>
        ) : null}
        <button className="voice-primary" onClick={() => lookup()} disabled={busy || !code.trim()}>
          🔎 {km ? 'រក' : 'Look up'}
        </button>
      </div>

      {offer ? (
        <div className="custody-row" style={{ marginTop: 12 }}>
          <div className="custody-row-top">
            <b>{km ? 'ការប្រគល់ពី' : 'Handoff from'}</b>
            {senderCo ? (
              <span className={`custody-tag ${senderCo.verified ? 'ok' : ''}`}>
                {senderCo.verified ? '✓ ' : ''}{senderCo.name}
              </span>
            ) : offer.fromDelegation ? (
              <span className="custody-tag">{km ? 'ក្រុមហ៊ុន' : 'a company'}</span>
            ) : (
              <span className="custody-tag self">{km ? 'ដោយខ្លួនឯង' : 'self-claimed'}</span>
            )}
          </div>
          <div className="custody-row-sub">
            {offer.fromName ? `${offer.fromName} · ` : ''}
            {km ? 'កាបសែល' : 'capsule'} {offer.capsule.slice(0, 10)}…
            {offer.gps ? ` · ~${offer.gps.lat.toFixed(2)}, ${offer.gps.lng.toFixed(2)}` : ''}
          </div>
        </div>
      ) : null}

      {offer ? (
        <>
          <label className="sign-filepick" style={{ marginTop: 12 }}>
            <input type="file" accept="image/*" capture="environment"
              onChange={(e) => void onPhoto(e.target.files?.[0] ?? null)} />
            <span>{photoBusy ? '…' : photoThumb ? `📷 ${km ? 'រូបភាពបានបន្ថែម' : 'Photo added'}` : `📷 ${km ? 'ថតរូបទំនិញ (ស្រេចចិត្ត)' : 'Photo of the item (optional)'}`}</span>
          </label>
          {photoThumb ? (
            <div className="handoff-photo">
              <img src={photoThumb} alt="" />
              {match ? (
                <span className={`custody-tag ${match.band === 'strong' || match.band === 'good' ? 'ok' : ''}`}>
                  {match.band === 'strong' || match.band === 'good'
                    ? `✓ ${km ? 'ត្រូវនឹងទំនិញ' : 'Matches the product'} · ${match.score}%`
                    : `⚠ ${km ? 'ផ្គូផ្គងខ្សោយ' : 'Weak match'} · ${match.score}%`}
                </span>
              ) : (
                <span className="custody-tag self">{km ? 'គ្មានប្រភពផ្សព្វផ្សាយ ដើម្បីផ្គូផ្គង' : 'no published origin to match'}</span>
              )}
            </div>
          ) : null}

          <fieldset className="voice-fields" style={{ marginTop: 10 }}>
            <label className="voice-field">
              <span>{km ? 'ឈ្មោះរបស់អ្នក (ស្រេចចិត្ត)' : 'Your name (optional)'}</span>
              <input type="text" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
            </label>
          </fieldset>
          <div className="voice-controls">
            <button className="voice-ghost" onClick={locate}>
              📍 {gps ? `${gps.lat.toFixed(3)}, ${gps.lng.toFixed(3)}` : (km ? 'ភ្ជាប់ទីតាំង' : 'Add location')}
            </button>
            <button className="voice-primary big" onClick={accept} disabled={busy}>
              {busy ? '…' : `✓ ${km ? 'បញ្ជាក់ថាបានទទួល' : 'Confirm I received this'}`}
            </button>
          </div>
        </>
      ) : null}

      {error ? <p className="voice-error">{error}</p> : null}
    </>
  )
}

/* ----------------------------------------------------------- add event --- */

function AddEvent({ km, deepCapsule }: { km: boolean; deepCapsule: string }) {
  const [capsule, setCapsule] = useState(deepCapsule)
  const [actorName, setActorName] = useState('')
  const [role, setRole] = useState<CustodyRole>('carrier')
  const [event, setEvent] = useState<CustodyEvent>('handoff')
  const [note, setNote] = useState('')
  const [gps, setGps] = useState<{ lat: number; lng: number; acc?: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [timeline, setTimeline] = useState<CustodyItem[] | null>(null)
  const del = loadDelegation()

  function locate() {
    setError('')
    navigator.geolocation?.getCurrentPosition(
      (p) => setGps({ lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) }),
      () => setError(km ? 'មិនអាចទាញទីតាំង' : 'Could not get location'),
      { enableHighAccuracy: true, timeout: 8000 },
    )
  }

  async function submit() {
    const id = capsule.trim().toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(id)) {
      setError(km ? 'លេខសម្គាល់កាបសែលមិនត្រឹមត្រូវ (៦៤ តួ)' : 'Capsule id must be 64 hex characters')
      return
    }
    if (!actorName.trim()) {
      setError(km ? 'សូមបញ្ចូលឈ្មោះរបស់អ្នក' : 'Enter your name')
      return
    }
    setBusy(true); setError(''); setMsg('')
    try {
      const r = await addCustody({ capsule: id, actorName: actorName.trim(), role, event, gps, note: note.trim() })
      setMsg(
        r.selfClaimed
          ? (km ? '✓ បានកត់ត្រា (ដោយខ្លួនឯង)' : '✓ Recorded (self-claimed)')
          : (km ? '✓ បានកត់ត្រា ជាមួយក្រុមហ៊ុន' : '✓ Recorded, attributed to your company'),
      )
      setNote('')
      setTimeline(await fetchCustody(id))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <p className="contribute-lead">
        {km
          ? 'ស្កេន ឬបញ្ចូលលេខសម្គាល់ផលិតផល រួចចុះហត្ថលេខាព្រឹត្តិការណ៍ចរាចរណ៍ (ទទួល · ស្តុក · ប្រគល់)។'
          : 'Scan or paste a product’s capsule id, then sign a custody event (pickup · store · handoff · deliver).'}
      </p>

      <div className={`custody-badge ${del ? 'company' : 'self'}`}>
        {del
          ? `🏢 ${km ? 'តំណាងក្រុមហ៊ុន' : 'Acting for company'} · ${del.staffName || ''} (${del.role})`
          : `👤 ${km ? 'ដោយខ្លួនឯង (គ្មានក្រុមហ៊ុន)' : 'Self-claimed (no company linked)'}`}
      </div>

      <fieldset className="voice-fields">
        <label className="voice-field">
          <span>{km ? 'លេខសម្គាល់កាបសែល (Capsule id)' : 'Capsule id'}</span>
          <input type="text" value={capsule} placeholder="64 hex…" onChange={(e) => setCapsule(e.target.value)} />
        </label>
        <label className="voice-field">
          <span>{km ? 'ឈ្មោះរបស់អ្នក' : 'Your name'}</span>
          <input type="text" value={actorName} maxLength={80} onChange={(e) => setActorName(e.target.value)} />
        </label>
        <label className="voice-field">
          <span>{km ? 'តួនាទី' : 'Role'}</span>
          <select value={role} onChange={(e) => setRole(e.target.value as CustodyRole)}>
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <label className="voice-field">
          <span>{km ? 'ប្រភេទព្រឹត្តិការណ៍' : 'Event'}</span>
          <select value={event} onChange={(e) => setEvent(e.target.value as CustodyEvent)}>
            {EVENTS.map((ev) => <option key={ev} value={ev}>{ev}</option>)}
          </select>
        </label>
        <label className="voice-field">
          <span>{km ? 'កំណត់ចំណាំ (ស្រេចចិត្ត)' : 'Note (optional)'}</span>
          <input type="text" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
        </label>
      </fieldset>

      <div className="voice-controls">
        <button className="voice-ghost" onClick={locate}>
          📍 {gps ? `${gps.lat.toFixed(3)}, ${gps.lng.toFixed(3)}` : (km ? 'ភ្ជាប់ទីតាំង' : 'Add location')}
        </button>
        <button className="voice-primary big" onClick={submit} disabled={busy}>
          {busy ? '…' : `✍️ ${km ? 'ចុះហត្ថលេខា & ដាក់ស្នើ' : 'Sign & submit'}`}
        </button>
      </div>

      {error ? <p className="voice-error">{error}</p> : null}
      {msg ? <p className="sign-review-note">{msg}</p> : null}

      {timeline && timeline.length > 0 ? <CustodyTimeline km={km} items={timeline} /> : null}
    </>
  )
}

/** Read-only custody timeline for a capsule (reused by the provenance page too). */
export function CustodyTimeline({ km, items }: { km: boolean; items: CustodyItem[] }) {
  return (
    <div className="custody-timeline">
      <h3 className="custody-timeline-h">🚚 {km ? 'ខ្សែសង្វាក់ចរាចរណ៍' : 'Chain of custody'}</h3>
      {items.map((it) => (
        <div className="custody-row" key={it.id}>
          <div className="custody-row-top">
            <b>{it.event}</b> · {it.role}
            {it.company ? (
              <span className={`custody-tag ${it.company.verified ? 'ok' : ''}`}>
                {it.company.verified ? '✓ ' : ''}{it.company.name}
              </span>
            ) : (
              <span className="custody-tag self">{km ? 'ដោយខ្លួនឯង' : 'self-claimed'}</span>
            )}
          </div>
          <div className="custody-row-sub">
            {it.actorName ? `${it.actorName} · ` : ''}
            {new Date(it.createdAt).toLocaleString()}
            {it.lat != null ? ` · ~${it.lat.toFixed(2)}, ${it.lng?.toFixed(2)}` : ''}
          </div>
          {it.note ? <div className="custody-row-note">{it.note}</div> : null}
        </div>
      ))}
    </div>
  )
}

/* ---------------------------------------------------------- my identity --- */

function Identity({ km }: { km: boolean }) {
  const [pub, setPub] = useState<string>('')
  const [del, setDel] = useState<Delegation | null>(loadDelegation())
  const [paste, setPaste] = useState('')
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    void getStaffKey().then((k) => setPub(k.pub))
  }, [])

  async function doImport() {
    setError(''); setMsg('')
    let d: Delegation
    try {
      d = JSON.parse(paste.trim()) as Delegation
    } catch {
      setError(km ? 'អត្ថបទ delegation មិនត្រឹមត្រូវ' : 'That is not a valid delegation')
      return
    }
    try {
      const r = await importDelegation(d)
      if (!r.ok) {
        setError(
          r.expired ? (km ? 'Delegation ផុតកំណត់' : 'Delegation has expired')
            : !r.bound ? (km ? 'Delegation នេះមិនមែនសម្រាប់ឧបករណ៍នេះ' : 'This delegation is for a different device')
              : (km ? 'ហត្ថលេខាមិនត្រឹមត្រូវ' : 'Invalid signature'),
        )
        return
      }
      setDel(loadDelegation())
      setMsg(km ? '✓ បានភ្ជាប់ទៅក្រុមហ៊ុន' : '✓ Linked to your company')
      setPaste('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <>
      <p className="contribute-lead">
        {km
          ? 'ឧបករណ៍នេះមានកូនសោផ្ទាល់ខ្លួន។ ចែករំលែកកូនសោសាធារណៈទៅអ្នកគ្រប់គ្រង ដើម្បីភ្ជាប់ទៅក្រុមហ៊ុន។'
          : 'This device has its own key. Share its public key with your admin to be linked to a company.'}
      </p>

      <label className="voice-field">
        <span>{km ? 'កូនសោសាធារណៈរបស់អ្នក (បញ្ជូនទៅអ្នកគ្រប់គ្រង)' : 'Your public key (send to your admin)'}</span>
        <textarea className="custody-key" readOnly value={pub} rows={2} onFocus={(e) => e.target.select()} />
      </label>
      <button className="voice-ghost" onClick={() => void navigator.clipboard?.writeText(pub)}>
        📋 {km ? 'ចម្លងកូនសោ' : 'Copy key'}
      </button>

      <div className={`custody-badge ${del ? 'company' : 'self'}`} style={{ marginTop: 14 }}>
        {del
          ? `🏢 ${km ? 'បានភ្ជាប់' : 'Linked'} · ${del.staffName || ''} (${del.role})`
          : `👤 ${km ? 'មិនទាន់ភ្ជាប់ក្រុមហ៊ុន' : 'Not linked to a company yet'}`}
      </div>
      {del ? (
        <button className="voice-ghost" onClick={() => { clearDelegation(); setDel(null) }}>
          ✕ {km ? 'ផ្ដាច់ក្រុមហ៊ុន' : 'Unlink company'}
        </button>
      ) : null}

      <label className="voice-field" style={{ marginTop: 14 }}>
        <span>{km ? 'នាំចូល delegation ពីអ្នកគ្រប់គ្រង' : 'Paste a delegation from your admin'}</span>
        <textarea className="custody-key" value={paste} rows={4} placeholder='{"kind":"trace-delegation",…}'
          onChange={(e) => setPaste(e.target.value)} />
      </label>
      <button className="voice-primary" onClick={doImport} disabled={!paste.trim()}>
        ⬇️ {km ? 'នាំចូល' : 'Import delegation'}
      </button>
      {error ? <p className="voice-error">{error}</p> : null}
      {msg ? <p className="sign-review-note">{msg}</p> : null}
    </>
  )
}

/**
 * How this company earns its ✓ — three layered paths, each recorded with its
 * evidence so a buyer can audit (and re-check) the badge instead of trusting it:
 *   • domain   — publish the key on your own website; the node fetches it. Free,
 *                instant, no gatekeeper, re-checkable by anyone.
 *   • peer     — a co-op/association signs a vouch for you (done from THEIR device).
 *   • registry — an operator records an official record (MoC no.) after checking.
 */
function Verification({ km, companyPub }: { km: boolean; companyPub: string | null }) {
  const [proofs, setProofs] = useState<PartnerProof[]>([])
  const [domain, setDomain] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  // Vouching for someone ELSE (associations / co-ops use this).
  const [subject, setSubject] = useState('')
  const [ourName, setOurName] = useState('')

  useEffect(() => {
    if (companyPub) void fetchPartner(companyPub).then((p) => setProofs(p?.proofs ?? []))
  }, [companyPub])

  if (!companyPub) return null

  async function check() {
    setBusy(true); setErr(''); setMsg('')
    const r = await verifyDomain(domain.trim())
    setBusy(false)
    if (r.ok) {
      setMsg(km ? '✓ បានផ្ទៀងផ្ទាត់ដោយដែន' : '✓ Verified by domain')
      const p = await fetchPartner(companyPub!)
      setProofs(p?.proofs ?? [])
    } else setErr(r.error ?? 'failed')
  }

  return (
    <div className="custody-timeline">
      <h3 className="custody-timeline-h" style={{ marginTop: 20 }}>
        ✅ {km ? 'ការផ្ទៀងផ្ទាត់ក្រុមហ៊ុន' : 'Company verification'}
      </h3>

      {proofs.length > 0 ? (
        proofs.map((p) => (
          <div className="custody-row" key={`${p.method}-${p.evidence}`}>
            <div className="custody-row-top">
              <b>{p.method === 'domain' ? '🌐' : p.method === 'peer' ? '🤝' : '🏛️'} {p.method}</b>
              <span className="custody-tag ok">✓ {p.evidence.slice(0, 40)}</span>
            </div>
            <div className="custody-row-sub">
              {p.detail ? `${p.detail} · ` : ''}{new Date(p.createdAt).toLocaleDateString()}
            </div>
          </div>
        ))
      ) : (
        <p className="voice-minor-note">
          {km ? 'មិនទាន់មានការផ្ទៀងផ្ទាត់ — បង្ហាញជា «ដោយខ្លួនឯង»។' : 'Not verified yet — you show as self-claimed.'}
        </p>
      )}

      <label className="voice-field" style={{ marginTop: 12 }}>
        <span>{km ? 'ផ្ទៀងផ្ទាត់ដោយគេហទំព័ររបស់អ្នក' : 'Verify with your own website'}</span>
        <input type="text" value={domain} placeholder="kampotpepper.com"
          onChange={(e) => setDomain(e.target.value)} />
        <small>
          {km ? 'ដាក់កូនសោ root របស់អ្នកក្នុងឯកសារ ' : 'Put your root key in a file at '}
          <b>{WELL_KNOWN_PATH}</b>
          {km ? ' នៅលើគេហទំព័ររបស់អ្នក រួចចុចពិនិត្យ។' : ' on your site, then press check.'}
        </small>
      </label>
      <button className="voice-ghost" onClick={() => void check()} disabled={busy || !domain.trim()}>
        🌐 {busy ? '…' : (km ? 'ពិនិត្យដែន' : 'Check domain')}
      </button>
      {msg ? <p className="sign-review-note">{msg}</p> : null}
      {err ? <p className="voice-error">{err}</p> : null}
      <p className="voice-minor-note">
        {km
          ? 'ផ្លូវទី៣៖ ប្រតិបត្តិករកត់ត្រាលេខចុះបញ្ជីពាណិជ្ជកម្ម (ក្រោយពិនិត្យ)។'
          : 'Third path: an operator records your business-registration number after checking it.'}
      </p>

      <label className="voice-field" style={{ marginTop: 14 }}>
        <span>🤝 {km ? 'ធានាឲ្យក្រុមហ៊ុនផ្សេង (សម្រាប់សមាគម/សហករណ៍)' : 'Vouch for another company (associations / co-ops)'}</span>
        <textarea className="custody-key" value={subject} rows={2}
          placeholder={km ? 'កូនសោ root របស់ក្រុមហ៊ុននោះ' : "their company root key"}
          onChange={(e) => setSubject(e.target.value)} />
        <input type="text" value={ourName} maxLength={80}
          placeholder={km ? 'ឈ្មោះរបស់អ្នក (បង្ហាញជាអ្នកធានា)' : 'your name (shown as the voucher)'}
          onChange={(e) => setOurName(e.target.value)} />
      </label>
      <button className="voice-ghost" disabled={busy || !subject.trim() || !ourName.trim()}
        onClick={() => void (async () => {
          setBusy(true); setErr(''); setMsg('')
          try {
            await vouchFor(subject.trim(), ourName.trim())
            setMsg(km ? '✓ បានធានា' : '✓ Vouch signed and sent')
            setSubject('')
          } catch (e) {
            setErr(e instanceof Error ? e.message : String(e))
          } finally { setBusy(false) }
        })()}>
        ✍️ {km ? 'ចុះហត្ថលេខាធានា' : 'Sign vouch'}
      </button>
    </div>
  )
}

/* ------------------------------------------------------------- company --- */

function Company({ km }: { km: boolean }) {
  const [companyPub, setCompanyPub] = useState<string | null>(peekPub('company'))
  const [name, setName] = useState('')
  const [region, setRegion] = useState('')
  const [logo, setLogo] = useState('')
  const [regMsg, setRegMsg] = useState('')
  const [error, setError] = useState('')

  // enroll staff
  const [staffKey, setStaffKey] = useState('')
  const [staffName, setStaffName] = useState('')
  const [staffRole, setStaffRole] = useState<CustodyRole>('carrier')
  const [delOut, setDelOut] = useState('')

  // roster (local to this admin device) + which keys are revoked (from the node)
  const [roster, setRoster] = useState<RosterEntry[]>(loadRoster())
  const [revoked, setRevoked] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (companyPub) void fetchRevocations(companyPub).then(setRevoked)
  }, [companyPub])

  async function revoke(staff: string) {
    setError('')
    try {
      await revokeStaff(staff)
      setRevoked((prev) => new Set(prev).add(staff))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function register() {
    setError(''); setRegMsg('')
    if (!name.trim()) { setError(km ? 'សូមបញ្ចូលឈ្មោះក្រុមហ៊ុន' : 'Enter a company name'); return }
    try {
      const pub = await registerCompany({ name: name.trim(), region: region.trim() || undefined, logo: logo.trim() || undefined })
      setCompanyPub(pub)
      setRegMsg(km ? '✓ បានចុះឈ្មោះក្រុមហ៊ុន (រង់ចាំបញ្ជាក់)' : '✓ Company registered (pending verification)')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function enroll() {
    setError(''); setDelOut('')
    if (!/^[A-Za-z0-9_-]{80,200}$/.test(staffKey.trim())) {
      setError(km ? 'កូនសោបុគ្គលិកមិនត្រឹមត្រូវ' : 'Paste the staff public key')
      return
    }
    if (!staffName.trim()) { setError(km ? 'សូមបញ្ចូលឈ្មោះបុគ្គលិក' : 'Enter the staff name'); return }
    try {
      const d = await mintDelegation({ staff: staffKey.trim(), staffName: staffName.trim(), role: staffRole })
      setDelOut(JSON.stringify(d))
      setRoster(loadRoster())
      setStaffKey(''); setStaffName('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <>
      <p className="contribute-lead">
        {km
          ? 'អ្នកគ្រប់គ្រងចុះឈ្មោះក្រុមហ៊ុន (កូនសោ root) រួចផ្តល់សិទ្ធិ (delegation) ដល់បុគ្គលិកម្នាក់ៗ។ កូនសោ root គួរនៅលើឧបករណ៍តែមួយ។'
          : 'An admin registers the company (a root key) once, then enrolls each staff member. Keep the root key on ONE admin device.'}
      </p>

      <fieldset className="voice-fields">
        <label className="voice-field">
          <span>{km ? 'ឈ្មោះក្រុមហ៊ុន' : 'Company name'}</span>
          <input type="text" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="voice-field">
          <span>{km ? 'ខេត្ត/តំបន់ (ស្រេចចិត្ត)' : 'Region (optional)'}</span>
          <input type="text" value={region} maxLength={40} onChange={(e) => setRegion(e.target.value)} />
        </label>
        <label className="voice-field">
          <span>{km ? 'និមិត្តសញ្ញា URL (ស្រេចចិត្ត)' : 'Logo URL (optional)'}</span>
          <input type="text" value={logo} maxLength={300} onChange={(e) => setLogo(e.target.value)} />
        </label>
      </fieldset>
      <button className="voice-primary" onClick={register}>
        🏢 {companyPub ? (km ? 'ធ្វើបច្ចុប្បន្នភាព' : 'Update company') : (km ? 'ចុះឈ្មោះក្រុមហ៊ុន' : 'Register company')}
      </button>
      {companyPub ? (
        <label className="voice-field" style={{ marginTop: 10 }}>
          <span>{km ? 'កូនសោ root ក្រុមហ៊ុន' : 'Company root key'}</span>
          <textarea className="custody-key" readOnly value={companyPub} rows={2} onFocus={(e) => e.target.select()} />
        </label>
      ) : null}
      {regMsg ? <p className="sign-review-note">{regMsg}</p> : null}

      <h3 className="custody-timeline-h" style={{ marginTop: 20 }}>👥 {km ? 'ចុះឈ្មោះបុគ្គលិក' : 'Enroll staff'}</h3>
      <p className="voice-minor-note">
        {km
          ? 'សុំកូនសោសាធារណៈរបស់បុគ្គលិក (ពីផ្ទាំង «អត្តសញ្ញាណ» លើទូរស័ព្ទគេ) បិទភ្ជាប់ខាងក្រោម បង្កើត delegation រួចផ្ញើត្រឡប់ទៅគេ។'
          : 'Ask the staffer for their public key (their “My identity” tab), paste it below, mint the delegation, and send it back to them.'}
      </p>
      <fieldset className="voice-fields">
        <label className="voice-field">
          <span>{km ? 'កូនសោសាធារណៈបុគ្គលិក' : 'Staff public key'}</span>
          <textarea className="custody-key" value={staffKey} rows={2} onChange={(e) => setStaffKey(e.target.value)} />
        </label>
        <label className="voice-field">
          <span>{km ? 'ឈ្មោះបុគ្គលិក' : 'Staff name'}</span>
          <input type="text" value={staffName} maxLength={80} onChange={(e) => setStaffName(e.target.value)} />
        </label>
        <label className="voice-field">
          <span>{km ? 'តួនាទី' : 'Role'}</span>
          <select value={staffRole} onChange={(e) => setStaffRole(e.target.value as CustodyRole)}>
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
      </fieldset>
      <button className="voice-primary" onClick={enroll} disabled={!companyPub}>
        ✍️ {km ? 'បង្កើត delegation' : 'Mint delegation'}
      </button>
      {!companyPub ? (
        <p className="voice-minor-note">{km ? '(ចុះឈ្មោះក្រុមហ៊ុនជាមុនសិន)' : '(Register the company first)'}</p>
      ) : null}

      {delOut ? (
        <label className="voice-field" style={{ marginTop: 10 }}>
          <span>{km ? 'ផ្ញើអត្ថបទនេះទៅបុគ្គលិក' : 'Send this to the staffer'}</span>
          <textarea className="custody-key" readOnly value={delOut} rows={5} onFocus={(e) => e.target.select()} />
          <button className="voice-ghost" onClick={() => void navigator.clipboard?.writeText(delOut)}>
            📋 {km ? 'ចម្លង' : 'Copy delegation'}
          </button>
        </label>
      ) : null}

      <Verification km={km} companyPub={companyPub} />

      {roster.length > 0 ? (
        <div className="custody-timeline">
          <h3 className="custody-timeline-h" style={{ marginTop: 20 }}>
            👥 {km ? 'បញ្ជីបុគ្គលិក' : 'Staff roster'}
          </h3>
          {roster.map((e) => {
            const isRevoked = revoked.has(e.staff)
            const expired = Date.parse(e.expiresAt) < Date.now()
            return (
              <div className="custody-row" key={e.staff}>
                <div className="custody-row-top">
                  <b>{e.staffName || e.staff.slice(0, 8)}</b> · {e.role}
                  {isRevoked ? (
                    <span className="custody-tag self">{km ? 'ដកហូត' : 'revoked'}</span>
                  ) : expired ? (
                    <span className="custody-tag self">{km ? 'ផុតកំណត់' : 'expired'}</span>
                  ) : (
                    <button className="voice-ghost small" onClick={() => void revoke(e.staff)}>
                      ✕ {km ? 'ដកហូត' : 'Revoke'}
                    </button>
                  )}
                </div>
                <div className="custody-row-sub">
                  {e.staff.slice(0, 12)}… · {km ? 'ផុតកំណត់' : 'expires'} {new Date(e.expiresAt).toLocaleDateString()}
                </div>
              </div>
            )
          })}
          <p className="voice-minor-note">
            {km
              ? 'បញ្ជីនេះរក្សាទុកលើឧបករណ៍នេះ។ ការដកហូតត្រូវបានផ្ញើទៅ node ភ្លាមៗ។'
              : 'This roster is kept on this device. Revoking is sent to the node immediately.'}
          </p>
        </div>
      ) : null}

      {error ? <p className="voice-error">{error}</p> : null}
    </>
  )
}
