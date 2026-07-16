import { RadioPlayer, type RadioFeed } from '@iany/core'
import { radioVoice } from './ai/radioVoice'
import { waitingMusic } from './ai/waitingMusic'

/**
 * PWA radio = core's shared RadioPlayer wired to radioVoice (the trained iAny
 * Khmer ONNX voice when downloaded, else the browser voice) + a fetch of
 * /radio/feed (same origin as the app / Worker). Same player as mobile.
 */
const fetchFeed = async (since: string): Promise<RadioFeed> => {
  const res = await fetch(`/radio/feed?since=${encodeURIComponent(since)}`)
  if (!res.ok) throw new Error(`feed ${res.status}`)
  return (await res.json()) as RadioFeed
}

export const radio = new RadioPlayer({ tts: radioVoice, fetchFeed, music: waitingMusic })
