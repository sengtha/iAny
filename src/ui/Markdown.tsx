import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { useMemo } from 'react'

marked.setOptions({ gfm: true, breaks: true })

/** Renders assistant output as sanitized Markdown. Model output is
 *  untrusted by definition, so everything passes through DOMPurify. */
export function Markdown({ text }: { text: string }) {
  const html = useMemo(
    () => DOMPurify.sanitize(marked.parse(text, { async: false })),
    [text],
  )
  return <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />
}
