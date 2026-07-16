/**
 * Document text extraction shared by both apps. The goal is one honest list of
 * supported file types and ONE parser for the text-based formats, so a `.html`
 * or `.rtf` file becomes the same clean text on the PWA and on mobile.
 *
 * Binary formats that need a decoder (PDF) are handled per-platform because the
 * decoder differs (pdf.js in the browser vs. its legacy build under Hermes) —
 * but the *classification* of what's supported lives here so both agree.
 */

/** How a file must be handled to get text out of it. */
export type DocKind = 'text' | 'pdf' | 'image' | 'unsupported'

/** Extensions we can read directly as UTF-8 text (some get light cleanup). */
export const TEXT_EXTENSIONS = [
  'txt', 'text',
  'md', 'markdown', 'mdown', 'mkd',
  'csv', 'tsv',
  'json', 'jsonl', 'ndjson',
  'log',
  'html', 'htm', 'xhtml',
  'xml',
  'rtf',
  'yaml', 'yml', 'toml', 'ini', 'conf', 'env',
  'srt', 'vtt', 'tex',
  // common code / config — treated as plain text
  'js', 'ts', 'tsx', 'jsx', 'mjs', 'cjs',
  'py', 'java', 'kt', 'swift', 'c', 'h', 'cc', 'cpp', 'hpp',
  'cs', 'go', 'rs', 'rb', 'php', 'sh', 'bash', 'zsh',
  'sql', 'css', 'scss',
] as const

export const PDF_EXTENSIONS = ['pdf'] as const

export const IMAGE_EXTENSIONS = [
  'png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'heic', 'heif', 'tif', 'tiff',
] as const

/** Lower-case extension without the dot, or '' if the name has none. */
export function fileExtension(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name.trim())
  return m ? m[1].toLowerCase() : ''
}

/** Strip a document's extension for use as a default title. */
export function titleFromFilename(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, '').trim() || name
}

/** Decide how a file should be handled from its name (and MIME when known). */
export function classifyDoc(name: string, mime?: string): DocKind {
  const ext = fileExtension(name)
  if ((PDF_EXTENSIONS as readonly string[]).includes(ext) || mime === 'application/pdf')
    return 'pdf'
  if ((TEXT_EXTENSIONS as readonly string[]).includes(ext)) return 'text'
  if ((IMAGE_EXTENSIONS as readonly string[]).includes(ext) || mime?.startsWith('image/'))
    return 'image'
  // Unknown extension but a text-ish MIME → still readable as text.
  if (mime?.startsWith('text/') || mime === 'application/json' || mime === 'application/xml')
    return 'text'
  return 'unsupported'
}

/** The `accept` attribute for a web <input type="file"> covering text + PDF. */
export function fileAcceptAttribute(): string {
  const exts = [...TEXT_EXTENSIONS, ...PDF_EXTENSIONS].map((e) => `.${e}`)
  return [...exts, 'text/plain', 'text/markdown', 'text/html', 'application/pdf'].join(',')
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
}

/** Decode the handful of HTML entities that survive tag-stripping. */
function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole
  })
}

/**
 * HTML/XML → readable text. Regex-based (no DOM) so it runs identically in the
 * browser and under Hermes: drop script/style, turn block tags into line breaks,
 * strip the rest, decode entities, collapse runaway whitespace.
 */
export function htmlToText(html: string): string {
  const withoutInvisible = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|head|noscript)\b[\s\S]*?<\/\1>/gi, ' ')
  const withBreaks = withoutInvisible
    .replace(/<\/(p|div|section|article|header|footer|li|tr|h[1-6]|blockquote|pre)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '• ')
  const stripped = withBreaks.replace(/<[^>]+>/g, ' ')
  return decodeEntities(stripped)
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** RTF → plain text: drop groups/control words, keep the visible runs. */
export function rtfToText(rtf: string): string {
  return rtf
    .replace(/\\'[0-9a-f]{2}/gi, ' ') // hex-escaped bytes we can't map safely
    .replace(/\\par[d]?/g, '\n')
    .replace(/\\tab/g, '\t')
    .replace(/\{\\\*[\s\S]*?\}/g, ' ') // ignorable destinations (fonts, etc.)
    .replace(/\\[a-z]+-?\d* ?/gi, ' ') // remaining control words
    .replace(/[{}]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Turn the already-decoded UTF-8 contents of a text-family file into clean text.
 * `name` picks the cleanup (html/xml/rtf); everything else passes through as-is
 * (csv/json/logs read fine unmodified and mangling them loses structure).
 */
export function extractTextFromString(name: string, raw: string): string {
  const ext = fileExtension(name)
  if (ext === 'html' || ext === 'htm' || ext === 'xhtml') return htmlToText(raw)
  if (ext === 'xml') return htmlToText(raw)
  if (ext === 'rtf') return rtfToText(raw)
  return raw.replace(/\r\n/g, '\n').trim()
}
