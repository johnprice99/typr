import { app, dialog, ipcMain, Menu, MenuItemConstructorOptions, shell } from 'electron'
import { existsSync } from 'fs'
import { mkdir, readFile, rename, stat, writeFile } from 'fs/promises'
import { basename, dirname, extname, resolve } from 'path'
import { IMAGE_EXTENSIONS, isTextPath, TEXT_EXTENSIONS } from '../shared/files'
import { FLUSHED, FlushedArgs, Invoke, InvokeChannel } from '../shared/ipc'
import { isInside } from '../shared/paths'
import type { FolderListing, InitialState, Settings, WriteResult } from '../shared/types'
import { sanitize, scan, uniquePath, watchFolders, writeAtomic } from './library'
import { settings, updateSetting } from './settings'
import { locate, renamedCurrent, watchCurrent, watchedFile, wroteCurrent } from './watcher'
import { testing } from './setup'
import { flushed, getWindow, send, sendToRenderer, takePendingOpens } from './window'

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

/** Forgets which files were opened this session (used between tests). */
export function resetSession(): void {
  known.clear()
}

export const listFolders = (): Promise<FolderListing[]> =>
  Promise.all(settings.folders.map(async (path) => ({ path, entries: await scan(path) })))

export async function refreshFiles(): Promise<void> {
  sendToRenderer('folders', await listFolders())
}

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
  // Opening a folder that contains open ones replaces them.
  updateSetting('folders', [...settings.folders.filter((f) => !isInside(f, path)), path])
  watchFolders(settings.folders, refreshFiles)
  await refreshFiles()
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
    const pendingOpen = takePendingOpens()
    return { settings, folders: await listFolders(), pendingOpen, version: app.getVersion() }
  })

  handle('read', async (path: string) => {
    path = abs(path)
    assertText(path)
    const text = await readFile(path, 'utf8')
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
      if (!moved) throw new Error(`ENOENT: ${path} no longer exists`)
      trustPath(moved)
      path = moved
    }
    // Never quietly overwrite changes another app made since Typr last saw the file.
    const disk = await readFile(path, 'utf8')
    let copy: string | null = null
    if (disk !== expected && disk !== content) {
      const ext = extname(path)
      copy = uniquePath(dirname(path), `${sanitize(basename(path, ext))} (changed elsewhere)`, ext)
      await writeFile(copy, disk, { encoding: 'utf8', flag: 'wx' })
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
  })

  handle('reveal', (path: string) => shell.showItemInFolder(path))
  handle('exists', (path: string) => existsSync(path))
  handle('openExternal', (url: string) => {
    if (/^(https?|mailto):/i.test(url)) return shell.openExternal(url)
  })

  handle('pickImage', async () => {
    const win = getWindow()
    if (!win) return null
    const res = await dialog.showOpenDialog(win, {
      title: 'Insert Image',
      defaultPath: startIn(),
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: [...IMAGE_EXTENSIONS] }]
    })
    return res.canceled ? null : res.filePaths[0]
  })

  handle('openDialog', async () => {
    const win = getWindow()
    if (!win) return null
    const res = await dialog.showOpenDialog(win, {
      defaultPath: startIn(),
      properties: ['openFile'],
      filters: [{ name: 'Text', extensions: [...TEXT_EXTENSIONS] }]
    })
    return res.canceled ? null : res.filePaths[0]
  })

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

  handle('closeFolder', async (path: string) => {
    path = abs(path)
    updateSetting(
      'folders',
      settings.folders.filter((f) => f !== path)
    )
    watchFolders(settings.folders, refreshFiles)
    await refreshFiles()
  })

  handle('setCurrent', (path: string | null, title: string) => {
    watchCurrent(path)
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
    if ((['folders', 'window'] as (keyof Settings)[]).includes(key)) throw new Error(`${key} can't be set directly`)
    if (key === 'fullscreen') getWindow()?.setFullScreen(Boolean(value))
    else updateSetting(key, value as never)
  })

  handle('itemMenu', (path: string, isDir: boolean) => {
    const dir = isDir ? path : dirname(path)
    const items: MenuItemConstructorOptions[] = [
      { label: 'New Document Here', click: () => send({ id: 'new', path: dir }) },
      { label: 'New Folder Here…', click: () => send({ id: 'new-folder', path: dir }) },
      { type: 'separator' },
      { label: 'Show in Finder', click: () => shell.showItemInFolder(path) }
    ]
    if (settings.folders.includes(path)) {
      items.push({ type: 'separator' }, { label: 'Close Folder', click: () => send({ id: 'close-folder', path }) })
    } else {
      items.push(
        { label: 'Rename…', click: () => send({ id: 'rename', path }) },
        { type: 'separator' },
        { label: 'Move to Trash', click: () => send({ id: 'trash', path }) }
      )
    }
    Menu.buildFromTemplate(items).popup({ window: getWindow() ?? undefined })
  })

  ipcMain.on(FLUSHED, (_e, ...args: FlushedArgs) => flushed(...args))
}
