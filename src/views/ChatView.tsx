import { useEffect, useRef, useState } from 'react'
import {
  ai,
  clearCrashGuard,
  crashRecovery,
  getCrashSuspect,
  getGenModelChoice,
  getGenModelId,
  setGenModelChoice,
} from '../ai/client'
import { useModelStatus } from '../hooks/useModelStatus'
import { useI18n } from '../i18n'
import { ask, retrieve } from '../rag/ask'
import type { ChatMessage } from '../types'

function supportsWebGPU(): boolean {
  return 'gpu' in navigator
}

export function ChatView() {
  const { t } = useI18n()
  const status = useModelStatus()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [generatorWanted, setGeneratorWanted] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  // If the previous generator load crashed the tab, hold off on loading it
  // again until the user explicitly retries or picks a smaller model.
  const [crashSuspect, setCrashSuspect] = useState<string | null>(() => getCrashSuspect())
  const crashBlocked = crashSuspect === getGenModelId() && status.generator.status !== 'ready'

  // The Gemma 3 tiers run on CPU (WASM) when WebGPU is missing or broken;
  // only the full Gemma 4 E2B strictly needs a working GPU.
  const webgpuMissing = !supportsWebGPU()
  const fullSelected = getGenModelChoice() === 'full'
  const canGenerate = !(webgpuMissing && fullSelected) && !crashBlocked
  // 'cached' counts as available: weights are on disk and load on demand.
  const generatorReady =
    status.generator.status === 'ready' || status.generator.status === 'cached'

  useEffect(() => {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    bottomRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' })
  }, [messages])

  const send = async () => {
    const question = input.trim()
    if (!question || busy) return
    setInput('')
    setBusy(true)
    setMessages((m) => [...m, { role: 'user', content: question }])
    try {
      if (canGenerate && (generatorReady || generatorWanted)) {
        setMessages((m) => [...m, { role: 'assistant', content: '' }])
        const result = await ask(question, {
          onToken: (token, reset) =>
            setMessages((m) => {
              const next = [...m]
              const last = next[next.length - 1]
              next[next.length - 1] = {
                ...last,
                content: reset ? token : last.content + token,
              }
              return next
            }),
        })
        setMessages((m) => {
          const next = [...m]
          next[next.length - 1] = {
            role: 'assistant',
            content: result.answer,
            sources: result.sources,
          }
          return next
        })
      } else {
        // Search-only mode: no WebGPU, or the user hasn't opted into the
        // big generator download yet.
        const sources = await retrieve(question)
        setMessages((m) => [
          ...m,
          {
            role: 'assistant',
            content: sources.length > 0 ? '' : t('chatNoResults'),
            sources,
          },
        ])
      }
    } catch (e) {
      console.error('[iAny] ask failed', e)
      const detail = e instanceof Error ? e.message : String(e)
      setMessages((m) => [
        ...m,
        // Surface the underlying error: "something went wrong" alone makes
        // remote diagnosis impossible (a phone screenshot is often the only
        // signal we get).
        { role: 'assistant', content: `${t('errorGeneric')}\n\n⚠️ ${detail.slice(0, 300)}` },
      ])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="chat">
      {crashRecovery.downgradedTo && (
        <div className="notice">{t('genAutoDowngraded')}</div>
      )}
      {crashBlocked && (
        <div className="notice">
          <p className="error">{t('genCrashWarning')}</p>
          <div className="row">
            {getGenModelChoice() !== 'tiny' && (
              <button
                className="primary"
                onClick={() =>
                  setGenModelChoice(getGenModelChoice() === 'full' ? 'compact' : 'tiny')
                }
              >
                {t('genCrashUseSmaller')}
              </button>
            )}
            <button
              onClick={() => {
                clearCrashGuard()
                setCrashSuspect(null)
              }}
            >
              {t('settingsRetry')}
            </button>
          </div>
        </div>
      )}
      {webgpuMissing && fullSelected && <div className="notice">{t('chatSearchOnlyNote')}</div>}
      {canGenerate && !generatorReady && !generatorWanted && (
        <div className="notice">
          <button
            className="primary"
            onClick={() => {
              setGeneratorWanted(true)
              void ai.preload('generator').catch(() => {})
            }}
          >
            {t('chatLoadModel')}
          </button>
          <p className="hint">{t('chatLoadModelHint')}</p>
        </div>
      )}
      {status.generator.status === 'loading' && (
        <div className="notice">
          <progress value={status.generator.progress} max={1} />
          <p className="hint">
            {status.generator.network
              ? `${Math.round(status.generator.progress * 100)}% — ${status.generator.file ?? ''}`
              : t('modelPreparing')}
          </p>
        </div>
      )}

      <div className="messages">
        {messages.length === 0 && (
          <div className="empty">
            <h2>{t('chatEmptyTitle')}</h2>
            <p>{t('chatEmptyBody')}</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`message ${msg.role}`}>
            {msg.content && <div className="bubble">{msg.content}</div>}
            {msg.sources && msg.sources.length > 0 && (
              <details className="sources" open={!msg.content}>
                <summary>
                  {t('chatSources')} ({msg.sources.length})
                </summary>
                {msg.sources.map((s, j) => (
                  <blockquote key={s.chunk_id}>
                    <strong>
                      [{j + 1}] {s.title}
                    </strong>
                    <p>{s.text}</p>
                  </blockquote>
                ))}
              </details>
            )}
          </div>
        ))}
        {busy && <div className="message assistant thinking">{t('chatThinking')}</div>}
        <div ref={bottomRef} />
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t('chatPlaceholder')}
          disabled={busy}
        />
        <button className="primary" type="submit" disabled={busy || !input.trim()}>
          {t('chatSend')}
        </button>
      </form>
    </div>
  )
}
