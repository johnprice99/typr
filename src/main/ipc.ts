import { app, dialog, ipcMain, Menu, MenuItemConstructorOptions, shell } from 'electron'
import { existsSync } from 'fs'
import { mkdir, readFile, rename, stat, writeFile } from 'fs/promises'
import { basename, dirname, extname, resolve } from 'path'
import { IMAGE_EXTENSIONS, isTextPath, TEXT_EXTENSIONS } from '../shared/files'
import { FLUSHED, FlushedArgs, Invoke, InvokeChannel } from '../shared/ipc'
import { isExternalUrl, isInside, rebase } from '../shared/paths'
import { normalizeSettings } from '../shared/settings'
import type { FolderListing, InitialState, Settings, WriteResult } from '../shared/types'
import { sanitize, scan, uniquePath, watchFolders, writeAtomic } from './library'
import { settings, updateSetting } from './settings'
import { locate, renamedCurrent, watchCurrent, watchedFile, wroteCurrent } from './watcher'
import { testing } from './setup'
import { flushed, getWindow, send, sendToRenderer, takePending } from './window'

// Everything the renderer can ask of the file system. Every path is resolved
// first (so "folder/../../x" can't sneak out), and changes are only allowed
// inside the open folders or to files Typr opened or created this session.

/** An absolute path with any "..", "." or doubled slashes resolved. */
const abs = (p: string): string => resolve(p)

const known = new Set<string>()
const inLibrary = (p: string): boolean => settings.folders.some((f) => isInside(p, f))
/** An open folder itself, or a folder containing one: never renamed or trashed from Typr. */
const isFolderRoot = (p: string): boolean => settings.folders.some((f) => isInside(f, p))

/** Files the user opened or that Typr made (e.g. one renamed in Finder) may be saved. */
export function trustPath(path: string): void {
  known.add(abs(path))
}

function assertText(path: string): void {
  if (!isTextPath(path)) throw new Error(`Not a text file: ${path}`)
}
function assertManaged(path: string): void {
  if (!inLibrary(path) && !known.has(path)) throw new Error(`Typr didn't open ${path}`)
}
function assertManagedDir(dir: string): void {
  if (!inLibrary(dir) && ![...known].some((f) => dirname(f) === dir)) throw new Error(`Typr can't create files in ${dir}`)
}

const utf8 = (bytes: Uint8Array): string | null => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

/** Reads a text file; one that isn't UTF-8 is refused, since saving it would corrupt it. */
async function readText(path: string): Promise<string> {
  const text = utf8(await readFile(path))
  if (text === null) throw new Error(`“${basename(path)}” isn’t UTF-8 text, so Typr can’t edit it safely`)
  return text
}

/** The same text, ignoring which line endings it uses. */
const sameText = (a: string, b: string): boolean => a.replace(/\r\n?/g, '\n') === b.replace(/\r\n?/g, '\n')

/** Forgets which files were opened this session (used between tests). */
export function resetSession(): void {
  known.clear()
}

export const listFolders = (): Promise<FolderListing[]> =>
  Promise.all(settings.folders.map(async (path) => ({ path, entries: await scan(path) })))

/** "Open Files" that exist right now (one on an unplugged drive is hidden, not forgotten). */
const listOpenFiles = (): string[] => settings.files.filter((f) => existsSync(f))

/** Sends the window the folders and Open Files as they are now (and watches any folder not yet watched). */
let listing = 0
export async function refreshFiles(): Promise<void> {
  watchFolders(settings.folders, refreshFiles)
  const n = ++listing
  const folders = await listFolders()
  // A slower, older scan mustn't replace a newer one.
  if (n === listing) sendToRenderer('folders', folders, listOpenFiles())
}

function setFolders(next: string[]): Promise<void> {
  updateSetting('folders', next)
  return refreshFiles()
}

// ---------- "Open Files": files opened from outside the open folders ----------

function setFiles(next: string[]): void {
  if (next.length === settings.files.length && next.every((f, i) => f === settings.files[i])) return
  updateSetting('files', next)
  void refreshFiles()
}

/** Remembers a file opened from outside the open folders. */
function keepFile(path: string): void {
  if (isTextPath(path) && !inLibrary(path) && !settings.files.includes(path)) setFiles([...settings.files, path])
}

/** Keeps "Open Files" pointing at files (or inside folders) that were renamed or moved. */
export function movedOpenFile(from: string, to: string): void {
  setFiles([...new Set(settings.files.map((f) => rebase(f, from, to)))])
}

