import './style.css'
import { commands } from './app/actions'
import { applySettings } from './app/appearance'
import { $, api, app, errorText, notify } from './app/context'
import { insertFiles } from './app/images'
import { chooseWhere, drawSidebar } from './app/library'
import { follow } from './app/navigation'
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
  imageUrl: (href) => imageSrc(href, session.docDir() ?? '/'),
  editComment: (c) => promptComment(c),
  insertFiles
})

session.setWhereToSave(chooseWhere)

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
  app.folders = init.folders
  applySettings(init.settings)
  session.startEmpty()

  // Listen straight away, before any await, so nothing sent during startup is missed.
  onPaletteClose(() => app.editor.view.focus())
  onPanelClose(() => app.editor.view.focus())
  onPaletteError((e) => notify(errorText(e)))
  api.onFolders((f) => {
    app.folders = f
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
    // A new document with nowhere to go can't be saved without asking, and
    // quitting shouldn't open a picker: say so, and let the main process ask
    // "Don't Quit / Quit Anyway" (Don't Quit, then ⌘S, saves it).
    if (session.needsAPlace()) return api.flushed(false, session.title())
    let saved = false
    try {
      saved = await session.leave()
    } finally {
      api.flushed(saved, session.title())
    }
  })

  for (const p of init.pendingOpen) await session.open(p)
  testHook.ready = true
}

void start()
