import { TEXT_EXTENSIONS } from '../../shared/files'
import { isInside, normalize } from '../../shared/paths'

// The renderer has no Node `path`, and this is macOS-only, so plain "/" handling is enough.

export { isInside, normalize, tildify } from '../../shared/paths'

export const join = (...parts: string[]): string => parts.filter(Boolean).join('/').replace(/\/+/g, '/')

export const dirname = (p: string): string => p.slice(0, Math.max(0, p.lastIndexOf('/'))) || '/'

export const basename = (p: string): string => p.slice(p.lastIndexOf('/') + 1)

const TEXT_EXT = new RegExp(`\\.(${TEXT_EXTENSIONS.join('|')})$`, 'i')

/** A path or name without its document extension: "a/My Story.md" → "a/My Story". */
export const withoutExtension = (p: string): string => p.replace(TEXT_EXT, '')

/** A document's name: "/lib/My Story.md" → "My Story". */
export const stem = (p: string): string => withoutExtension(basename(p))

const decodeSegment = (s: string): string => {
  try {
    return decodeURIComponent(s)
  } catch {
    return s // a stray "%" in a link must never break rendering
  }
}

/** A link's path as it is on disk: "My%20Map%231.png" → "My Map#1.png". Never throws. */
export const decodePath = (p: string): string => p.split('/').map(decodeSegment).join('/')

/** A file path written safely into a Markdown link (spaces, #, ?, brackets…). */
export const encodePath = (p: string): string =>
  p
    .split('/')
    .map((s) => encodeURIComponent(s).replace(/\(/g, '%28').replace(/\)/g, '%29'))
    .join('/')

/** Local images are served through typr-file:// so they work in dev and in the packaged app. */
export function imageSrc(href: string, baseDir: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return href
  const rel = decodePath(href)
  const abs = normalize(rel.startsWith('/') ? rel : join(baseDir, rel))
  return `typr-file://local${encodePath(abs)}`
}

/** The path from a folder to a file, e.g. "../Pictures/map.png". */
export function relativePath(fromDir: string, to: string): string {
  const a = normalize(fromDir).split('/').filter(Boolean)
  const b = normalize(to).split('/').filter(Boolean)
  let i = 0
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++
  return [...Array(a.length - i).fill('..'), ...b.slice(i)].join('/') || basename(to)
}

/** `p` relative to `dir` ("x/a.md"), or null if it isn't inside it. */
export function relativeTo(p: string, dir: string): string | null {
  if (!isInside(p, dir)) return null
  const a = normalize(p)
  const b = normalize(dir)
  return a === b ? '' : a.slice(b.length + 1)
}
