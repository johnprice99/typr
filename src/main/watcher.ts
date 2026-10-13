import { existsSync, statSync, unwatchFile, watchFile } from 'fs'
import { readdir, stat } from 'fs/promises'
import { dirname, join } from 'path'
import { isTextPath } from '../shared/files'

// The open document can live outside the library, so it's watched on its own.
// Its inode is remembered so a rename or move in Finder can be followed.

export interface WatchEvents {
  changed: (path: string) => void
  moved: (from: string, to: string) => void
  gone: (path: string) => void
  /** Other places to look for the file after a move (e.g. the whole library). */
  candidates: () => Promise<string[]>
}

let current: string | null = null
let currentIno = 0
let events: WatchEvents | null = null

export const watchedFile = (): string | null => current

export function setWatchEvents(e: WatchEvents): void {
  events = e
}

export function watchCurrent(path: string | null): void {
  if (path === current) return
  if (current) unwatchFile(current)
  current = path
  currentIno = 0
  if (!path) return
  currentIno = statSync(path, { throwIfNoEntry: false })?.ino ?? 0
  watchFile(path, { interval: 700 }, (now, prev) => {
    if (now.nlink === 0 && prev.nlink !== 0) void lost(path)
    else if (now.mtimeMs !== prev.mtimeMs) {
      // Saves (ours are atomic) give the file a new inode; keep following the latest one.
      currentIno = now.ino
      events?.changed(path)
    }
  })
}

/** After Typr writes the open file (atomically, so with a new inode), keep following it. */
export function wroteCurrent(path: string): void {
  if (current === path) currentIno = statSync(path, { throwIfNoEntry: false })?.ino ?? currentIno
}

/**
 * Where the open file went, if it was renamed or moved (found by its inode next
 * to where it was, then in the library). Null if it was deleted.
 */
export async function locate(path: string): Promise<string | null> {
  if (current !== path || !currentIno) return null
  const ino = currentIno
  const dir = dirname(path)
  const siblings = (await readdir(dir).catch(() => [] as string[])).map((f) => join(dir, f))
  const elsewhere = (await events?.candidates()) ?? []
  for (const p of [...siblings, ...elsewhere]) {
    if (isTextPath(p) && (await stat(p).catch(() => null))?.ino === ino) return p
  }
  return null
}

/** Our own rename: keep watching under the new name without reporting a move. */
export function renamedCurrent(from: string, to: string): void {
  if (current !== from) return
  unwatchFile(from)
  current = null
  watchCurrent(to)
}

async function lost(path: string): Promise<void> {
  // Some editors save by deleting and replacing; give that a moment.
  await new Promise((r) => setTimeout(r, 300))
  if (current !== path) return
  if (existsSync(path)) {
    currentIno = statSync(path).ino
    events?.changed(path)
    return
  }
  const found = await locate(path)
  if (current !== path) return
  if (found) {
    watchCurrent(found)
    events?.moved(path, found)
  } else {
    watchCurrent(null)
    events?.gone(path)
  }
}
