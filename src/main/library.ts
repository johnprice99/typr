import { existsSync, FSWatcher, mkdirSync, statSync, watch } from 'fs'
import { readdir } from 'fs/promises'
import { join } from 'path'
import { isTextPath } from '../shared/files'

const IGNORE = new Set(['node_modules', '.git', '.obsidian', '.trash'])
/** Deeper folders than this are left out (it also guards against runaway links). */
const MAX_DEPTH = 20

/**
 * Lists the library: library-relative paths with forward slashes, folders
 * ending in "/". Shows folders with writing in them and empty ones you've just
 * made, but not folders that only hold pictures or other files.
 */
export async function scan(root: string, rel = '', depth = 0): Promise<string[]> {
  if (depth > MAX_DEPTH) return []
  let entries
  try {
    entries = await readdir(join(root, rel), { withFileTypes: true })
  } catch {
    return []
  }
  // Folders are read in parallel; the result keeps the folder's own order.
  const parts = await Promise.all(
    entries.map(async (e): Promise<string[]> => {
      if (e.name.startsWith('.') || IGNORE.has(e.name)) return []
      const p = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        const sub = await scan(root, p, depth + 1)
        if (sub.length) return [`${p}/`, ...sub]
        const empty = (await readdir(join(root, p)).catch(() => [] as string[])).every((n) => n.startsWith('.'))
        return empty ? [`${p}/`] : []
      }
      return isTextPath(e.name) ? [p] : []
    })
  )
  return parts.flat()
}

let watcher: FSWatcher | null = null
let timer: NodeJS.Timeout | null = null

/** Calls onChange (debounced) when files are added, removed or renamed in the library. */
export function watchLibrary(root: string, onChange: () => void): void {
  watcher?.close()
  mkdirSync(root, { recursive: true })
  try {
    watcher = watch(root, { recursive: true }, (event) => {
      // Saving a document only changes its contents ("change"); the list only
      // needs refreshing when files appear, disappear or move ("rename").
      if (event !== 'rename') return
      if (timer) clearTimeout(timer)
      timer = setTimeout(onChange, 150)
    })
  } catch {
    watcher = null
  }
}

/** A safe file name: no path separators or characters macOS dislikes. */
export function sanitize(name: string): string {
  const clean = name
    .replace(/[/\\:*?"<>|\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return clean.replace(/^\.+|[\s.]+$/g, '') || 'Untitled'
}

const sameFile = (a: string, b: string): boolean => {
  const sa = statSync(a, { throwIfNoEntry: false })
  const sb = statSync(b, { throwIfNoEntry: false })
  return !!sa && !!sb && sa.ino === sb.ino && sa.dev === sb.dev
}

/**
 * Finds a free "Name.md", "Name 2.md"… in dir. `self` (the file being renamed)
 * never counts as a clash, including a case-only change like "notes" → "Notes",
 * which on a Mac disk is the same file.
 */
export function uniquePath(dir: string, base: string, ext: string, self?: string): string {
  for (let i = 1; ; i++) {
    const p = join(dir, `${base}${i === 1 ? '' : ` ${i}`}${ext}`)
    if (!existsSync(p)) return p
    if (self && (p === self || sameFile(p, self))) return p
  }
}
