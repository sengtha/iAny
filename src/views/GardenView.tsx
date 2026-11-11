import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useI18n } from '../i18n'
import { getLocation, type GeoPoint } from '../lib/geo'
import { directionUncertainty, expectedTrees, rowLengthM, rowReady, rowTreePoint, type RowLayout } from '../lib/row'
import {
  createObservation,
  loadObservations,
  loadPlots,
  photoHashOf,
  estimateCarbon,
  exportBundle,
  importBundle,
  publish,
  publishedIds,
  type GardenObservation,
  type Measure,
} from '../../grove/web/store'
import { readJsonFile, shareJson } from '../lib/share'
import { anchorCall, plotLiveCount, readPlotStatus, type CsbPlotStatus } from '../../grove/core/csb'

/**
 * 🌳 Garden (/garden) — create **signed, verifiable** garden/tree observations on
 * your phone (the source of truth). Measure a plant → estimate its CO₂ → sign it
 * with your device key. Records are stored locally and exportable to any node /
 * dashboard / CamboVerse. See grove/SPEC.md. Estimates, not certified credits.
 */
interface SpeciesInfo {
  id: string
  en: string
  km: string
  /** Binomial name, shown alongside the common name so a verifier can confirm the pick. */
  scientific?: string
}
const SPECIES_LIST: SpeciesInfo[] = [
  { id: 'mango', en: 'Mango', km: 'ស្វាយ', scientific: 'Mangifera indica' },
  { id: 'coconut', en: 'Coconut', km: 'ដូង', scientific: 'Cocos nucifera' },
  { id: 'jackfruit', en: 'Jackfruit', km: 'ខ្នុរ', scientific: 'Artocarpus heterophyllus' },
  { id: 'longan', en: 'Longan', km: 'មៀន', scientific: 'Dimocarpus longan' },
  { id: 'guava', en: 'Guava', km: 'ត្របែក', scientific: 'Psidium guajava' },
  { id: 'tamarind', en: 'Tamarind', km: 'អំពិល', scientific: 'Tamarindus indica' },
  { id: 'teak', en: 'Teak', km: 'ម៉ៃសាក់', scientific: 'Tectona grandis' },
  { id: 'banana', en: 'Banana', km: 'ចេក', scientific: 'Musa spp.' },
  { id: 'rambutan', en: 'Rambutan', km: 'សាវម៉ាវ', scientific: 'Nephelium lappaceum' },
  { id: 'durian', en: 'Durian', km: 'ធូរេន', scientific: 'Durio zibethinus' },
  { id: 'papaya', en: 'Papaya', km: 'ល្ហុង', scientific: 'Carica papaya' },
  { id: 'pomelo', en: 'Pomelo', km: 'ក្រូចថ្លុង', scientific: 'Citrus maxima' },
  { id: 'lime', en: 'Lime', km: 'ក្រូចឆ្មារ', scientific: 'Citrus aurantiifolia' },
  { id: 'star-fruit', en: 'Star fruit', km: 'ស្ពឺ', scientific: 'Averrhoa carambola' },
  { id: 'sugar-apple', en: 'Sugar apple', km: 'ទៀប', scientific: 'Annona squamosa' },
  { id: 'soursop', en: 'Soursop', km: 'ទៀបបារាំង', scientific: 'Annona muricata' },
  { id: 'sapodilla', en: 'Sapodilla', km: 'ល្មុត', scientific: 'Manilkara zapota' },
  { id: 'mangosteen', en: 'Mangosteen', km: 'មង្ឃុត', scientific: 'Garcinia mangostana' },
  { id: 'avocado', en: 'Avocado', km: 'ប័រ', scientific: 'Persea americana' },
  { id: 'neem', en: 'Neem', km: 'ស្តៅ', scientific: 'Azadirachta indica' },
  { id: 'banyan', en: 'Banyan', km: 'ជ្រៃ', scientific: 'Ficus benghalensis' },
  { id: 'bodhi', en: 'Bodhi (Sacred fig)', km: 'ដើមពោធិ៍', scientific: 'Ficus religiosa' },
  { id: 'sugar-palm', en: 'Sugar palm (Palmyra)', km: 'ត្នោត', scientific: 'Borassus flabellifer' },
  { id: 'areca-palm', en: 'Areca palm (Betel)', km: 'ស្លា', scientific: 'Areca catechu' },
  { id: 'rubber', en: 'Rubber tree', km: 'កៅស៊ូ', scientific: 'Hevea brasiliensis' },
  { id: 'lychee', en: 'Lychee', km: 'គូឡែន', scientific: 'Litchi chinensis' },
  { id: 'cashew', en: 'Cashew', km: 'ស្វាយចន្ទី', scientific: 'Anacardium occidentale' },
  { id: 'white-champak', en: 'White Champak', km: 'ចំប៉ា', scientific: 'Michelia alba' },
  { id: 'white-frangipani', en: 'White Frangipani', km: 'ចំប៉ីស', scientific: 'Plumeria alba' },
  { id: 'red-frangipani', en: 'Red Frangipani', km: 'ចំប៉ីក្រហម', scientific: 'Plumeria rubra' },
  { id: 'siamese-rosewood', en: 'Siamese rosewood', km: 'ក្រញូង', scientific: 'Dalbergia cochinchinensis' },
  { id: 'pine', en: 'Pine (Sumatran pine)', km: 'ស្រល់', scientific: 'Pinus merkusii' },
]
/** These species remain selectable but use the conservative generic density estimate. */
const GENERIC_DENSITY_SPECIES = new Set([
  'white-champak', 'white-frangipani', 'red-frangipani', 'siamese-rosewood', 'pine',
])
/** Where the optional CSB read endpoint is remembered. Empty = chain off. */
const CSB_KEY = 'grove.csb.base.v1'
/** Above this radius (metres) a fix is more likely network/Wi-Fi-based than real
 *  GPS — e.g. iOS "Precise Location" off, or Android's coarse-location grant. */
