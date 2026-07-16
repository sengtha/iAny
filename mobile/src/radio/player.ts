import { RadioPlayer, type RadioFeed } from '@iany/core'
import { RADIO_API } from '../domain/types'
import { tts } from '../ai/tts'
import { waitingMusic } from '../ai/waitingMusic'

/**
 * The mobile radio player = core's shared RadioPlayer wired to the native TTS
 * (which already matches the RadioTts shape: ready/init/speak/stop) and a fetch
 * of /radio/feed. All queue/polling/pause logic lives in @iany/core, shared with
 * the PWA.
 */
const fetchFeed = async (since: string): Promise<RadioFeed> => {
  const res = await fetch(`${RADIO_API}/feed?since=${encodeURIComponent(since)}`)
  if (!res.ok) throw new Error(`feed ${res.status}`)
  return (await res.json()) as RadioFeed
}

export const radio = new RadioPlayer({ tts, fetchFeed, music: waitingMusic })