const forgetFiles = (match: (f: string) => boolean): void => setFiles(settings.files.filter((f) => !match(f)))

/** Where file dialogs start: the open document's folder, else the most recently opened folder. */
function startIn(): string | undefined {
  const doc = watchedFile()
  return doc ? dirname(doc) : settings.folders.at(-1)
}

/** Opens a folder in the sidebar. A folder inside one already open is already there. */
async function addFolder(path: string): Promise<string> {
  path = abs(path)
  const containing = settings.folders.find((f) => isInside(path, f))
  if (containing) return containing
  // Opening a folder that contains open ones replaces them; its files leave "Open Files".
  updateSetting(
    'files',
    settings.files.filter((f) => !isInside(f, path))
  )
  await setFolders([...settings.folders.filter((f) => !isInside(f, path)), path])
  return path
}

/** Registers a reply handler; the channel and its arguments are checked against the Api. */
function handle<K extends InvokeChannel>(
  channel: K,
  fn: (...args: Parameters<Invoke[K]>) => Awaited<ReturnType<Invoke[K]>> | ReturnType<Invoke[K]>
): void {
  ipcMain.handle(channel, (_e, ...args) => fn(...(args as Parameters<Invoke[K]>)))
}

export function registerIpc(): void {
  handle('init', async (): Promise<InitialState> => {
    const pending = takePending()
    return { settings, folders: await listFolders(), files: listOpenFiles(), ...pending, version: app.getVersion() }
  })

  handle('read', async (path: string) => {
    path = abs(path)
    assertText(path)
    const text = await readText(path)
    trustPath(path)
    return text
  })

  handle('write', async (path: string, content: string, expected: string): Promise<WriteResult> => {
    path = abs(path)
    assertText(path)
    assertManaged(path)
    if (!existsSync(path)) {
      // Renamed or moved in Finder before the watcher noticed? Follow it. Never
      // quietly bring back a file that was deleted.
      const moved = await locate(path)
      if (!moved) return { gone: true }
      trustPath(moved)
      movedOpenFile(path, moved)
      renamedCurrent(path, moved)
      path = moved
    }
    // Never quietly overwrite changes another app made since Typr last saw the file
    // (including saving it in another text encoding: that's kept exactly as it was).
    const bytes = await readFile(path)
    const disk = utf8(bytes)
    if (disk === content) return { path, copy: null }
    let copy: string | null = null
    if (disk === null || (!sameText(disk, expected) && !sameText(disk, content))) {
      const ext = extname(path)
      copy = uniquePath(dirname(path), `${sanitize(basename(path, ext))} (changed elsewhere)`, ext)
      await writeFile(copy, bytes, { flag: 'wx' })
      trustPath(copy)
    }
    await writeAtomic(path, content)
    wroteCurrent(path)
    return { path, copy }
  })

  handle('create', async (dir: string, base: string, content: string) => {
    dir = abs(dir)
    assertManagedDir(dir)
    await mkdir(dir, { recursive: true })
    const path = uniquePath(dir, sanitize(base), '.md')
    await writeFile(path, content, { encoding: 'utf8', flag: 'wx' })
    trustPath(path)
    return path
  })

  handle('rename', async (path: string, base: string) => {
    path = abs(path)
    assertManaged(path)
    if (isFolderRoot(path)) throw new Error("An open folder can't be renamed from Typr")
    const isDir = (await stat(path)).isDirectory()
    const ext = isDir ? '' : extname(path) || '.md'
    const next = uniquePath(dirname(path), sanitize(base), ext, path)
    if (next !== path) await rename(path, next)
    trustPath(next)
    movedOpenFile(path, next)
    renamedCurrent(path, next)
    return next
  })

  handle('mkdir', async (dir: string, name: string) => {
    dir = abs(dir)
    if (!inLibrary(dir)) throw new Error('Folders can only be made inside an open folder')
    const path = uniquePath(dir, sanitize(name), '')
    await mkdir(path, { recursive: true })
    return path
  })

  handle('trash', async (path: string) => {
    path = abs(path)
    assertManaged(path)
    // Neither an open folder nor any folder containing one.
    if (isFolderRoot(path)) throw new Error("An open folder can't be moved to the Trash from Typr")
    const current = watchedFile()
    if (current && isInside(current, path)) watchCurrent(null)
    await shell.trashItem(path)
    forgetFiles((f) => isInside(f, path))
  })

  handle('reveal', (path: string) => shell.showItemInFolder(path))
  handle('exists', (path: string) => existsSync(path))
  handle('openExternal', (url: string) => {
    if (isExternalUrl(url)) return shell.openExternal(url)
  })

  /** Asks for one file, starting beside the open document. */
  const pickFile = async (filter: Electron.FileFilter, title?: string): Promise<string | null> => {
    const win = getWindow()
    if (!win) return null
    const res = await dialog.showOpenDialog(win, { title, defaultPath: startIn(), properties: ['openFile'], filters: [filter] })
    return res.canceled ? null : (res.filePaths[0] ?? null)
  }
  handle('pickImage', () => pickFile({ name: 'Images', extensions: [...IMAGE_EXTENSIONS] }, 'Insert Image'))
  handle('openDialog', () => pickFile({ name: 'Text', extensions: [...TEXT_EXTENSIONS] }))

  // Folders are only ever opened through the folder chooser, never from a path
  // the window supplies.
  handle('openFolder', async () => {
    const win = getWindow()
    if (!win) return null
    // Start beside the folder opened most recently (its parent), so a sibling is one click away.
    const last = settings.folders.at(-1)
    const res = await dialog.showOpenDialog(win, {
      title: 'Open Folder',
      buttonLabel: 'Open',
      defaultPath: last ? dirname(last) : undefined,
      properties: ['openDirectory', 'createDirectory']
    })
    if (res.canceled || !res.filePaths[0]) return null
    return addFolder(res.filePaths[0])
  })

  handle('closeFolder', (path: string) => setFolders(settings.folders.filter((f) => f !== abs(path))))

  // Only a rearrangement of the folders already open; this can't add one.
  handle('reorderFolders', async (order: string[]) => {
    const next = order.map(abs)
    const same =
      next.length === settings.folders.length &&
      new Set(next).size === next.length &&
      next.every((f) => settings.folders.includes(f))
    if (!same) throw new Error('A new order must contain exactly the open folders')
    await setFolders(next)
  })

  handle('forgetFile', (path: string) => forgetFiles((f) => f === abs(path)))

  handle('setCurrent', (path: string | null, title: string) => {
    watchCurrent(path)
    if (path) keepFile(abs(path))
    const win = getWindow()
    if (!win) return
    win.setTitle(title)
    win.setRepresentedFilename(path ?? '')
  })

  // Tests use throwaway files; keep them out of the Mac's Recent Documents.
  handle('addRecent', (path: string) => {
    if (!testing) app.addRecentDocument(path)
  })

  handle('setSetting', (key, value) => {
    // Where files may be written is only changed through openFolder / closeFolder.
    if (!Object.hasOwn(settings, key) || (['folders', 'files', 'window'] as (keyof Settings)[]).includes(key)) {
      throw new Error(`${key} can't be set directly`)
    }
    if (key === 'fullscreen') getWindow()?.setFullScreen(value === true)
    else updateSetting(key, normalizeSettings({ ...settings, [key]: value })[key] as never)
  })

  handle('itemMenu', (path: string, isDir: boolean) => {
    const item = (label: string, id: string): MenuItemConstructorOptions => ({ label, click: () => send({ id, path }) })
    const sep: MenuItemConstructorOptions = { type: 'separator' }
    const dir = isDir ? path : dirname(path)
    const reveal: MenuItemConstructorOptions = { label: 'Show in Finder', click: () => shell.showItemInFolder(path) }
    const here: MenuItemConstructorOptions[] = [
      { label: 'New Document Here', click: () => send({ id: 'new', path: dir }) },
      { label: 'New Folder Here…', click: () => send({ id: 'new-folder', path: dir }) },
      sep
    ]
    const items: MenuItemConstructorOptions[] = settings.files.includes(path)
      ? // An "Open Files" entry: no "New … Here" (its folder isn't open).
        [reveal, item('Rename…', 'rename'), sep, item('Remove from Open Files', 'forget-file'), item('Move to Trash', 'trash')]
      : settings.folders.includes(path)
        ? [...here, reveal, sep, item('Close Folder', 'close-folder')]
        : [...here, reveal, item('Rename…', 'rename'), sep, item('Move to Trash', 'trash')]
    Menu.buildFromTemplate(items).popup({ window: getWindow() ?? undefined })
  })

  ipcMain.on(FLUSHED, (_e, ...args: FlushedArgs) => flushed(...args))
}
