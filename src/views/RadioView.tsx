import { useSyncExternalStore } from 'react'
import { radio } from '../radio'
import { radioVoice } from '../ai/radioVoice'

/**
 * 📻 iAny Radio — an immersive, full-screen player that reads the verified-outlet
 * news feed aloud with the browser's Khmer voice, always attributing the outlet.
 * Thin view over the shared core RadioPlayer; the visuals (spinning disc,
 * equalizer, transport) are pure CSS so they cost nothing on-device.
 */
export function RadioView() {
  useSyncExternalStore(
    radio.subscribe,
    () => `${radio.state}|${radio.current?.id ?? ''}|${radio.error}`,
  )
  const { state, current, error } = radio
  const active = state === 'playing' || state === 'waiting' || state === 'loading'
  const playing = state === 'playing'

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
              ? 'Press play to listen to the news'
              : 'On air'

  return (
    <div className="radio-screen">
      <div className="radio-bg" aria-hidden />

      <header className="radio-top">
        <div className="radio-word">
          <span aria-hidden>📻</span> iAny Radio
        </div>
        <span className={playing ? 'radio-live on' : 'radio-live'}>
          <i />
          {playing ? 'ON AIR' : active ? 'TUNING' : 'OFF AIR'}
        </span>
      </header>

      <div className="radio-stage">
        <div className={playing ? 'radio-disc spin' : 'radio-disc'}>
          <div className="radio-disc-face">
            {current ? initials(current.outletName) : <span aria-hidden>📻</span>}
          </div>
        </div>
        <div className={playing ? 'radio-eq on' : 'radio-eq'} aria-hidden>
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
      </div>

      <div className="radio-meta">
        {current ? (
          <>
            <div className="radio-outlet">
              ព័ត៌មានពី · {current.outletName}
            </div>
            <h2 className="radio-headline">{current.title}</h2>
            <p className="radio-body">{current.body}</p>
            {current.sponsor ? (
              <div className="radio-sponsor">Sponsored · {current.sponsor}</div>
            ) : null}
          </>
        ) : (
          <p className="radio-idle">
            Verified Khmer news, read aloud on your device.
          </p>
        )}
      </div>

      <div className="radio-status">{status}</div>

      <div className="radio-transport">
        <button
          className="radio-ctl"
          onClick={() => radio.stop()}
          disabled={state === 'idle'}
          aria-label="Stop"
        >
          ⏹
        </button>
        <button
          className="radio-play"
          onClick={() => (active ? radio.pause() : void radio.start())}
          aria-label={active ? 'Pause' : 'Play'}
        >
          {active ? '⏸' : '▶'}
        </button>
        <button className="radio-ctl" onClick={() => radio.skip()} aria-label="Next">
          ⏭
        </button>
      </div>

      {state !== 'idle' && !radioVoice.usingKhmerVoice() ? (
        <p className="radio-warn">
          Using the browser voice. Download the Khmer voice in Settings for correct pronunciation.
        </p>
      ) : null}
    </div>
  )
}

/** Two-letter monogram for the disc face (Latin initials, else first glyph). */
function initials(name: string): string {
  const latin = name.match(/[A-Za-z]+/g)
  if (latin && latin.length) {
    return latin
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('')
  }
  return Array.from(name.trim())[0] ?? '📻'
}