const LOW_ACCURACY_M = 100
/** Locating stops on its own once a fix is this tight. */
const GOOD_ACCURACY_M = 10
/** Up to this, a fix is accepted without a warning — near buildings phones
 *  often can't get below ~10 m however long they wait. */
const ACCEPTABLE_ACCURACY_M = 15
const LOCATE_MAX_WAIT_MS = 15000
/** Every path waypoint affects computed tree positions, so use a longer wait and stricter bar. */
const ROW_END_TARGET_M = 5
const ROW_END_ACCEPTABLE_M = 10
const ROW_END_MAX_WAIT_MS = 30000
/** Above this, the row's direction is shaky enough to say so. */
const ROW_DIRECTION_OK_DEG = 15
/** Row-mode setup survives a reload mid-row; it's local working state, never signed. */
const ROW_KEY = 'grove.row.v1'

function loadRow(): RowLayout | null {
  try {
    const row = JSON.parse(localStorage.getItem(ROW_KEY) ?? 'null') as RowLayout | null
    if (!row) return null
    if (!row.waypoints) row.waypoints = row.start && row.end ? [row.start, row.end] : row.start ? [row.start] : []
    return row
  } catch {
    return null
  }
}

/** Shared with the proactive permission check below — keeps both denial messages identical. */
function locationDeniedMessage(km: boolean): string {
  return km
    ? 'ទីតាំងត្រូវបានបិទសម្រាប់គេហទំព័រនេះ — បើក Location នៅក្នុងការកំណត់កម្មវិធីរុករក (ឬការកំណត់ទូរស័ព្ទ) រួចផ្ទុកទំព័រនេះឡើងវិញ'
    : 'Location access is blocked for this site — enable it in your browser\'s (or phone\'s) site permissions, then reload this page'
}

function parseDecimal(val: string): number {
  const v = parseFloat(val.replace(',', '.'))
  return isNaN(v) || v <= 0 ? 0 : v
}

/** Full combobox label: common name + scientific name, e.g. "Mango (Mangifera indica)".
 *  Falls back to the raw value for a typed species not in the list. */
