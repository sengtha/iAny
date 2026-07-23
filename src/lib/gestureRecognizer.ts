import {
  FilesetResolver,
  GestureRecognizer,
  type GestureRecognizerResult,
} from '@mediapipe/tasks-vision'

/**
 * MediaPipe Gesture Recognizer wrapper — the "gesture → command" engine behind the
 * live /magic demo. Recognizes 7 built-in hand gestures (👍👎✌️☝️✊✋🤟) + 21 hand
 * landmarks per frame, on-device and offline. Apache-2.0 (MediaPipe).
 *
 * Same self-hosting as the hand tracker (../lib/handTracker.ts):
 *  - WASM  → /mediapipe/  (served statically)
 *  - model → gesture_recognizer.task, mirrored through the /models/ proxy
 *            (Worker → Google storage → R2, cached offline).
 */
const WASM_PATH = `${location.origin}/mediapipe`
const MODEL_PATH = `${location.origin}/models/sengtha/mediapipe-gesture/resolve/main/gesture_recognizer.task`

/** Normalized (0..1) 2-D landmark in the video's image space. */
export interface Pt { x: number; y: number }

/** One frame's top gesture for the first detected hand, with its landmarks. */
export interface Gesture {
  /** MediaPipe category name, e.g. 'Open_Palm', or 'None' when no clear gesture. */
  name: string
  score: number
  /** 21 hand landmarks (0..1), or null if no hand is present. */
  landmarks: Pt[] | null
}

let recognizer: GestureRecognizer | null = null
let loading: Promise<GestureRecognizer> | null = null

export async function ensureGestureRecognizer(): Promise<GestureRecognizer> {
  if (recognizer) return recognizer
  if (loading) return loading
  loading = (async () => {
    const fileset = await FilesetResolver.forVisionTasks(WASM_PATH)
    const opts = (delegate: 'GPU' | 'CPU') => ({
      baseOptions: { modelAssetPath: MODEL_PATH, delegate },
      numHands: 1,
      runningMode: 'VIDEO' as const,
    })
    // float16 model runs on the GPU delegate; fall back to CPU where WebGL is absent.
    try {
      recognizer = await GestureRecognizer.createFromOptions(fileset, opts('GPU'))
    } catch {
      recognizer = await GestureRecognizer.createFromOptions(fileset, opts('CPU'))
    }
    return recognizer
  })()
  return loading
}

/** Recognize the top gesture + landmarks in one video frame (VIDEO running mode). */
export function recognize(video: HTMLVideoElement, timestampMs: number): Gesture {
  if (!recognizer) return { name: 'None', score: 0, landmarks: null }
  const res: GestureRecognizerResult = recognizer.recognizeForVideo(video, timestampMs)
  const g = res.gestures?.[0]?.[0]
  const lm = res.landmarks?.[0] ?? null
  return {
    name: g?.categoryName || 'None',
    score: g?.score ?? 0,
    landmarks: lm ? lm.map((p) => ({ x: p.x, y: p.y })) : null,
  }
}

export function releaseGestureRecognizer(): void {
  recognizer?.close()
  recognizer = null
  loading = null
}
