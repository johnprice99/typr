// Path helpers shared by the main process and the window. Typr is macOS-only,
// so paths are plain "/"-separated strings.

/** Resolves "." and ".." segments and doubled slashes in an absolute path. */
export function normalize(p: string): string {
  const out: string[] = []
  for (const part of p.split('/')) {
    if (part === '..') out.pop()
    else if (part && part !== '.') out.push(part)
  }
  return '/' + out.join('/')
}

/** Whether `p` is `dir` or inside it, after resolving any "..". */
export function isInside(p: string, dir: string): boolean {
  const a = normalize(p)
  const b = normalize(dir)
  return a === b || a.startsWith(b === '/' ? '/' : b + '/')
}

/** `p` after the file or folder `from` moved to `to` (unchanged if it wasn't inside). */
export const rebase = (p: string, from: string, to: string): string =>
  isInside(p, from) ? to + normalize(p).slice(normalize(from).length) : p

/** Links Typr hands to the browser or Mail; anything else (javascript:, file:…) is ignored. */
export const isExternalUrl = (url: string): boolean => /^(https?|mailto):/i.test(url)

/** "/Users/me/Documents" → "~/Documents", for display. */
export const tildify = (p: string): string => p.replace(/^\/Users\/[^/]+/, '~')
