import * as FileSystem from 'expo-file-system'
import { initWhisper, type WhisperContext } from 'whisper.rn'
import { ensureFile, errStr } from './modelFile'
import { STT_MODEL_FILE, STT_MODEL_REPO } from '../domain/types'

/**
 * On-device Khmer speech-to-text (whisper-tiny-khmer, GGML q5_1) via whisper.rn.
 * Records from the mic and transcribes in real time, fully offline. Powers the
 * Chat mic button: speak → text → RAG.
 *
 * The GGML weights download once through the iAny mirror (like the other
 * models), then load into a native whisper context that's kept warm for the
 * session. Realtime mode captures 16 kHz mono internally, so there's no WAV
 * wrangling on our side.
 */

export type SttStatus =
  | 'idle'
  | 'downloading'
  | 'loading'
  | 'listening'
  | 'transcribing'
  | 'error'

export interface SttProgress {
  status: SttStatus
  progress?: number
  error?: string
}

export interface SttSession {
  /** Stop recording; resolves with the final transcript. */
  stop: () => Promise<string>
}

class Stt {
  private ctx: WhisperContext | null = null
  private loading: Promise<WhisperContext> | null = null

  get ready(): boolean {
    return this.ctx != null
  }

  /** Release the native context so a delete/redownload takes effect. */
  async reset(): Promise<void> {
    const c = this.ctx
    this.ctx = null
    this.loading = null
    await c?.release?.()
  }

  /** Ensure the model is downloaded + the native context is initialised. */
  async init(onProgress?: (p: SttProgress) => void): Promise<WhisperContext> {
    if (this.ctx) return this.ctx
    if (this.loading) return this.loading
    this.loading = (async () => {
      try {
        const path = await ensureFile(STT_MODEL_REPO, STT_MODEL_FILE, (f) =>
          onProgress?.({ status: 'downloading', progress: f }),
        )
        onProgress?.({ status: 'loading' })
        const ctx = await initWhisper({ filePath: path })
        this.ctx = ctx
        return ctx
      } catch (e) {
        onProgress?.({ status: 'error', error: errStr(e) })
        throw e
      } finally {
        this.loading = null
      }
    })()
    return this.loading
  }

  /**
   * Start listening. `onPartial` fires with the transcript-so-far as the user
   * speaks; the returned `stop()` ends capture and resolves the final text.
   */
  async listen(
    onPartial: (text: string) => void,
    onProgress?: (p: SttProgress) => void,
  ): Promise<SttSession> {
    // RECORD-ONLY: continuous realtime transcription re-runs Whisper over the
    // whole growing buffer every second, which pegs a 2019 phone's CPU and
    // freezes the UI. Instead we set the transcribe threshold to the full
    // window so the realtime engine effectively just *records* to a WAV
    // (audioOutputPath), then we do ONE file-based transcribe on stop. VAD off.
    const wavUri = `${FileSystem.cacheDirectory ?? ''}iany-stt.wav`
    const wavPath = wavUri.replace('file://', '')
    const opts = {
      language: 'km',
      realtimeAudioSec: 30, // whisper's hard 30 s window (also caps recording)
      realtimeAudioSliceSec: 30,
      realtimeAudioMinSec: 30, // don't transcribe mid-recording → no CPU spikes
      audioOutputPath: wavPath,
    }
    let ctx = await this.init(onProgress)
    let realtime: Awaited<ReturnType<WhisperContext['transcribeRealtime']>>
    try {
      realtime = await ctx.transcribeRealtime(opts)
    } catch {
      // whisper.rn returns state -100 when a previous realtime session is still
      // capturing (a start/stop race left it stuck). Release the native context
      // to clear that state, then re-init and try once more.
      await this.reset()
      ctx = await this.init(onProgress)
      realtime = await ctx.transcribeRealtime(opts)
    }
    const { stop, subscribe } = realtime
    onProgress?.({ status: 'listening' })

    // In record-only mode partials rarely fire; keep the handler as a harmless
    // bonus (any early result still shows), but the real result is the
    // file-based pass on stop.
    let latest = ''
    subscribe((evt) => {
      const t = (evt.data?.result ?? '').trim()
      if (t) {
        latest = t
        onPartial(t)
      }
    })

    return {
      stop: async () => {
        await stop()
        // Final accurate pass over the recorded WAV (realtime partials can be
        // partial/rough). Falls back to the last live partial if it fails.
        onProgress?.({ status: 'transcribing' })
        try {
          const info = await FileSystem.getInfoAsync(wavUri)
          if (info.exists && (info.size ?? 0) > 4000) {
            const res = await ctx.transcribe(wavUri, { language: 'km' }).promise
            const finalText = (res?.result ?? '').trim()
            if (finalText) latest = finalText
          }
        } catch {
          /* keep the live partial */
        }
        onProgress?.({ status: 'idle' })
        return latest
      },
    }
  }
}

export const stt = new Stt()
