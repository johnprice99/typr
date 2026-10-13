import { BrowserWindow, dialog, Menu, MenuItemConstructorOptions, nativeTheme, screen, shell } from 'electron'
import { join } from 'path'
import { testing } from './setup'
import { saveSettings, settings, updateSetting } from './settings'
import { watchCurrent } from './watcher'
import type { Events, FlushedArgs } from '../shared/ipc'
import type { Command, Settings } from '../shared/types'

// Typr has a single window. Commands sent while it's closed bring back a fresh one.

let win: BrowserWindow | null = null
/** True once the renderer has asked for its initial state; before that, opens are queued. */
let rendererReady = false
let flushResolve: ((...args: FlushedArgs) => void) | null = null
const pendingOpens: string[] = []
let quitting = false

/** Set when the app is quitting (⌘Q), cleared if the user decides not to. */
export const setQuitting = (on: boolean): void => {
  quitting = on
}
export const isQuitting = (): boolean => quitting

export const getWindow = (): BrowserWindow | null => win

export function send(cmd: Command): void {
  if (!win) return createWindow()
  sendToRenderer('command', cmd)
}

export function sendToRenderer<K extends keyof Events>(channel: K, ...args: Events[K]): void {
  win?.webContents.send(channel, ...args)
}

/** Files the OS asked us to open (Finder, Dock) before the renderer was ready. */
export function openFromOS(path: string): void {
  if (win && rendererReady) sendToRenderer('open', path)
  else pendingOpens.push(path)
  if (!win) createWindow()
}

export function takePendingOpens(): string[] {
  rendererReady = true
  return pendingOpens.splice(0)
}

export function flushed(...args: FlushedArgs): void {
  flushResolve?.(...args)
}

/** The saved window position, if it's still on a connected screen. */
function savedBounds(): Settings['window']['bounds'] {
  const b = settings.window.bounds
  if (!b) return undefined
  const visible = screen
    .getAllDisplays()
    .some(({ workArea: a }) => b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y)
  return visible ? b : undefined
}

export function createWindow(): void {
  if (win) return
  rendererReady = false
  const w = new BrowserWindow({
    width: 1100,
    height: 780,
    ...savedBounds(),
    minWidth: 420,
    minHeight: 300,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1a1a1c' : '#f7f7f5',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      spellcheck: true,
      additionalArguments: testing ? ['--typr-test'] : []
    }
  })
  win = w

  let closing = false
  w.once('ready-to-show', () => {
    if (testing) {
      // Tests run invisibly and never take focus away from whatever you're doing.
      w.setOpacity(0)
      w.showInactive()
      return
    }
    if (settings.window.maximized) w.maximize()
    w.show()
  })
  w.on('enter-full-screen', () => updateSetting('fullscreen', true))
  w.on('leave-full-screen', () => {
    if (!closing) updateSetting('fullscreen', false)
  })

  // Let the renderer save before the window goes away. If the save fails,
  // ask before throwing the changes away; "Don't Quit" cancels the quit.
  w.on('close', (e) => {
    if (closing) return
    e.preventDefault()
    closing = true
    const maximized = w.isFullScreen() ? settings.window.maximized : w.isMaximized()
    settings.window = { maximized, bounds: w.getNormalBounds() }
    saveSettings()
    let done = false
    const finish = (): void => {
      if (done) return
      done = true
      flushResolve = null
      watchCurrent(null)
      w.destroy()
    }
    // If the window doesn't answer at all (e.g. it has crashed), don't hang.
    const noAnswer = setTimeout(finish, 4000)
    flushResolve = (saved, title) => {
      clearTimeout(noAnswer)
      flushResolve = null
      if (saved) return finish()
      void askToDiscard(w, title).then((discard) => {
        if (discard) return finish()
        closing = false
        quitting = false
      })
    }
    sendToRenderer('flush')
  })
  w.on('closed', () => {
    // (window-all-closed then quits the app if ⌘Q started this.)
    if (win === w) win = null
    rendererReady = false
  })

  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  w.webContents.on('will-navigate', (e) => e.preventDefault())

  w.webContents.on('context-menu', (_e, params) => {
    const items: MenuItemConstructorOptions[] = []
    for (const s of params.dictionarySuggestions) items.push({ label: s, click: () => w.webContents.replaceMisspelling(s) })
    if (params.misspelledWord) {
      items.push({
        label: 'Learn Spelling',
        click: () => w.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
      })
    }
    if (items.length) items.push({ type: 'separator' })
    items.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' })
    Menu.buildFromTemplate(items).popup({ window: w })
  })

  if (process.env['ELECTRON_RENDERER_URL']) w.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else w.loadFile(join(__dirname, '../renderer/index.html'))
}

async function askToDiscard(w: BrowserWindow, title: string): Promise<boolean> {
  const { response } = await dialog.showMessageBox(w, {
    type: 'warning',
    message: `“${title}” couldn't be saved`,
    detail: `If you ${quitting ? 'quit' : 'close the window'} now, your latest changes will be lost.`,
    buttons: [quitting ? "Don't Quit" : "Don't Close", quitting ? 'Quit Anyway' : 'Close Anyway'],
    defaultId: 0,
    cancelId: 0
  })
  return response === 1
}
