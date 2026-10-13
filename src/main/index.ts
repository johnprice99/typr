import { testing } from './setup'
import { app, nativeTheme, net, protocol } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { isImagePath } from '../shared/files'
import { movedOpenFile, refreshFiles, registerIpc, trustPath } from './ipc'
import { scan } from './library'
import { followAppearanceInDock } from './dock'
import { buildMenu } from './menu'
import { onSettingChange, settings } from './settings'
import { installTestHooks } from './testing'
import { checkDaily } from './updates'
import { setWatchEvents } from './watcher'
import { createWindow, getWindow, isQuitting, openFromOS, send, sendToRenderer, setQuitting } from './window'

// Lets the editor show images from anywhere on disk (and nothing else).
protocol.registerSchemesAsPrivileged([
  { scheme: 'typr-file', privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

onSettingChange((key) => {
  if (key === 'theme') nativeTheme.themeSource = settings.theme
  // The menu shows ticks for these; folders, Open Files and the window position aren't in it.
  if (!(['folders', 'files', 'window'] as (keyof typeof settings)[]).includes(key)) buildMenu(settings, send)
  sendToRenderer('settings', settings)
})

setWatchEvents({
  changed: (path) => sendToRenderer('file-changed', path),
  moved: (from, to) => {
    trustPath(to)
    movedOpenFile(from, to)
    sendToRenderer('file-moved', from, to)
  },
  gone: (path) => sendToRenderer('file-gone', path),
  candidates: async () =>
    (
      await Promise.all(
        settings.folders.map(async (folder) => (await scan(folder)).filter((f) => !f.endsWith('/')).map((f) => join(folder, f)))
      )
    ).flat()
})

registerIpc()
if (testing) installTestHooks()

app.on('open-file', (e, path) => {
  e.preventDefault()
  if (app.isReady()) openFromOS(path)
  else app.whenReady().then(() => openFromOS(path))
})

app.whenReady().then(() => {
  protocol.handle('typr-file', (req) => {
    const path = decodeURIComponent(new URL(req.url).pathname)
    if (!isImagePath(path)) return new Response(null, { status: 403 })
    if (!existsSync(path)) return new Response(null, { status: 404 })
    return net.fetch(pathToFileURL(path).toString())
  })
  nativeTheme.themeSource = settings.theme
  if (testing) app.dock?.hide()
  else followAppearanceInDock()
  buildMenu(settings, send)
  app.on('activate', () => {
    if (!getWindow()) createWindow()
  })
  // The window first, so a missing folder can never stop Typr opening.
  if (!getWindow()) createWindow()
  void refreshFiles()
  if (!testing) checkDaily()
})

app.on('before-quit', () => setQuitting(true))

// macOS convention: closing the window keeps the app running; ⌘Q quits.
app.on('window-all-closed', () => {
  if (isQuitting()) app.quit()
})
