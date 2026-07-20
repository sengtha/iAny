import { useState } from 'react'
import { useI18n } from '../i18n'
import { HEALTH_TOPICS, type HealthTopic } from '../assets/healthTopics'

/**
 * 🩺 Khmer health education (/health) — offline, curated public-health topics with
 * a "read aloud" (on-device Khmer TTS). INFORMATION ONLY, never diagnosis: every
 * topic ends with a "when to seek care" note and a standing disclaimer routes
 * people to a real health worker. See docs/HEALTH-AI.md.
 *
 * Content is a reviewed-standard STARTER set (WHO/UNICEF-style) — meant to be
 * extended and verified by health professionals before production use.
 */

type TtsPhase = 'idle' | 'loading' | 'speaking'

export function HealthView() {
  const { t, lang } = useI18n()
  const km = lang === 'km'
  const [open, setOpen] = useState<string | null>(HEALTH_TOPICS[0]?.id ?? null)
  const [tts, setTts] = useState<{ id: string; phase: TtsPhase; pct: number } | null>(null)

  // Lazy on-device Khmer TTS — imported only when a topic is played, so the page
  // stays light. Reads the Khmer text (it's a Khmer voice).
  async function listen(topic: HealthTopic) {
    try {
      const { khmerTts } = await import('../ai/khmertts')
      if (tts && tts.phase === 'speaking') {
        khmerTts.stop()
        setTts(null)
        if (tts.id === topic.id) return // tapping the same one again = stop
      }
      setTts({ id: topic.id, phase: 'loading', pct: 0 })
      await khmerTts.init((p) => setTts({ id: topic.id, phase: 'loading', pct: p.progress ?? 0 }))
      const text = [topic.titleKm, ...topic.bodyKm, topic.seekKm].join(' ')
      setTts({ id: topic.id, phase: 'speaking', pct: 1 })
      await khmerTts.speak(text)
      setTts(null)
    } catch {
      setTts(null)
    }
  }

  return (
    <div className="contribute health">
      <p className="health-disclaimer">⚕️ {t('healthDisclaimer')}</p>

      <p className="contribute-lead">
        {km
          ? 'ព័ត៌មានសុខភាពមូលដ្ឋាន សម្រាប់អាន ឬស្ដាប់ ក្រៅបណ្ដាញ។ នេះមិនមែនជាការវិនិច្ឆ័យទេ។'
          : 'Basic health information to read or listen to, offline. This is not a diagnosis.'}
      </p>

      <div className="health-list">
        {HEALTH_TOPICS.map((topic) => {
          const isOpen = open === topic.id
          const active = tts?.id === topic.id
          return (
            <div key={topic.id} className={`health-card ${isOpen ? 'open' : ''}`}>
              <button
                className="health-card-head"
                onClick={() => setOpen(isOpen ? null : topic.id)}
                aria-expanded={isOpen}
              >
                <span className="health-card-emoji" aria-hidden>{topic.emoji}</span>
                <b>{km ? topic.titleKm : topic.titleEn}</b>
                <span className="health-card-caret" aria-hidden>{isOpen ? '−' : '+'}</span>
              </button>

              {isOpen && (
                <div className="health-card-body">
                  <ul>
                    {(km ? topic.bodyKm : topic.bodyEn).map((line, i) => (
                      <li key={i} lang={km ? 'km' : 'en'}>{line}</li>
                    ))}
                  </ul>
                  <p className="health-seek" lang={km ? 'km' : 'en'}>
                    ⚠ {km ? topic.seekKm : topic.seekEn}
                  </p>
                  <div className="health-card-foot">
                    <button
                      className={`voice-ghost trace-scan ${active && tts?.phase === 'speaking' ? 'trace-matcher-on' : ''}`}
                      onClick={() => void listen(topic)}
                    >
                      {active && tts?.phase === 'loading'
                        ? `${t('healthLoadingVoice')} ${Math.round((tts?.pct ?? 0) * 100)}%`
                        : active && tts?.phase === 'speaking'
                          ? `⏹ ${t('healthStop')}`
                          : `🔊 ${t('healthListen')}`}
                    </button>
                    <span className="health-source">{t('healthSource')}: {topic.source}</span>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <p className="voice-minor-note">{t('healthContentNote')}</p>
    </div>
  )
}
