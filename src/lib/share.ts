/**
 * Offline-friendly sharing of signed JSON records (Grove bundles, Trace capsules,
 * custody records…). Because every record is content-addressed + signed, the
 * transport is untrusted — the receiver re-verifies on import — so we can hand the
 * file to whatever channel the OS offers.
 *
 * `shareJson` uses the Web Share API with a file, which surfaces the native share
 * sheet (Bluetooth · Android Nearby/Quick Share · iOS AirDrop · any messenger),
 * and falls back to a plain download where file-share isn't supported (desktop,
 * older browsers). Web Bluetooth can't do phone-to-phone file transfer, so this is
 * the reliable way to reach Bluetooth et al.
 */

type ShareCapableNavigator = Navigator & {
  canShare?: (data: { files?: File[] }) => boolean
  share?: (data: { files?: File[]; title?: string; text?: string }) => Promise<void>
}

/** True if this browser can share actual files (not just links). */
export function canShareFiles(): boolean {
  const nav = navigator as ShareCapableNavigator
  try {
    return !!nav.share && !!nav.canShare?.({ files: [new File([''], 'x.json', { type: 'application/json' })] })
  } catch {
    return false
  }
}

/** Plain download fallback. */
export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Share a JSON record as a file. Returns 'shared' if it went to the OS share
 * sheet (including a user cancel), or 'downloaded' if it fell back to a download.
 */
export async function shareJson(filename: string, data: unknown): Promise<'shared' | 'downloaded'> {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 1)
  const nav = navigator as ShareCapableNavigator
  const file = new File([text], filename, { type: 'application/json' })
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: filename })
      return 'shared'
    } catch (e) {
      // A user cancel (AbortError) is not a failure — don't also download.
      if (e instanceof DOMException && e.name === 'AbortError') return 'shared'
    }
  }
  downloadText(filename, text)
  return 'downloaded'
}

/** Read + parse a picked JSON file (throws on invalid JSON). */
export async function readJsonFile(file: File): Promise<unknown> {
  return JSON.parse(await file.text())
}
