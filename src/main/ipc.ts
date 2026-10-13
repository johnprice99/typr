import { app, dialog, ipcMain, Menu, MenuItemConstructorOptions, shell } from 'electron'
import { existsSync, mkdirSync } from 'fs'
import { mkdir, readFile, rename, stat, writeFile } from 'fs/promises'
import { basename, dirname, extname, join } from 'path'
import { IMAGE_EXTENSIONS, isTextPath, TEXT_EXTENSIONS } from '../shared/files'
import { FLUSHED, FlushedArgs, Invoke, InvokeChannel } from '../shared/ipc'
import type { InitialState, LibraryOptions } from '../shared/types'
import { sanitize, scan, uniquePath, watchLibrary } from './library'
import { documentsLibrary, settings, updateSetting } from './settings'
import { renamedCurrent, watchCurrent, watchedFile } from './watcher'
import { testing } from './setup'
import { flushed, getWindow, send, sendToRenderer, takePendingOpens } from './window'

// Everything the renderer can ask of the file system. The renderer is trusted
// code, but as a second line of defence it may only change files inside the
// library, or files it has opened or created this session.

const icloudRoot = (): string => join(app.getPath('home'), 'Library/Mobile Documents/com~apple~CloudDocs')

const inside = (p: string, dir: string): boolean => p === dir || p.startsWith(dir.replace(/\/$/, '') + '/')
const known = new Set<string>()
const inLibrary = (p: string): boolean => inside(p, settings.library)

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

export async function refreshFiles(): Promise<void> {
  sendToRenderer('files', await scan(settings.library))
}

export async function setLibrary(path: string): Promise<void> {
  mkdirSync(path, { recursive: true })
  updateSetting('library', path)
  updateSetting('librarySet', true)
  watchLibrary(settings.library, refreshFiles)
  await refreshFiles()
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
    return { settings, files: await scan(settings.library), pendingOpen, version: app.getVersion() }
  })

  handle('read', async (path: string) => {
    assertText(path)
    const text = await readFile(path, 'utf8')
    known.add(path)
    return text
  })

  handle('write', async (path: string, content: string, expected: string) => {
    assertText(path)
    assertManaged(path)
    // Never quietly bring back a file that was deleted elsewhere.
    if (!existsSync(path)) throw new Error(`ENOENT: ${path} no longer exists`)
    // Never quietly overwrite changes another app made since Typr last saw the file.
    const disk = await readFile(path, 'utf8')
    let copy: string | null = null
    if (disk !== expected && disk !== content) {
      const ext = extname(path)
      copy = uniquePath(dirname(path), `${sanitize(basename(path, ext))} (changed elsewhere)`, ext)
      await writeFile(copy, disk, { encoding: 'utf8', flag: 'wx' })
      known.add(copy)
    }
    await writeFile(path, content, 'utf8')
    return copy
  })

  handle('create', async (dir: string, base: string, content: string) => {
    assertManagedDir(dir)
    await mkdir(dir, { recursive: true })
    const path = uniquePath(dir, sanitize(base), '.md')
    await writeFile(path, content, { encoding: 'utf8', flag: 'wx' })
    known.add(path)
    return path
  })

  handle('rename', async (path: string, base: string) => {
    assertManaged(path)
    const isDir = (await stat(path)).isDirectory()
    const ext = isDir ? '' : extname(path) || '.md'
    const next = uniquePath(dirname(path), sanitize(base), ext, path)
    if (next !== path) await rename(path, next)
    known.add(next)
    renamedCurrent(path, next)
    return next
  })

  handle('mkdir', async (dir: string, name: string) => {
    if (!inLibrary(dir)) throw new Error('Folders can only be made inside the library')
    const path = uniquePath(dir, sanitize(name), '')
    await mkdir(path, { recursive: true })
    return path
  })

  handle('trash', async (path: string) => {
    assertManaged(path)
    if (path === settings.library) throw new Error("The library folder itself can't be trashed")
    const current = watchedFile()
    if (current && inside(current, path)) watchCurrent(null)
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
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: [...IMAGE_EXTENSIONS] }]
    })
    return res.canceled ? null : res.filePaths[0]
  })

  handle('openDialog', async () => {
    const win = getWindow()
    if (!win) return null
    const res = await dialog.showOpenDialog(win, {
      defaultPath: settings.library,
      properties: ['openFile'],
      filters: [{ name: 'Text', extensions: [...TEXT_EXTENSIONS] }]
    })
    return res.canceled ? null : res.filePaths[0]
  })

  handle('libraryOptions', (): LibraryOptions => ({
    documents: documentsLibrary(),
    icloud: existsSync(icloudRoot()) ? join(icloudRoot(), 'Typr') : null
  }))

  handle('setLibrary', (path: string) => setLibrary(path))

  handle('chooseLibrary', async () => {
    const win = getWindow()
    if (!win) return false
    const res = await dialog.showOpenDialog(win, {
      title: 'Choose Library Folder',
      defaultPath: settings.library,
      properties: ['openDirectory', 'createDirectory']
    })
    if (res.canceled) return false
    await setLibrary(res.filePaths[0])
    return true
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
    if (path !== settings.library) {
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
