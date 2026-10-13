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

/** "/Users/me/Documents" → "~/Documents", for display. */
export const tildify = (p: string): string => p.replace(/^\/Users\/[^/]+/, '~')
