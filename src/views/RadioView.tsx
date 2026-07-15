import { useSyncExternalStore } from 'react'
import { radio } from '../radio'
import { webTts } from '../ai/webtts'

/**
 * 📻 iAny Radio — reads the verified-outlet news feed aloud with the browser's
 * Khmer voice, attributing each item to its outlet. Thin view over the shared
 * core RadioPlayer.
 */
export function RadioView() {
  useSyncExternalStore(
    radio.subscribe,
    () => `${radio.state}|${radio.current?.id ?? ''}|${radio.error}`,
  )
  const { state, current, error } = radio
  const active = state === 'playing' || state === 'waiting' || state === 'loading'

  const status =
    state === 'loading'
      ? 'Preparing voice…'
      : state === 'waiting'
        ? 'Waiting for new news…'
        : state === 'error'
          ? `Error: ${error}`
          : state === 'paused'
            ? 'Paused'
            : state === 'idle'
              ? 'Press play to listen to the news.'
              : 'On air'

  return (
    <section style={S.wrap}>
      <h2 style={S.h2}>📻 iAny Radio</h2>
      <p style={S.sub}>Verified Khmer news, read aloud on your device.</p>

      {current ? (
        <div style={S.card}>
          <div style={S.outlet}>{current.outletName}</div>
          <div style={S.headline}>{current.title}</div>
          <div style={S.body}>{current.body}</div>
          {current.sponsor ? <div style={S.sponsor}>Sponsored · {current.sponsor}</div> : null}
        </div>
      ) : null}

      <p style={S.status}>{status}</p>

      <div style={S.controls}>
        {active ? (
          <button style={{ ...S.btn, ...S.primary }} onClick={() => radio.pause()}>
            ⏸ Pause
          </button>
        ) : (
          <button style={{ ...S.btn, ...S.primary }} onClick={() => void radio.start()}>
            ▶ Listen
          </button>
        )}
        <button style={S.btn} onClick={() => radio.skip()}>
          ⏭ Next
        </button>
        <button style={S.btn} onClick={() => radio.stop()}>
          ⏹ Stop
        </button>
      </div>

      {state !== 'idle' && !webTts.hasKhmerVoice() ? (
        <p style={S.warn}>
          This browser has no Khmer voice installed, so pronunciation may be off. Android Chrome
          usually has one; the trained iAny voice will replace this later.
        </p>
      ) : null}
    </section>
  )
}

const S: Record<string, React.CSSProperties> = {
  wrap: { padding: '8px 4px' },
  h2: { margin: '0 0 2px' },
  sub: { margin: '0 0 14px', color: 'var(--muted, #64748b)', fontSize: 14 },
  card: {
    border: '1px solid #c7d2fe',
    background: '#eef2ff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  outlet: { fontSize: 12, fontWeight: 700, color: '#4f46e5' },
  headline: { fontSize: 16, fontWeight: 600, color: '#1e1b4b', margin: '2px 0' },
  body: { fontSize: 14, color: '#334155' },
  sponsor: { fontSize: 12, color: '#64748b', fontStyle: 'italic', marginTop: 4 },
  status: { color: '#475569', fontSize: 13, margin: '0 0 10px' },
  controls: { display: 'flex', gap: 8 },
  btn: {
    padding: '9px 14px',
    borderRadius: 8,
    border: '1px solid #c7d2fe',
    background: '#fff',
    color: '#3730a3',
    fontWeight: 600,
    cursor: 'pointer',
  },
  primary: { background: '#4f46e5', borderColor: '#4f46e5', color: '#fff' },
  warn: { marginTop: 12, color: '#92400e', background: '#fef3c7', padding: 10, borderRadius: 8, fontSize: 13 },
}
