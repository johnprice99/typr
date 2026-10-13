import { existsSync, statSync, unwatchFile, watchFile } from 'fs'
import { readdir } from 'fs/promises'
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
    else if (now.mtimeMs !== prev.mtimeMs) events?.changed(path)
  })
}

/** Our own rename: keep watching under the new name without reporting a move. */
export function renamedCurrent(from: string, to: string): void {
  if (current !== from) return
  unwatchFile(from)
  current = null
  watchCurrent(to)
}

async function lost(path: string): Promise<void> {
  const ino = currentIno
  // Some editors save by deleting and replacing; give that a moment.
  await new Promise((r) => setTimeout(r, 300))
  if (current !== path) return
  if (existsSync(path)) {
    currentIno = statSync(path).ino
    events?.changed(path)
    return
  }
  let found: string | null = null
  if (ino) {
    const dir = dirname(path)
    const siblings = (await readdir(dir).catch(() => [] as string[])).map((f) => join(dir, f))
    const elsewhere = (await events?.candidates()) ?? []
    found = [...siblings, ...elsewhere].find((p) => isTextPath(p) && statSync(p, { throwIfNoEntry: false })?.ino === ino) ?? null
  }
  if (current !== path) return
  if (found) {
    watchCurrent(found)
    events?.moved(path, found)
  } else {
    watchCurrent(null)
    events?.gone(path)
  }
}
