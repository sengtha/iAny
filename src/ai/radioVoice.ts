import { type RadioTts } from '@iany/core'
import { webTts } from './webtts'
import { khmerTts } from './khmertts'

/**
 * The voice the Radio uses: the trained iAny Khmer ONNX voice once it's
 * downloaded, otherwise the browser's SpeechSynthesis. The choice is dynamic —
 * as soon as the user downloads the Khmer voice (in Settings), the next line is
 * read with it, no restart needed.
 */
class RadioVoice implements RadioTts {
  private pick(): RadioTts {
    return khmerTts.ready ? khmerTts : webTts
  }

  get ready(): boolean {
    return this.pick().ready
  }

  async init(): Promise<void> {
    // Use the trained Khmer voice if it's already on the device; else fall back
    // to the browser voice so the Radio still works out of the box.
    if (await khmerTts.isDownloaded()) {
      try {
        await khmerTts.init()
        return
      } catch {
        /* fall through to the browser voice */
      }
    }
    if (!khmerTts.ready) await webTts.init()
  }

  speak(text: string): Promise<void> {
    return this.pick().speak(text)
  }

  stop(): void {
    // Stop whichever might be playing.
    khmerTts.stop()
    webTts.stop()
  }

  /** True once we're reading with a genuine Khmer voice (ONNX or a browser km voice). */
  usingKhmerVoice(): boolean {
    return khmerTts.ready || webTts.hasKhmerVoice()
  }
}

export const radioVoice = new RadioVoice()
