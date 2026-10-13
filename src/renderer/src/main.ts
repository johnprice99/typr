import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/400-italic.css'
import '@fontsource/ibm-plex-mono/700.css'
import '@fontsource/ibm-plex-mono/700-italic.css'
import './style.css'
import { commands } from './app/actions'
import { applySettings } from './app/appearance'
import { $, api, app, errorText, notify } from './app/context'
import { insertFiles } from './app/images'
import { chooseLibrary, drawSidebar } from './app/library'
import { follow, linkNames } from './app/navigation'
import { promptComment } from './app/review'
import * as session from './app/session'
import { scheduleStats, updateStats } from './app/status'
import { createEditor } from './editor/editor'
import { imageSrc } from './paths'
import { isPaletteOpen, onPaletteClose, onPaletteError } from './ui/palette'
import { isPanelOpen, onPanelClose } from './ui/panels'

// Startup and wiring. The work lives in app/ (documents, links, commands…),
// editor/ (the CodeMirror editor and its features) and ui/ (palette, panels, sidebar).

app.editor = createEditor($('editor'), {
  onChange: session.scheduleSave,
  onSelection: scheduleStats,
  follow,
  names: linkNames,
  imageUrl: (href) => imageSrc(href, session.docDir()),
  editComment: (c) => promptComment(c),
  insertFiles
})

session.onDocumentChange(() => {
  $('title').textContent = session.title()
  drawSidebar()
  updateStats()
})

$('title').addEventListener('click', () => session.rename())

// Hanging markers are measured in the real font, so re-measure once web fonts arrive.
document.fonts.addEventListener('loadingdone', () => app.editor.refreshLayout())

// Chrome fades away while you type and comes back when you move the mouse.
document.addEventListener('keydown', (e) => {
  document.body.classList.toggle('cmd', e.metaKey)
  if (!e.metaKey && !e.ctrlKey && !isPaletteOpen() && !isPanelOpen()) document.body.classList.add('typing')
})
document.addEventListener('keyup', (e) => document.body.classList.toggle('cmd', e.metaKey))
document.addEventListener('mousemove', () => document.body.classList.remove('typing'))
window.addEventListener('blur', () => document.body.classList.remove('cmd'))

// The end-to-end tests drive the editor directly, and wait on the command count.
const testHook = { view: app.editor.view, commands: 0, ready: false }
if (api.testing) Object.assign(window, { typr: testHook })

/** Runs a command, showing any failure rather than failing silently. */
function run(id: string, path?: string): void {
  if ((id === 'undo' || id === 'redo') && (isPaletteOpen() || isPanelOpen())) return
  Promise.resolve()
    .then(() => commands[id]?.run(path))
    .catch((e) => notify(errorText(e)))
}

async function start(): Promise<void> {
  const init = await api.init()
  app.version = init.version
  app.files = init.files
  applySettings(init.settings)
  session.startEmpty()

  // Listen straight away, before any await, so nothing sent during startup is missed.
  onPaletteClose(() => app.editor.view.focus())
  onPanelClose(() => app.editor.view.focus())
  onPaletteError((e) => notify(errorText(e)))
  api.onFiles((f) => {
    app.files = f
    drawSidebar()
  })
  api.onSettings(applySettings)
  api.onOpen((p) => session.open(p))
  api.onCommand(({ id, path }) => {
    run(id, path)
    testHook.commands++
  })
  api.onFileChanged((p) => session.fileChanged(p))
  api.onFileMoved(session.fileMoved)
  api.onFileGone(session.fileGone)
  api.onFlush(async () => {
    let saved = false
    try {
      saved = await session.leave()
    } finally {
      api.flushed(saved, session.title())
    }
  })

  for (const p of init.pendingOpen) await session.open(p)
  if (!app.settings.librarySet) void chooseLibrary(true)
  testHook.ready = true
}

void start()