function speciesLabel(idOrText: string, km: boolean): string {
  const found = SPECIES_LIST.find((s) => s.id === idOrText)
  if (!found) return idOrText
  const name = km ? found.km : found.en
  return found.scientific ? `${name} (${found.scientific})` : name
}
/** Compact label for the records list — common name only, no scientific name. */
function speciesShortLabel(idOrText: string, km: boolean): string {
  const found = SPECIES_LIST.find((s) => s.id === idOrText)
  return found ? (km ? found.km : found.en) : idOrText
}
/** Species matching a search term against common (either language) or scientific name. */
function matchSpecies(query: string): SpeciesInfo[] {
  const q = query.trim()
  if (!q) return SPECIES_LIST
  const qLower = q.toLowerCase()
  return SPECIES_LIST
    .map((s) => {
      const enLower = s.en.toLowerCase()
      const sciLower = (s.scientific ?? '').toLowerCase()
      let score = 0
      if (enLower.startsWith(qLower) || s.km.startsWith(q)) score = 2
      else if (enLower.includes(qLower) || s.km.includes(q) || sciLower.includes(qLower)) score = 1
      return { s, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.s)
}

export function GardenView({ locationEnabled }: { locationEnabled: boolean }) {
  const { lang } = useI18n()
  const km = lang === 'km'
  const [obs, setObs] = useState<GardenObservation[]>(() => loadObservations())
  const [plot, setPlot] = useState(() => loadPlots()[0] ?? 'home-garden-01')
  const [species, setSpecies] = useState('mango')
  const [speciesQuery, setSpeciesQuery] = useState(() => speciesLabel('mango', km))
  const [speciesOpen, setSpeciesOpen] = useState(false)
  const [speciesHighlight, setSpeciesHighlight] = useState(0)
  const speciesListboxId = useId()
  const [count, setCount] = useState(1)
  const [dbh, setDbh] = useState('')
  const [height, setHeight] = useState('')
  const [gps, setGps] = useState<GeoPoint | null>(null)
  const [locating, setLocating] = useState(false)
  const [locationMessage, setLocationMessage] = useState('')
  const [image, setImage] = useState<Blob | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [published, setPublished] = useState<Set<string>>(() => publishedIds())
  const [publishing, setPublishing] = useState(false)
  const [publishMsg, setPublishMsg] = useState('')
  const [processingPhoto, setProcessingPhoto] = useState(false)
  const locationRequestId = useRef(0)
  const fileRef = useRef<HTMLInputElement>(null)
  const importRef = useRef<HTMLInputElement>(null)

  const [row, setRowState] = useState<RowLayout | null>(() => loadRow())
  const [spacingText, setSpacingText] = useState(() => (row?.spacingM ? String(row.spacingM) : ''))
  const [treeNumberText, setTreeNumberText] = useState(() => String(row?.nextTree ?? 1))
  const [rowLocating, setRowLocating] = useState(false)
  const [rowMessage, setRowMessage] = useState('')
  const rowRequestId = useRef(0)
  const [locateBest, setLocateBest] = useState<number | null>(null)
  const [rowBest, setRowBest] = useState<number | null>(null)
  const locateAbort = useRef<AbortController | null>(null)
  const rowAbort = useRef<AbortController | null>(null)

  function setRow(next: RowLayout | null) {
    setRowState(next)
    if (next) localStorage.setItem(ROW_KEY, JSON.stringify(next))
    else localStorage.removeItem(ROW_KEY)
  }

  function startRow() {
    setRow({ id: new Date().toISOString().slice(0, 16), start: null, end: null, waypoints: [], spacingM: 0, nextTree: 1 })
    setSpacingText('')
    setTreeNumberText('1')
    setRowMessage('')
  }

  function endRow() {
    rowRequestId.current += 1
    setRowLocating(false)
    setRowMessage('')
    setRow(null)
  }

  async function recordRowPoint() {
    if (!row || !locationEnabled) return
    rowRequestId.current += 1
    const reqId = rowRequestId.current
    setRowLocating(true)
    setRowMessage('')
    setRowBest(null)
    rowAbort.current = new AbortController()
    const { point, error } = await getLocation({
      targetAcc: ROW_END_TARGET_M,
      maxWaitMs: ROW_END_MAX_WAIT_MS,
      signal: rowAbort.current.signal,
      onProgress: (p) => {
        if (reqId !== rowRequestId.current) return
        setRowBest(p.acc)
        setRowMessage(km ? `កំពុងធ្វើឱ្យទីតាំងកាន់តែច្បាស់… ±${p.acc} ម` : `Improving accuracy… ±${p.acc} m`)
      },
    })
    if (reqId !== rowRequestId.current) return
    setRowLocating(false)
    setRowBest(null)
    if (!point) {
      setRowMessage(error === 'denied'
        ? locationDeniedMessage(km)
        : (km ? 'មិនអាចទទួលទីតាំងបានទេ — សាកល្បងម្ដងទៀតនៅកន្លែងបើកចំហ' : 'Could not get a location — try again with a clearer view of the sky'))
      return
    }
    const current = loadRow() ?? row
    const waypoints = [...(current.waypoints ?? (current.start && current.end ? [current.start, current.end] : current.start ? [current.start] : [])), point]
    setRow({ ...current, start: waypoints[0] ?? null, end: waypoints[waypoints.length - 1] ?? null, waypoints })
    setRowMessage(point.acc > ROW_END_ACCEPTABLE_M
      ? (km ? `⚠ ទីតាំងត្រឹមតែ ±${point.acc} ម — ចុងជួរគួរតែ ±${ROW_END_ACCEPTABLE_M} ម ឬប្រសើរជាងនេះ ព្រោះដើមឈើទាំងអស់ក្នុងជួរទទួលកំហុសនេះ។ ចេញពីក្រោមដំបូល ហើយកត់ត្រាម្ដងទៀត។` : `⚠ Only ±${point.acc} m — row ends should be ±${ROW_END_ACCEPTABLE_M} m or better, since every tree in the row inherits this error. Step out from under the roof and record it again.`)
      : '')
  }

  const rowSpacing = parseDecimal(spacingText)
  const rowWithSpacing = row ? { ...row, spacingM: rowSpacing } : null
  const readyRow = rowWithSpacing && rowReady(rowWithSpacing) ? rowWithSpacing : null
  const rowLength = row ? rowLengthM(row) : 0
  const treeNumber = Math.max(1, parseInt(treeNumberText) || 1)

  useEffect(() => {
    if (!locationEnabled) {
      locationRequestId.current += 1
      setGps(null)
      setLocating(false)
      setLocationMessage('')
      rowRequestId.current += 1
      setRowLocating(false)
    }
  }, [locationEnabled])

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

  // Proactively surface an already-blocked permission before the user even taps
  // "Record this location" — a prior denial means tapping it would just fail
  // silently again (the browser won't re-prompt). Permissions API support for
  // 'geolocation' varies by browser, so this degrades to the button's own
  // on-tap check when unsupported.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) return
    let stale = false
    navigator.permissions
      .query({ name: 'geolocation' as PermissionName })
      .then((status) => {
        if (!stale && status.state === 'denied') setLocationMessage(locationDeniedMessage(km))
      })
      .catch(() => { /* unsupported for 'geolocation' on this browser — fine */ })
    return () => { stale = true }
  }, [])

  const measure: Measure = useMemo(() => {
    const d = parseDecimal(dbh), h = parseDecimal(height)
    if (d > 0 && h > 0) return { method: 'dbh_height', dbh_cm: d, height_m: h }
    if (d > 0) return { method: 'dbh', dbh_cm: d }
    if (h > 0) return { method: 'height', height_m: h }
    return { method: 'manual', biomassKg: 0 }
  }, [dbh, height])

  // Re-label the box on a language toggle — but only for a recognized species;
  // a custom typed name has no translation to switch to.
  useEffect(() => {
    if (SPECIES_LIST.some((s) => s.id === species)) setSpeciesQuery(speciesLabel(species, km))
  }, [km, species])

  // While the box still shows the selected species' own label untouched, browsing
  // should surface the full list — matching that literal "Name (Scientific)" string
  // against the bare names would otherwise return no results.
  const speciesMatches = useMemo(
    () => matchSpecies(speciesQuery === speciesLabel(species, km) ? '' : speciesQuery),
    [speciesQuery, species, km],
  )

  function selectSpecies(id: string) {
    setSpecies(id)
    setSpeciesQuery(speciesLabel(id, km))
    setSpeciesOpen(false)
  }

  /** Resolve free-typed text on blur/Enter: snap to an exact name match, else keep it as a custom species. */
  function commitSpeciesQuery() {
    const q = speciesQuery.trim()
    if (!q) { setSpeciesQuery(speciesLabel(species, km)); return }
    // Already showing the selected species' own label (either language) — nothing to resolve.
    // Without this check, re-committing on a stray blur (e.g. clicking the language
    // toggle while the field still has focus) would treat "Guava (Psidium guajava)"
    // as unrecognized free text and overwrite a valid `guava` pick with that whole string.
    if (q === speciesLabel(species, km) || q === speciesLabel(species, !km)) return
    const qLower = q.toLowerCase()
    const exact = SPECIES_LIST.find(
      (s) =>
        s.en.toLowerCase() === qLower ||
        s.km === q ||
        speciesLabel(s.id, true) === q ||
        speciesLabel(s.id, false).toLowerCase() === qLower,
    )
    if (exact) selectSpecies(exact.id)
    else setSpecies(q)
  }

  const est = useMemo(() => {
    const per = estimateCarbon(measure, species)
    return { per: per.co2Kg, total: Math.round(per.co2Kg * Math.max(1, count) * 100) / 100 }
  }, [measure, species, count])

  const totalCo2 = useMemo(() => Math.round(obs.reduce((s, o) => s + o.co2Kg, 0) * 100) / 100, [obs])

  async function onPick(file: File) {
    setError('')
    setProcessingPhoto(true)
    let processedFile = file
    try {
      const name = file.name.toLowerCase()
      if (name.endsWith('.heic') || name.endsWith('.heif') || file.type === 'image/heic' || file.type === 'image/heif') {
        const heic2any = (await import('heic2any')).default
        const converted = await heic2any({ blob: file, toType: 'image/jpeg' })
        processedFile = new File([Array.isArray(converted) ? converted[0] : converted], 'photo.jpg', { type: 'image/jpeg' })
      }
      const scaled = await downscale(processedFile, 1280)
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      setImage(scaled)
      setPreviewUrl(URL.createObjectURL(scaled))
    } catch (e) {
      console.error(e)
      setError(km ? 'មិនអាចដំណើរការរូបភាពបានទេ' : 'Could not process photo')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
      setProcessingPhoto(false)
    }
  }

  async function addLocation() {
    if (!locationEnabled) return
    locationRequestId.current += 1
    const reqId = locationRequestId.current
    setGps(null)
    setLocationMessage('')
    setLocating(true)
    setLocateBest(null)
    locateAbort.current = new AbortController()
    const { point, error } = await getLocation({
      targetAcc: GOOD_ACCURACY_M,
      maxWaitMs: LOCATE_MAX_WAIT_MS,
      signal: locateAbort.current.signal,
      onProgress: (p) => {
        if (reqId !== locationRequestId.current) return
        setLocateBest(p.acc)
        setLocationMessage(km ? `កំពុងធ្វើឱ្យទីតាំងកាន់តែច្បាស់… ±${p.acc} ម` : `Improving accuracy… ±${p.acc} m`)
      },
    })
    if (reqId !== locationRequestId.current) return
    setLocateBest(null)
    setGps(point)
    setLocationMessage(
      point
        ? point.acc > LOW_ACCURACY_M
          ? (km
              ? `⚠ ទីតាំងបានកត់ត្រា ប៉ុន្តែភាពត្រឹមត្រូវទន់ខ្សោយ (±${point.acc} ម) — នេះប្រហែលជាទីតាំងតាមបណ្ដាញ មិនមែន GPS ពិតប្រាកដទេ។ ពិនិត្យការកំណត់ "Precise Location" សម្រាប់កម្មវិធីរុករកនេះ ហើយសាកល្បងនៅទីវាលមានមេឃចំហ។`
              : `⚠ Location recorded but accuracy is poor (±${point.acc} m) — this is likely a network-based fix, not real GPS. Check your phone's "Precise Location" setting for this browser, and try again with a clear view of the sky.`)
          : point.acc > ACCEPTABLE_ACCURACY_M
            ? (km
                ? `⚠ ទីតាំងបានកត់ត្រា ប៉ុន្តែត្រឹមត្រូវត្រឹមប្រហែល ±${point.acc} ម ប៉ុណ្ណោះ — ដើមឈើដែលនៅជិតគ្នាអាចបង្ហាញខុសកន្លែង។ សូមចេញឆ្ងាយពីអគារ ឬដំបូល ហើយចុច «ផ្ទុកទីតាំងម្ដងទៀត»។`
                : `⚠ Location recorded, but only to about ±${point.acc} m — nearby trees may land in the wrong spot. Step away from buildings or roofs and tap Refresh location.`)
            : (km ? `✓ ទីតាំងបានកត់ត្រា · ភាពត្រឹមត្រូវប្រហែល ${point.acc} ម` : `✓ Location recorded · accurate to about ${point.acc} m`)
        : error === 'denied'
          ? locationDeniedMessage(km)
          : error === 'timeout'
            ? (km ? 'ការស្វែងរកទីតាំងអស់ពេល — សាកល្បងម្ដងទៀតនៅកន្លែងបើកចំហ' : 'Location request timed out — try again with a clearer view of the sky')
            : (km ? 'មិនអាចទទួលទីតាំងបានទេ — អនុញ្ញាត Location ហើយព្យាយាមម្ដងទៀត' : 'Could not get location — allow Location, then try again'),
    )
    setLocating(false)
  }

  async function save() {
    if (!image) { setError(km ? 'សូមថតរូបរុក្ខជាតិជាមុន' : 'Take a photo of the plant first'); return }
    if (measure.method === 'manual') { setError(km ? 'បញ្ចូលទំហំ (អង្កត់ផ្ចិត ឬកម្ពស់)' : 'Enter a size (trunk width or height)'); return }
    if (row && !readyRow) {
      setError(km ? 'បញ្ចប់ការរៀបចំផ្លូវជាមុនសិន៖ ចំណុច GPS និងគម្លាត' : 'Finish the path setup first: GPS points and spacing')
      return
    }
    setSaving(true)
    setError('')
    try {
      const photoHash = await photoHashOf(image)
      // In row mode the position is computed, not measured — the note says so,
      // and it's part of the signed record.
      const fromRow = readyRow
        ? {
            gps: rowTreePoint(readyRow, treeNumber),
            note: `row ${readyRow.id} · tree ${treeNumber} · ${readyRow.spacingM} m spacing · position computed from ordered row GPS points`,
          }
        : null
      await createObservation({
        plot: plot.trim() || 'home-garden-01',
        species, count: Math.max(1, count), measure,
        gps: fromRow ? fromRow.gps : gps,
        note: fromRow?.note,
        observedAt: new Date().toISOString(), photoHash,
      })
      if (readyRow) {
        setRow({ ...readyRow, nextTree: treeNumber + 1 })
        setTreeNumberText(String(treeNumber + 1))
      }
      setObs(loadObservations())
      // reset the item, keep the plot
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      setImage(null); setPreviewUrl(''); setDbh(''); setHeight(''); setCount(1)
      setGps(null); setLocationMessage(''); locationRequestId.current += 1
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

  async function shareBundle() {
    setPublishMsg('')
    const how = await shareJson('grove-garden.json', exportBundle())
    if (how === 'downloaded') setPublishMsg(km ? 'បានទាញយកឯកសារ' : 'File downloaded')
  }

  async function onImport(file: File | null) {
    if (!file) return
    setPublishMsg('')
    try {
      const r = await importBundle(await readJsonFile(file))
      setObs(loadObservations())
      setPublished(publishedIds())
      setPublishMsg(
        km
          ? `នាំចូល៖ បន្ថែម ${r.added} · ស្ទួន ${r.duplicate}${r.invalid ? ` · មិនត្រឹមត្រូវ ${r.invalid}` : ''}`
          : `Imported: ${r.added} added · ${r.duplicate} dup${r.invalid ? ` · ${r.invalid} invalid` : ''}`,
      )
    } catch {
      setPublishMsg(km ? 'ឯកសារមិនត្រឹមត្រូវ' : 'Not a valid Grove bundle')
    }
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

      {!row ? (
        <button type="button" className="garden-treerow-start" onClick={startRow}>
          <span aria-hidden="true">📏</span>
          <span>
            <b>{km ? 'កត់ត្រាដើមឈើមួយជួរ' : 'Record a row of trees'}</b>
            <small>{km ? 'GPS តាមផ្លូវ · គម្លាតដាក់ដើមឈើនៅចន្លោះ' : 'GPS along the path · spacing places the trees between'}</small>
          </span>
        </button>
      ) : (
        <section className="garden-treerow" aria-live="polite">
          <div className="garden-form-heading">
            <div>
              <h2>{km ? 'ដើមឈើមួយជួរ' : 'Row of trees'}</h2>
              <p>{km ? 'កត់ត្រា GPS តាមផ្លូវ៖ ដើម ចំណុចជ្រុង និងចុង។ បញ្ចូលគម្លាត រួចថតដើមនីមួយៗ។' : 'Record GPS along the path: start, corners, and end. Enter the spacing, then photograph each tree.'}</p>
            </div>
            <button type="button" className="voice-ghost small" onClick={endRow}>{km ? 'បញ្ចប់ជួរ' : 'End row'}</button>
          </div>

          <div className="garden-treerow-ends">
            <button type="button" className={row.waypoints?.length ? 'garden-treerow-end recorded' : 'garden-treerow-end'}
              onClick={() => void recordRowPoint()} disabled={rowLocating || !locationEnabled}>
              <span className="garden-treerow-end-label">{rowLocating ? (km ? 'កំពុងរក…' : 'Locating…') : (km ? 'បន្ថែមចំណុច GPS' : 'Add GPS point')}</span>
              <span className="garden-treerow-end-value">{row.waypoints?.length ? `${row.waypoints.length} ${km ? 'ចំណុច' : 'points'} · ${km ? 'ដើម → ជ្រុង → ចុង' : 'start → corners → end'}` : (km ? 'ចាប់ផ្តើមនៅដើមជួរ' : 'Start at the first tree')}</span>
            </button>
          </div>

          <label className="voice-field garden-treerow-spacing">
            <span>{km ? 'គម្លាតរវាងដើម' : 'Spacing between trees'}</span>
            <small>{km ? 'ម៉ែត្រ · ពីដើមមួយទៅដើមមួយ' : 'metres · trunk to trunk'}</small>
            <input type="text" inputMode="decimal" value={spacingText} placeholder="e.g. 3"
              onChange={(e) => {
                setSpacingText(e.target.value)
                setRow({ ...row, spacingM: parseDecimal(e.target.value) })
              }} />
          </label>

          {!locationEnabled ? <p className="garden-location-status">{km ? 'សូមបើកទីតាំងនៅផ្នែកខាងលើ ដើម្បីកត់ត្រាចំណុចជួរ។' : 'Turn on location in the header to record the row points.'}</p> : null}
          {row.waypoints && row.waypoints.length > 1 ? <p className="garden-location-status">{km ? 'បន្ថែមចំណុចនៅជ្រុងនីមួយៗ ហើយបន្ថែមចំណុចចុងក្រោយ។' : 'Add a point at each corner, then add the final point.'}</p> : null}
          {rowMessage ? <p className="garden-location-status">{rowMessage}</p> : null}
          {rowLocating && rowBest !== null ? (
            <button type="button" className="voice-ghost garden-use-now" onClick={() => rowAbort.current?.abort()}>
              {km ? `ប្រើ ±${rowBest} ម ឥឡូវនេះ` : `Use ±${rowBest} m now`}
            </button>
          ) : null}
          {rowLength > 0 ? (
            readyRow ? (
              <>
                <p className="garden-location-status success">
                  {km
                    ? `ផ្លូវវែង ${rowLength.toFixed(1)} ម → ប្រហែល ${expectedTrees(readyRow)} ដើម នៅគម្លាត ${rowSpacing} ម។ ត្រៀមរួចហើយ — ថតដើមនីមួយៗ។`
                    : `Path is ${rowLength.toFixed(1)} m long → about ${expectedTrees(readyRow)} trees at ${rowSpacing} m. Ready — photograph each tree.`}
                </p>
                {(() => {
                  const dir = directionUncertainty(readyRow)
                  const ok = dir.deg <= ROW_DIRECTION_OK_DEG
                  return (
                    <p className={ok ? 'garden-location-status success' : 'garden-location-status'}>
                      {ok
                        ? (km ? `✓ ទិសដៅជួរ ±${Math.round(dir.deg)}° — ដើមចុងអាចខុសទៅចំហៀងប្រហែល ${dir.sideM.toFixed(1)} ម។` : `✓ Row direction ±${Math.round(dir.deg)}° — far-end trees could sit about ${dir.sideM.toFixed(1)} m to the side.`)
                        : (km ? `⚠ ទិសដៅជួរមិនច្បាស់ (±${Math.round(dir.deg)}°) — ដើមចុងអាចខុសទៅចំហៀងប្រហែល ${dir.sideM.toFixed(1)} ម។ កត់ត្រាចុងណាមួយម្ដងទៀតឱ្យកាន់តែច្បាស់ ឬកត់ត្រាចុងឆ្ងាយជាងនេះតាមបណ្ដោយជួរ។` : `⚠ Row direction is uncertain (±${Math.round(dir.deg)}°) — far-end trees could sit about ${dir.sideM.toFixed(1)} m to the side. Re-record an end with better accuracy, or record the far end further along the row.`)}
                    </p>
                  )
                })()}
              </>
            ) : rowSpacing > 0 ? (
              <p className="garden-location-status">
                {km ? `ផ្លូវខ្លីពេក (${rowLength.toFixed(1)} ម) សម្រាប់គម្លាត ${rowSpacing} ម។` : `The path is too short (${rowLength.toFixed(1)} m) for ${rowSpacing} m spacing.`}
              </p>
            ) : null
          ) : null}
        </section>
      )}

      <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void onPick(f) }} />

      {!image ? (
        <div className="ocr-drop" onClick={() => fileRef.current?.click()}>
          <div className="ocr-drop-icon">🌳</div>
          <div className="ocr-drop-title">
            {processingPhoto ? (km ? 'កំពុងដំណើរការ…' : 'Processing photo...') : (km ? 'ថតរូបរុក្ខជាតិ / ដើមឈើ' : 'Photograph a plant / tree')}
          </div>
          <div className="ocr-drop-sub">{km ? 'ដើមមួយក្នុងមួយកំណត់ត្រា' : 'one plant per record'}</div>
        </div>
      ) : (
        <>
          <img className="ocr-preview" src={previewUrl} alt="" />

          <label className="voice-field species-combo">
            <span>{km ? 'ប្រភេទ' : 'Species'}</span>
            <input
              type="text"
              value={speciesQuery}
              maxLength={60}
              spellCheck={false}
              placeholder={km ? 'ស្វែងរក ឬវាយបញ្ចូលប្រភេទ…' : 'Search or type a species…'}
              onFocus={() => setSpeciesOpen(true)}
              onChange={(e) => { setSpeciesQuery(e.target.value); setSpeciesOpen(true); setSpeciesHighlight(0) }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault(); setSpeciesOpen(true)
                  setSpeciesHighlight((index) => Math.min(index + 1, speciesMatches.length - 1))
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault(); setSpeciesHighlight((index) => Math.max(index - 1, 0))
                } else if (e.key === 'Enter') {
                  e.preventDefault()
                  if (speciesOpen && speciesMatches[speciesHighlight]) selectSpecies(speciesMatches[speciesHighlight].id)
                  else commitSpeciesQuery()
                  setSpeciesOpen(false)
                } else if (e.key === 'Escape') setSpeciesOpen(false)
              }}
              onBlur={() => { commitSpeciesQuery(); setSpeciesOpen(false) }}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={speciesOpen}
              aria-controls={speciesListboxId}
              aria-activedescendant={speciesOpen && speciesMatches[speciesHighlight] ? `${speciesListboxId}-${speciesMatches[speciesHighlight].id}` : undefined}
            />
            {speciesOpen ? (
              <div id={speciesListboxId} className="species-combo-panel" role="listbox">
                {speciesMatches.map((item, index) => (
                  <button
                    id={`${speciesListboxId}-${item.id}`}
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={species === item.id}
                    className={index === speciesHighlight ? 'active' : ''}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setSpeciesHighlight(index)}
                    onClick={() => selectSpecies(item.id)}
                  >
                    <span>{km ? item.km : item.en}</span>
                    {item.scientific || GENERIC_DENSITY_SPECIES.has(item.id) ? (
                      <small>
                        {item.scientific ? `(${item.scientific})` : ''}
                        {GENERIC_DENSITY_SPECIES.has(item.id) ? (km ? ' · ប៉ាន់ស្មានទូទៅ' : ' · general estimate') : ''}
                      </small>
                    ) : null}
                  </button>
                ))}
                {speciesMatches.length === 0 && speciesQuery.trim() ? (
                  <div className="species-combo-empty">
                    {km ? `ប្រើ “${speciesQuery.trim()}” ជាប្រភេទផ្ទាល់ខ្លួន` : `Use “${speciesQuery.trim()}” as a custom species`}
                  </div>
                ) : null}
              </div>
            ) : null}
          </label>

          <section className="garden-form-section" aria-labelledby="garden-measure-title">
            <div className="garden-form-heading">
              <div>
                <h2 id="garden-measure-title">{km ? 'វាស់ដើមឈើ' : 'Measure the tree'}</h2>
                <p>{km ? 'បញ្ចូលអង្កត់ផ្ចិត ឬកម្ពស់យ៉ាងហោចណាស់មួយ' : 'Enter trunk width or height — one measurement is enough.'}</p>
              </div>
              <span className="garden-required">{km ? 'ត្រូវការ' : 'Required'}</span>
            </div>
            <div className="garden-measure">
            <label className="voice-field garden-input-card">
              <span>{km ? 'អង្កត់ផ្ចិតដើម' : 'Trunk width'}</span>
              <small>{km ? 'សង់ទីម៉ែត្រ · វាស់នៅកម្ពស់ ១.៣ ម' : 'centimetres · measure at 1.3 m high'}</small>
              <input type="text" inputMode="decimal" min="0" value={dbh} placeholder="e.g. 20.5"
                onChange={(e) => setDbh(e.target.value)} />
            </label>
            <label className="voice-field garden-input-card">
              <span>{km ? 'កម្ពស់ដើមឈើ' : 'Tree height'}</span>
              <small>{km ? 'ម៉ែត្រ · ប៉ាន់ស្មានបាន' : 'metres · an estimate is fine'}</small>
              <input type="text" inputMode="decimal" min="0" value={height} placeholder="e.g. 8.5"
                onChange={(e) => setHeight(e.target.value)} />
            </label>
            <label className="voice-field garden-input-card garden-count-field">
              <span>{km ? 'ចំនួន' : 'Count'}</span>
              <small>{km ? 'ដើមដូចគ្នា' : 'matching plants'}</small>
              <input type="number" inputMode="numeric" min="1" value={count}
                onChange={(e) => setCount(Math.max(1, parseInt(e.target.value) || 1))} />
            </label>
            </div>
          </section>

          {/*
            The number has four components and only the biomass model is a
            published one: Chave et al. (2014) Eq. 4 for AGB, an UNRESOLVED
            carbon fraction, 44/12 stoichiometry, and our own wood-density table.
            When height was not measured the biomass model is ours too, so the
            label has to say which of the two ran. Deliberately no "IPCC" here
            while that attribution is unverified — docs/REFERENCES.md §3.
          */}
          <div className="garden-est">
            ≈ <b>{est.total}</b> kg CO₂ {count > 1 ? <small>({est.per} × {count})</small> : null}
          </div>
          <p className="garden-est-note">
            {measure.method === 'dbh_height'
              ? km
                ? 'ការប៉ាន់ស្មាន — Chave et al. (2014) សមីការទី 4។ មិនមែនជាក្រេឌីតសម្រាប់ជួញដូរឡើយ។'
                : 'Estimate — Chave et al. (2014) Eq. 4. Never a tradable credit.'
              : km
                ? 'ការប៉ាន់ស្មានប្រហាក់ប្រហែល — មិនបានវាស់កម្ពស់ ប្រើរូបមន្តផ្ទៃក្នុង។ មិនមែនជាក្រេឌីតសម្រាប់ជួញដូរឡើយ។'
                : 'Rough estimate — height not measured, in-house approximation. Never a tradable credit.'}
            {' '}
            <a href="https://github.com/sengtha/iAny/blob/main/docs/REFERENCES.md"
               target="_blank" rel="noreferrer">
              {km ? 'របៀបគណនា' : 'How this is calculated'}
            </a>
          </p>

          <label className="voice-field">
            <span>{km ? 'សួន (plot)' : 'Plot'}</span>
            <input type="text" value={plot} maxLength={40} onChange={(e) => setPlot(e.target.value)} />
          </label>

          {row ? (
          <section className="garden-location" aria-live="polite">
            <div>
              <h2>{km ? 'ទីតាំងក្នុងជួរ' : 'Position in the row'}</h2>
              <p>{km ? 'គណនាពី GPS ចុងជួរ និងគម្លាត · កំណត់ត្រានឹងបញ្ជាក់ថាវាជាទីតាំងគណនា' : 'Computed from the row-end GPS and spacing · the record says it was computed'}</p>
            </div>
            <label className="voice-field garden-treerow-number">
              <span>{km ? 'លេខដើមឈើក្នុងជួរ' : 'Tree number in the row'}</span>
              <input type="number" inputMode="numeric" min="1" value={treeNumberText}
                onChange={(e) => setTreeNumberText(e.target.value)} />
            </label>
            <p className={readyRow ? 'garden-location-status success' : 'garden-location-status'}>
              {readyRow
                ? (km ? `ដើមទី ${treeNumber} · ${((treeNumber - 1) * rowSpacing).toFixed(1)} ម ពីដើមទីមួយ` : `Tree ${treeNumber} · ${((treeNumber - 1) * rowSpacing).toFixed(1)} m from the first tree`)
                : (km ? 'បញ្ចប់ការរៀបចំជួរនៅខាងលើជាមុនសិន' : 'Finish the row setup above first')}
            </p>
          </section>
          ) : (
          <section className="garden-location" aria-live="polite">
            <div>
              <h2>{km ? 'ទីតាំងដើមឈើ' : 'Tree location'}</h2>
              <p>{km ? 'ស្រេចចិត្ត · នៅលើឧបករណ៍នេះ រហូតដល់អ្នកផ្សព្វផ្សាយកំណត់ត្រា' : 'Optional · stays on this device until you publish the record'}</p>
            </div>
            <button className={gps ? 'garden-location-button recorded' : 'garden-location-button'} onClick={addLocation} disabled={locating || !locationEnabled}>
              <span aria-hidden="true">{locating ? '◌' : '📍'}</span>
              <span>{locating ? (km ? 'កំពុងរកទីតាំង…' : 'Finding location…') : gps ? (km ? 'ផ្ទុកទីតាំងម្ដងទៀត' : 'Refresh location') : (km ? 'កត់ត្រាទីតាំងនេះ' : 'Record this location')}</span>
            </button>
            {!locationEnabled ? <p className="garden-location-status">{km ? 'សូមបើកទីតាំងនៅផ្នែកខាងលើ ដើម្បីកត់ត្រាទីតាំងដើមឈើ។' : 'Turn on location in the header to record this tree’s position.'}</p> : null}
            {locationMessage ? (
              <p className={gps && gps.acc <= ACCEPTABLE_ACCURACY_M ? 'garden-location-status success' : 'garden-location-status'}>
                {locationMessage}
              </p>
            ) : null}
            {locating && locateBest !== null ? (
              <button type="button" className="voice-ghost garden-use-now" onClick={() => locateAbort.current?.abort()}>
                {km ? `ប្រើ ±${locateBest} ម ឥឡូវនេះ` : `Use ±${locateBest} m now`}
              </button>
            ) : null}
          </section>
          )}

          {error ? <p className="voice-error">{error}</p> : null}
          <div className="voice-controls">
            <button className="voice-ghost" onClick={() => { setImage(null); setPreviewUrl(''); setGps(null); setLocationMessage(''); locationRequestId.current += 1; setLocating(false); if (fileRef.current) fileRef.current.value = '' }}>↺</button>
            <button className="voice-primary big" onClick={save} disabled={saving || locating || processingPhoto}>
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
              <button className="voice-ghost small" onClick={() => void shareBundle()}>
                📤 {km ? 'ចែករំលែក' : 'Share'}
              </button>
              <button className="voice-ghost small" onClick={() => importRef.current?.click()}>
                📥 {km ? 'នាំចូល' : 'Import'}
              </button>
              <input ref={importRef} type="file" accept="application/json,.json" style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0]; void onImport(f ?? null); e.target.value = '' }} />
            </div>
          </div>
          {publishMsg ? <p className="garden-publish-msg">{publishMsg}</p> : null}
          {[...obs].reverse().slice(0, 30).map((o) => (
            <div key={o.id} className="garden-row">
              <span className="garden-row-sp">{speciesShortLabel(o.species, km)}{o.count > 1 ? ` ×${o.count}` : ''}</span>
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
        {/*
          The plot name is hashed on this device and never sent as text, but the
          hash IS public on chain, and plot names are short and speakable because
          a verifier types one standing in a field. A wordlist crossed with a
          two-digit index recovers most of them in seconds, and liveCount and
          species sit beside the hash in the same anchor. So this panel no longer
          says the name is safe; it says what is true and tells her what to do
          about it today. The real fix is a salted commitment in grove/core/csb.ts
          (plotId = keccak256(plot ‖ salt)), which changes the derivation in three
          repositories and is deliberately not part of this copy change.
        */}
        <p className="garden-chain-lead">
          {km
            ? 'ហត្ថលេខាបញ្ជាក់ថា “នរណានិយាយ” មិនមែន “ពិតឬអត់”។ ការចងភ្ជាប់បន្ថែមកាលបរិច្ឆេទដែលអ្នកដទៃយល់ព្រម និងកន្លែងឲ្យអ្នកផ្ទៀងផ្ទាត់មានអាជ្ញាបណ្ណដាក់ឈ្មោះ។ មានតែ hash ទេដែលចេញពីទូរស័ព្ទនេះ — រូបថត ទីតាំង និងសោឧបករណ៍ មិនចេញឡើយ។ ឈ្មោះសួនក៏ផ្ញើជា hash ដែរ ប៉ុន្តែឈ្មោះខ្លីធម្មតា អាចមានគេទាយចេញពី hash នោះបាន។ ដូច្នេះសូមជ្រើសឈ្មោះសួនណាដែលអ្នកមិនខ្វល់ បើមានមនុស្សចម្លែកដឹង។'
            : 'A signature proves who said something, never that it is true. Anchoring adds a date somebody else agrees with, and a place a licensed field verifier can put their name. Only hashes leave this phone — never the photo, never your location, never your device key. The plot name is sent as a hash too, but a short everyday name can be worked back out of that hash by someone who tries, so pick a plot name you would not mind a stranger guessing.'}
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
