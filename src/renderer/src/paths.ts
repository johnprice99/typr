// The renderer has no Node `path`, and this is macOS-only, so plain "/" handling is enough.

export const join = (...parts: string[]): string => parts.filter(Boolean).join('/').replace(/\/+/g, '/')

export const dirname = (p: string): string => p.slice(0, Math.max(0, p.lastIndexOf('/'))) || '/'

export const basename = (p: string): string => p.slice(p.lastIndexOf('/') + 1)

export const stem = (p: string): string => basename(p).replace(/\.(md|markdown|txt)$/i, '')

/** Resolves "." and ".." segments in an absolute path. */
export const normalize = (p: string): string => {
  const out: string[] = []
  for (const part of p.split('/')) {
    if (part === '..') out.pop()
    else if (part && part !== '.') out.push(part)
  }
  return '/' + out.join('/')
}

/** decodeURI that never throws (a stray "%" in a link would otherwise break rendering). */
export function safeDecode(s: string): string {
  try {
    return decodeURI(s)
  } catch {
    return s
  }
}

/** Local images are served through typr-file:// so they work in dev and in the packaged app. */
export function imageSrc(href: string, baseDir: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return href
  const rel = safeDecode(href)
  const abs = normalize(rel.startsWith('/') ? rel : join(baseDir, rel))
  return `typr-file://local${encodeURI(abs)}`
}

/** The path from a folder to a file, e.g. "../Pictures/map.png". */
export function relativePath(fromDir: string, to: string): string {
  const a = normalize(fromDir).split('/').filter(Boolean)
  const b = normalize(to).split('/').filter(Boolean)
  let i = 0
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++
  return [...Array(a.length - i).fill('..'), ...b.slice(i)].join('/') || basename(to)
}

export const isInside = (p: string, dir: string): boolean => p === dir || p.startsWith(dir.replace(/\/$/, '') + '/')

export const relativeTo = (p: string, dir: string): string | null =>
  isInside(p, dir) ? p.slice(dir.replace(/\/$/, '').length + 1) : null
