import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../i18n'
import { shufflePromptsFor, VOICE_PROMPT_COUNT, type VoicePrompt } from '../assets/voicePrompts'
import { RecordedClip, VoiceRecorder } from '../lib/wavRecorder'
import {
  EMPTY_PROFILE,
  fetchStats,
  loadDone,
  loadProfile,
  markDone,
  saveProfile,
  speakerId,
  uploadClip,
  type VoiceProfile,
  type VoiceStats,
} from '../lib/voiceContribute'

/**
 * 🎤 Contribute your voice — a classroom data-collection screen.
 *
 * A student reads short Khmer sentences aloud; each recording + its exact text
 * becomes one open (audio, transcript) pair that trains a free Khmer speech-to-
 * text model. Records 16 kHz mono WAV in-browser and uploads to the Worker.
 *
 * Consent-first (recordings + the trained model are released open-source, with
 * credit), progress is saved on-device, and it works on any classroom browser.
 */
type Phase = 'idle' | 'recording' | 'review' | 'uploading'

export function ContributeView() {
  const [profile, setProfile] = useState<VoiceProfile>(loadProfile)
  const [started, setStarted] = useState(false)
  const [stats, setStats] = useState<VoiceStats | null>(null)

  useEffect(() => {
    void fetchStats().then(setStats)
  }, [])

  if (!started || !profile.consent) {
    return (
      <ConsentGate
        profile={profile}
        stats={stats}
        onStart={(p) => {
          saveProfile(p)
          setProfile(p)
          setStarted(true)
        }}
      />
    )
  }
  return <Recorder profile={profile} onStats={setStats} stats={stats} />
}

/* -------------------------------------------------------------------------- */

