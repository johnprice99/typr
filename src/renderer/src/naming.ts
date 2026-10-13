import { stripComments } from './editor/comments'

// A new document is named after its first line (or a front-matter title).

/** The file name a document's text suggests, e.g. "# The Storm" → "The Storm". */
export function deriveName(text: string): string {
  let body = stripComments(text)
  if (body.startsWith('---\n')) {
    const end = body.indexOf('\n---', 4)
    if (end > 0) {
      const title = body.slice(4, end).match(/^title:\s*["']?(.+?)["']?\s*$/m)
      if (title) return cleanName(title[1])
      body = body.slice(end + 4)
    }
  }
  return cleanName(body.split('\n').find((l) => l.trim()) ?? '')
}

const TRAILING = /[\s.,;:!?…]+$/

/** Strips Markdown and characters that don't belong in a file name; at most ~60 characters. */
export function cleanName(line: string): string {
  const s = line
    .replace(/^\s*(#{1,6}|>|[-*+]|\d+[.)])\s+/, '')
    .replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`=#]/g, '')
    .replace(/[/\\:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(TRAILING, '')
    .trim()
  if (!s) return 'Untitled'
  if (s.length <= 60) return s
  const cut = s.slice(0, 60)
  const space = cut.lastIndexOf(' ')
  return (space > 20 ? cut.slice(0, space) : cut).replace(TRAILING, '')
}
