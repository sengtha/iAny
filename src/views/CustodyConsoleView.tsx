import { useEffect, useState } from 'react'
import { useI18n } from '../i18n'
import {
  addCustody,
  clearDelegation,
  fetchCustody,
  getStaffKey,
  importDelegation,
  loadDelegation,
  mintDelegation,
  peekPub,
  registerCompany,
  type CustodyEvent,
  type CustodyItem,
  type CustodyRole,
  type Delegation,
} from '../../trace/web/companion'

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
  const [tab, setTab] = useState<'event' | 'identity' | 'company'>('event')

  return (
    <div className="contribute">
      <div className="sign-modetabs" role="tablist">
        <button className={`sign-modetab ${tab === 'event' ? 'active' : ''}`} onClick={() => setTab('event')}>
          📦 {km ? 'បន្ថែមព្រឹត្តិការណ៍' : 'Add event'}
        </button>
        <button className={`sign-modetab ${tab === 'identity' ? 'active' : ''}`} onClick={() => setTab('identity')}>
          🪪 {km ? 'អត្តសញ្ញាណ' : 'My identity'}
        </button>
        <button className={`sign-modetab ${tab === 'company' ? 'active' : ''}`} onClick={() => setTab('company')}>
          🏢 {km ? 'ក្រុមហ៊ុន' : 'Company'}
        </button>
      </div>

      {tab === 'event' ? <AddEvent km={km} /> : tab === 'identity' ? <Identity km={km} /> : <Company km={km} />}
    </div>
  )
}

/* ----------------------------------------------------------- add event --- */

function AddEvent({ km }: { km: boolean }) {
  const [capsule, setCapsule] = useState('')
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

      {error ? <p className="voice-error">{error}</p> : null}
    </>
  )
}
