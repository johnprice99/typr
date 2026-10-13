import { randomUUID } from 'crypto'
import { constants, existsSync, FSWatcher, renameSync, rmSync, statSync, watch, writeFileSync } from 'fs'
import { access, open, readdir, realpath, rename, stat, unlink } from 'fs/promises'
import { basename, dirname, join } from 'path'
import { isDocumentPath } from '../shared/files'

/** Never listed (names starting with "." are skipped too). */
const IGNORE = new Set(['node_modules'])
/** Folders deeper than this are left out. */
const MAX_DEPTH = 20
/** At most this many folders are read at once, so huge libraries can't run out of file handles. */
const MAX_OPEN = 32

/**
 * Lists a folder: paths relative to it with forward slashes, subfolders ending
 * in "/". Only Markdown documents are listed. Subfolders show if they have some
 * inside, or are empty (e.g. one you've just made), but not if they only hold
 * pictures or other files.
 */
export async function scan(root: string): Promise<string[]> {
  return (await scanDir(root, '', 0)).listed
}

async function scanDir(root: string, rel: string, depth: number): Promise<{ listed: string[]; empty: boolean }> {
  if (depth > MAX_DEPTH) return { listed: [], empty: false }
  let entries
  try {
    entries = await limited(() => readdir(join(root, rel), { withFileTypes: true }))
  } catch {
    return { listed: [], empty: false }
  }
  const visible = entries.filter((e) => !e.name.startsWith('.') && !IGNORE.has(e.name))
  // Folders are read in parallel; the result keeps the folder's own order.
  const parts = await Promise.all(
    visible.map(async (e): Promise<string[]> => {
      const p = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        const sub = await scanDir(root, p, depth + 1)
        return sub.listed.length || sub.empty ? [`${p}/`, ...sub.listed] : []
      }
      return isDocumentPath(e.name) ? [p] : []
    })
  )
  return { listed: parts.flat(), empty: visible.length === 0 }
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

const watchers = new Map<string, FSWatcher>()
let timer: NodeJS.Timeout | undefined

/** Files Typr itself just saved (when), so their own save doesn't rescan the folders. */
const ownWrites = new Map<string, number>()
// (A path that has gone, e.g. renamed or trashed since, always counts as a change.)
const isOwnWrite = (path: string): boolean => Date.now() - (ownWrites.get(path) ?? 0) < 2000 && existsSync(path)
/** When watching a folder last failed: it's tried again after a while, not straight away. */
const failed = new Map<string, number>()

/**
 * Watches each open folder; calls onChange (debounced) when files are added,
 * removed or renamed. Folders that couldn't be watched (e.g. on a drive that
 * wasn't plugged in) are tried again each time this is called.
 */
export function watchFolders(folders: string[], onChange: () => void): void {
  const kick = (): void => {
    clearTimeout(timer)
    timer = setTimeout(onChange, 150)
  }
  for (const [path, w] of watchers) {
    if (!folders.includes(path)) {
      w.close()
      watchers.delete(path)
    }
  }
  for (const path of folders) {
    if (watchers.has(path) || Date.now() - (failed.get(path) ?? 0) < 30_000) continue
    try {
      const w = watch(path, { recursive: true }, (event, name) => {
        // The list only changes when files appear, disappear or move ("rename"),
        // and not when Typr saves a document (a temporary file renamed into place).
        if (event !== 'rename') return
        if (name && (name.endsWith(TEMP_SUFFIX) || isOwnWrite(join(path, name)))) return
        kick()
      })
      // E.g. the folder was deleted or its drive unplugged: stop watching it, quietly.
      w.on('error', () => {
        w.close()
        if (watchers.get(path) === w) watchers.delete(path)
        failed.set(path, Date.now())
        kick()
      })
      watchers.set(path, w)
    } catch {
      // The folder may be missing (e.g. on a drive that isn't plugged in); it just shows as empty.
      failed.set(path, Date.now())
    }
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

const TEMP_SUFFIX = '.typr-tmp'
const tempName = (path: string): string => join(dirname(path), `.${basename(path)}.${randomUUID()}${TEMP_SUFFIX}`)

/**
 * Writes a file so it's never left half-written: the new text goes into a
 * temporary file next to it, is flushed to disk, then replaces the original in
 * one step. The file's permissions are kept, and a read-only file is refused.
 * A symlink is followed, so the file it points to is the one that changes.
 * (Extended attributes such as Finder tags aren't kept.)
 */
export async function writeAtomic(path: string, content: string): Promise<void> {
  ownWrites.set(path, Date.now())
  const target = await realpath(path).catch(() => path)
  ownWrites.set(target, Date.now())
  // Replacing the file would sidestep a read-only file's permissions; respect them.
  if (existsSync(target)) await access(target, constants.W_OK)
  const mode = ((await stat(target).catch(() => null))?.mode ?? 0o644) & 0o7777
  const tmp = tempName(target)
  try {
    const file = await open(tmp, 'wx', mode)
    try {
      await file.chmod(mode) // open's mode is narrowed by the umask
      await file.writeFile(content, 'utf8')
      await file.sync()
    } finally {
      await file.close()
    }
    await rename(tmp, target)
  } catch (e) {
    await unlink(tmp).catch(() => {})
    throw e
  }
}

/** The same, synchronously (for the settings file). */
export function writeAtomicSync(path: string, content: string): void {
  const tmp = tempName(path)
  try {
    writeFileSync(tmp, content, { encoding: 'utf8', flag: 'wx', flush: true })
    renameSync(tmp, path)
  } catch (e) {
    rmSync(tmp, { force: true })
    throw e
  }
}
