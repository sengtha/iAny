import { FilesetResolver, HandLandmarker, type HandLandmarkerResult } from '@mediapipe/tasks-vision'

/**
 * MediaPipe Hand Landmarker wrapper for the /sign collector.
 *
 * Tracks up to two hands (21 keypoints each) from the webcam, on-device. We keep
 * only the **landmarks**, never the video — so the contributed data is tiny and
 * identity-free (privacy by design). Apache-2.0 (MediaPipe).
 *
 * Assets are self-hosted for offline use:
 *  - WASM  → /mediapipe/  (copied by scripts/copy-ort.mjs; served statically)
 *  - model → hand_landmarker.task, mirrored through the same /models/ proxy as
 *            every other iAny model (Worker → HF → R2, cached offline). The
 *            path is overridable via localStorage 'iany.handModel' for testing.
 *            See docs/SIGN-COLLECTION.md.
 */

const WASM_PATH = `${location.origin}/mediapipe`
const MODEL_PATH =
  (typeof localStorage !== 'undefined' && localStorage.getItem('iany.handModel')) ||
  `${location.origin}/models/sengtha/mediapipe-hand/resolve/main/hand_landmarker.task`

/** One frame: up to two hands, each 21 (x,y,z) normalized landmarks, + handedness. */
export interface HandFrame {
  hands: { landmarks: [number, number, number][]; handedness: 'Left' | 'Right' }[]
}

let landmarker: HandLandmarker | null = null
let loading: Promise<HandLandmarker> | null = null

export async function ensureHandLandmarker(): Promise<HandLandmarker> {
  if (landmarker) return landmarker
  if (loading) return loading
  loading = (async () => {
    const fileset = await FilesetResolver.forVisionTasks(WASM_PATH)
    const lm = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'GPU' },
      numHands: 2,
      runningMode: 'VIDEO',
    })
    landmarker = lm
    return lm
  })()
  return loading
}

/** Detect hands in one video frame. Returns compact, video-free landmark data. */
export function detectFrame(video: HTMLVideoElement, timestampMs: number): HandFrame {
  if (!landmarker) return { hands: [] }
  const res: HandLandmarkerResult = landmarker.detectForVideo(video, timestampMs)
  const hands = (res.landmarks ?? []).map((pts, i) => ({
    landmarks: pts.map((p) => [round(p.x), round(p.y), round(p.z)] as [number, number, number]),
    handedness: (res.handednesses?.[i]?.[0]?.categoryName as 'Left' | 'Right') ?? 'Right',
  }))
  return { hands }
}

const round = (n: number) => Math.round(n * 1e4) / 1e4 // 4 dp keeps files tiny

// The capability check lives in ../ai/handModel (no MediaPipe import), so the
// Models screen can use it without bundling the tracker. Re-exported here for
// callers that already load the tracker (e.g. ContributeSignView).
export { isHandTrackingSupported } from '../ai/handModel'

export function releaseHandLandmarker(): void {
  landmarker?.close()
  landmarker = null
  loading = null
}
