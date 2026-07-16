import { Audio } from 'expo-av'
import type { RadioWaitingMusic } from '@iany/core'

// Bundled loop tracks — Metro packages these into the app, so the music is
// available fully offline. require() (not import) is how RN references assets.
const TRACKS = [
  require('../../assets/radio/loop-1.mp3'),
  require('../../assets/radio/loop-2.mp3'),
  require('../../assets/radio/loop-3.mp3'),
]

const TARGET_VOLUME = 0.3

/**
 * Background loop music for the radio's `waiting` gaps. Picks a random track and
 * loops it quietly through expo-av; stops the moment news plays. A generation
 * counter guards the async load/stop race so a quick waiting→playing flip can't
 * leave a track running.
 */
class NativeWaitingMusic implements RadioWaitingMusic {
  private sound: Audio.Sound | null = null
  private gen = 0
  private active = false

  async play(): Promise<void> {
    if (this.active) return
    this.active = true
    const my = ++this.gen
    try {
      const track = TRACKS[Math.floor(Math.random() * TRACKS.length)]
      const { sound } = await Audio.Sound.createAsync(track, {
        shouldPlay: true,
        isLooping: true,
        volume: TARGET_VOLUME,
      })
      if (my !== this.gen) {
        // stop() was called while we were loading — discard this sound.
        await sound.unloadAsync().catch(() => {})
        return
      }
      this.sound = sound
    } catch {
      this.active = false
    }
  }

  async stop(): Promise<void> {
    if (!this.active) return
    this.active = false
    this.gen++ // cancel any in-flight play()
    const sound = this.sound
    this.sound = null
    if (sound) {
      await sound.stopAsync().catch(() => {})
      await sound.unloadAsync().catch(() => {})
    }
  }
}

export const waitingMusic = new NativeWaitingMusic()