function ConsentGate({
  profile,
  stats,
  onStart,
}: {
  profile: VoiceProfile
  stats: VoiceStats | null
  onStart: (p: VoiceProfile) => void
}) {
  const { t } = useI18n()
  const [draft, setDraft] = useState<VoiceProfile>({ ...EMPTY_PROFILE, ...profile })
  const supported = VoiceRecorder.isSupported()

  return (
    <div className="contribute">
      <h2 className="contribute-title">🎤 {t('voiceTitle')}</h2>
      <p className="contribute-lead">{t('voiceLead')}</p>

      {stats && stats.clips > 0 ? (
        <div className="voice-stats">
          <b>{stats.clips.toLocaleString()}</b> {t('voiceStatClips')} ·{' '}
          <b>{stats.speakers.toLocaleString()}</b> {t('voiceStatVoices')} ·{' '}
          <b>{stats.hours.toFixed(1)}</b> {t('voiceStatHours')}
        </div>
      ) : null}

      <div className="voice-openbox">
        <div className="voice-openrow">🗂️ {t('voiceOpenData')}</div>
        <div className="voice-openrow">🏅 {t('voiceOpenCredit')}</div>
        <div className="voice-openrow">🆓 {t('voiceOpenModel')}</div>
      </div>

      <fieldset className="voice-fields">
        <label className="voice-field">
          <span>{t('voiceCreditName')}</span>
          <input
            type="text"
            value={draft.creditName}
            maxLength={60}
            placeholder={t('voiceCreditPlaceholder')}
            onChange={(e) => setDraft({ ...draft, creditName: e.target.value })}
          />
          <small>{t('voiceCreditHint')}</small>
        </label>

        <div className="voice-field-row">
          <label className="voice-field">
            <span>{t('voiceClass')}</span>
            <input
              type="text"
              value={draft.classLabel}
              maxLength={24}
              placeholder={t('voiceClassPlaceholder')}
              onChange={(e) => setDraft({ ...draft, classLabel: e.target.value })}
            />
          </label>
          <label className="voice-field">
            <span>{t('voiceAge')}</span>
            <select
              value={draft.ageBand}
              onChange={(e) => setDraft({ ...draft, ageBand: e.target.value as VoiceProfile['ageBand'] })}
            >
              <option value="">—</option>
              <option value="under12">{t('voiceAgeUnder12')}</option>
              <option value="12to15">12–15</option>
              <option value="16to18">16–18</option>
              <option value="adult">{t('voiceAgeAdult')}</option>
            </select>
          </label>
        </div>

        <div className="voice-field-row">
          <label className="voice-field">
            <span>{t('voiceGender')}</span>
            <select
              value={draft.gender}
              onChange={(e) => setDraft({ ...draft, gender: e.target.value as VoiceProfile['gender'] })}
            >
              <option value="">—</option>
              <option value="female">{t('voiceGenderF')}</option>
              <option value="male">{t('voiceGenderM')}</option>
              <option value="other">{t('voiceGenderO')}</option>
            </select>
          </label>
          <label className="voice-field">
            <span>{t('voiceRegion')}</span>
            <input
              type="text"
              value={draft.region}
              maxLength={40}
              placeholder={t('voiceRegionPlaceholder')}
              onChange={(e) => setDraft({ ...draft, region: e.target.value })}
            />
          </label>
        </div>
      </fieldset>

      <label className="voice-consent">
        <input
          type="checkbox"
          checked={draft.consent}
          onChange={(e) => setDraft({ ...draft, consent: e.target.checked })}
        />
        <span>{t('voiceConsent')}</span>
      </label>
      <p className="voice-minor-note">{t('voiceMinorNote')}</p>

      {!supported ? <p className="voice-error">{t('voiceUnsupported')}</p> : null}

      <button
        className="voice-primary"
        disabled={!draft.consent || !supported}
        onClick={() => onStart(draft)}
      >
        {t('voiceStart')}
      </button>
      <p className="voice-anon">{t('voiceAnon')}: {speakerId()}</p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function Recorder({
  profile,
  stats,
  onStats,
}: {
  profile: VoiceProfile
  stats: VoiceStats | null
  onStats: (s: VoiceStats | null) => void
}) {
  const { t } = useI18n()
  const prompts = useMemo(() => shufflePromptsFor(speakerId()), [])
  const [done, setDone] = useState<Set<string>>(loadDone)
  const [idx, setIdx] = useState(() => firstUndone(prompts, loadDone()))
  const [phase, setPhase] = useState<Phase>('idle')
  const [level, setLevel] = useState(0)
  const [clip, setClip] = useState<RecordedClip | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string>('')
  const [error, setError] = useState('')
  const recorderRef = useRef<VoiceRecorder | null>(null)

  const prompt: VoicePrompt | undefined = prompts[idx]
  const doneCount = done.size

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  async function startRec() {
    setError('')
    setClip(null)
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
      setPreviewUrl('')
    }
    const rec = new VoiceRecorder({ onLevel: setLevel })
    recorderRef.current = rec
    try {
      await rec.start()
      setPhase('recording')
    } catch {
      setError(t('voiceMicDenied'))
      setPhase('idle')
    }
  }

  async function stopRec() {
    const rec = recorderRef.current
    if (!rec) return
    try {
      const recorded = await rec.stop()
      setLevel(0)
      setClip(recorded)
      setPreviewUrl(URL.createObjectURL(recorded.wav))
      setPhase('review')
    } catch {
      setError(t('voiceRecFailed'))
      setPhase('idle')
    }
  }

  function redo() {
    setClip(null)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl('')
    setPhase('idle')
  }

  async function keep() {
    if (!clip || !prompt) return
    setPhase('uploading')
    try {
      await uploadClip(
        { wav: clip.wav, sentence: prompt.text, sentenceId: prompt.id, durationSec: clip.durationSec },
        profile,
      )
      const next = new Set(done)
      next.add(prompt.id)
      setDone(next)
      markDone(next)
      if (stats) onStats({ ...stats, clips: stats.clips + 1 })
      advance(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('voiceUploadFailed'))
      setPhase('review')
    }
  }

  function advance(doneSet: Set<string>) {
    setClip(null)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl('')
    setPhase('idle')
    setIdx(nextUndone(prompts, doneSet, idx))
  }

  function skip() {
    setIdx((i) => (i + 1) % prompts.length)
    redo()
  }

  if (doneCount >= VOICE_PROMPT_COUNT) {
    return (
      <div className="contribute">
        <h2 className="contribute-title">🎉 {t('voiceAllDoneTitle')}</h2>
        <p className="contribute-lead">{t('voiceAllDoneBody')}</p>
        <div className="voice-progress-big">{doneCount} / {VOICE_PROMPT_COUNT}</div>
      </div>
    )
  }

  return (
    <div className="contribute">
      <div className="voice-progress">
        <div className="voice-progress-bar">
          <span style={{ width: `${(doneCount / VOICE_PROMPT_COUNT) * 100}%` }} />
        </div>
        <span className="voice-progress-num">
          {doneCount} / {VOICE_PROMPT_COUNT}
        </span>
      </div>

      <div className="voice-card">
        <div className="voice-card-label">{t('voiceReadAloud')}</div>
        <p className="voice-sentence" lang="km">
          {prompt?.text}
        </p>
      </div>

      <div className={phase === 'recording' ? 'voice-meter on' : 'voice-meter'} aria-hidden>
        <span style={{ transform: `scaleY(${0.15 + level * 0.85})` }} />
        <span style={{ transform: `scaleY(${0.15 + level * 0.7})` }} />
        <span style={{ transform: `scaleY(${0.15 + level})` }} />
        <span style={{ transform: `scaleY(${0.15 + level * 0.7})` }} />
        <span style={{ transform: `scaleY(${0.15 + level * 0.85})` }} />
      </div>

      {clip && clip.peak < 0.05 && phase === 'review' ? (
        <p className="voice-warn">{t('voiceTooQuiet')}</p>
      ) : null}
      {error ? <p className="voice-error">{error}</p> : null}

      {previewUrl && phase === 'review' ? (
        <audio className="voice-audio" src={previewUrl} controls />
      ) : null}

      <div className="voice-controls">
        {phase === 'idle' ? (
          <>
            <button className="voice-primary big" onClick={startRec}>
              ⏺ {t('voiceRecord')}
            </button>
            <button className="voice-ghost" onClick={skip}>
              {t('voiceSkip')} ⏭
            </button>
          </>
        ) : null}

        {phase === 'recording' ? (
          <button className="voice-stop big" onClick={stopRec}>
            ⏹ {t('voiceStop')}
          </button>
        ) : null}

        {phase === 'review' ? (
          <>
            <button className="voice-ghost" onClick={redo}>
              ↺ {t('voiceRedo')}
            </button>
            <button className="voice-primary big" onClick={keep}>
              ✓ {t('voiceKeep')}
            </button>
          </>
        ) : null}

        {phase === 'uploading' ? <div className="voice-uploading">{t('voiceUploading')}…</div> : null}
      </div>

      <p className="voice-tip">{t('voiceTip')}</p>
    </div>
  )
}

function firstUndone(prompts: VoicePrompt[], done: Set<string>): number {
  const i = prompts.findIndex((p) => !done.has(p.id))
  return i < 0 ? 0 : i
}
function nextUndone(prompts: VoicePrompt[], done: Set<string>, from: number): number {
  for (let k = 1; k <= prompts.length; k++) {
    const i = (from + k) % prompts.length
    if (!done.has(prompts[i]!.id)) return i
  }
  return from
}
