import { constants, existsSync, FSWatcher, mkdirSync, renameSync, statSync, watch, writeFileSync } from 'fs'
import { access, open, readdir, rename, stat, unlink } from 'fs/promises'
import { basename, dirname, join } from 'path'
import { isTextPath } from '../shared/files'

const IGNORE = new Set(['node_modules', '.git', '.obsidian', '.trash'])
/** Folders deeper than this are left out. */
const MAX_DEPTH = 20
/** At most this many folders are read at once, so huge libraries can't run out of file handles. */
const MAX_OPEN = 32

/**
 * Lists the library: library-relative paths with forward slashes, folders
 * ending in "/". Shows folders with writing in them and empty ones you've just
 * made, but not folders that only hold pictures or other files.
 */
export async function scan(root: string, rel = '', depth = 0): Promise<string[]> {
  if (depth > MAX_DEPTH) return []
  let entries
  try {
    entries = await limited(() => readdir(join(root, rel), { withFileTypes: true }))
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
        const empty = (await limited(() => readdir(join(root, p))).catch(() => [] as string[])).every((n) => n.startsWith('.'))
        return empty ? [`${p}/`] : []
      }
      return isTextPath(e.name) ? [p] : []
    })
  )
  return parts.flat()
}

let open_ = 0
const waiting: (() => void)[] = []

/** Runs `fn` when fewer than MAX_OPEN folder reads are in flight. */
async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (open_ >= MAX_OPEN) await new Promise<void>((r) => waiting.push(r))
  open_++
  try {
    return await fn()
  } finally {
    open_--
    waiting.shift()?.()
  }
}

let watcher: FSWatcher | null = null
let timer: NodeJS.Timeout | null = null

/** Calls onChange (debounced) when files are added, removed or renamed in the library. */
export function watchLibrary(root: string, onChange: () => void): void {
  watcher?.close()
  watcher = null
  try {
    // May fail (e.g. the library is on a drive that isn't plugged in); Typr still opens.
    mkdirSync(root, { recursive: true })
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

const tempName = (path: string): string => join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.typr-tmp`)

/**
 * Writes a file so it's never left half-written: the new text goes into a
 * temporary file next to it, is flushed to disk, then replaces the original in
 * one step. The file's permissions are kept, and a read-only file is refused.
 */
export async function writeAtomic(path: string, content: string): Promise<void> {
  // Replacing the file would sidestep a read-only file's permissions; respect them.
  if (existsSync(path)) await access(path, constants.W_OK)
  const tmp = tempName(path)
  const mode = (await stat(path).catch(() => null))?.mode
  const file = await open(tmp, 'wx', mode === undefined ? 0o644 : mode & 0o777)
  try {
    await file.writeFile(content, 'utf8')
    await file.sync()
  } finally {
    await file.close()
  }
  try {
    await rename(tmp, path)
  } catch (e) {
    await unlink(tmp).catch(() => {})
    throw e
  }
}

/** The same, synchronously (for the settings file). */
export function writeAtomicSync(path: string, content: string): void {
  const tmp = tempName(path)
  writeFileSync(tmp, content, { encoding: 'utf8', flag: 'wx' })
  renameSync(tmp, path)
}
