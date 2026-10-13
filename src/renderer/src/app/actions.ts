import { redo, undo } from '@codemirror/commands'
import { openFind } from '../editor/find'
import { openList, PaletteItem } from '../ui/palette'
import { openAbout } from '../ui/panels'
import { FOCUS, label, set, setFocus, stepText, THEMES } from './appearance'
import { api, app, notify, errorText } from './context'
import { pickImage } from './images'
import { closeFolder, openFolder, quickOpen } from './library'
import { followAtCursor } from './navigation'
import { goToComment, promptComment, resolveAtCursor } from './review'
import { closeDoc, current, goBack, goForward, newDoc, newFolder, open, rename, saveNow, trash } from './session'

// Every command, by id. Menus send these ids; the palette lists them. Keeping
// one table means the menu bar and the palette can never disagree.

interface Cmd {
  title: string
  keys?: string
  run: (path?: string) => unknown
  /** Shows a tick in the palette when true. */
  on?: () => boolean
  hidden?: boolean
}

const choices = <T extends string>(
  prefix: string,
  title: string,
  options: { id: T; name: string }[],
  isOn: (id: T) => boolean,
  pick: (id: T) => void
) =>
  Object.fromEntries(
    options.map(({ id, name }): [string, Cmd] => [
      `${prefix}-${id}`,
      { title: `${title}: ${name}`, on: () => isOn(id), run: () => pick(id) }
    ])
  )

export const commands: Record<string, Cmd> = {
  new: { title: 'New Document', keys: '⌘N', run: (p) => newDoc(p) },
  open: {
    title: 'Open File…',
    keys: '⌘O',
    run: async () => {
      const p = await api.openDialog()
      if (p) await open(p)
    }
  },
  'open-folder': { title: 'Open Folder…', keys: '⇧⌘O', run: openFolder },
  'close-folder': { title: 'Close Folder…', run: (p) => closeFolder(p) },
  'forget-file': {
    title: 'Remove from Open Files',
    run: async (p) => {
      const path = p ?? current().path
      if (!path || !app.openFiles.includes(path)) return notify('This document isn’t in Open Files')
      await api.forgetFile(path)
      notify('Removed from Open Files (the file is untouched)')
    }
  },
  save: { title: 'Save', keys: '⌘S', run: saveNow },
  'close-doc': { title: 'Close Document', keys: '⌘W', run: closeDoc },
  'quick-open': { title: 'Go to File…', keys: '⌘P', run: quickOpen },
  rename: { title: 'Rename Document…', keys: '⇧⌘R', run: (p) => rename(p) },
  'toggle-markdown': {
    title: 'Show Markdown',
    keys: '⌘E',
    on: () => app.settings.showMarkdown,
    run: () => set('showMarkdown', !app.settings.showMarkdown)
  },
  'new-folder': { title: 'New Folder…', run: (p) => newFolder(p) },
  trash: { title: 'Move Document to Trash', run: (p) => trash(p) },
  reveal: {
    title: 'Show in Finder',
    run: () => {
      const doc = current()
      const target = doc.path ?? doc.dir ?? app.folders[0]?.path
      if (target) return api.reveal(target)
      notify('This document isn’t saved anywhere yet')
    }
  },

  find: { title: 'Find…', keys: '⌘F', run: () => openFind(app.editor.view, false) },
  replace: { title: 'Find and Replace…', keys: '⇧⌘F', run: () => openFind(app.editor.view, true) },
  link: { title: 'Insert Link', keys: '⌘K', run: () => app.editor.link() },
  image: { title: 'Insert Image…', run: () => pickImage().catch((e) => notify(`Couldn't add image: ${errorText(e)}`)) },
  table: { title: 'Insert Table', run: () => app.editor.insertTable() },
  comment: { title: 'Add Comment', keys: '⇧⌘M', run: () => promptComment() },
  comments: { title: 'Go to Comment…', run: goToComment },
  'resolve-comment': { title: 'Resolve Comment', run: resolveAtCursor },
  bold: { title: 'Bold', keys: '⌘B', run: () => app.editor.format('bold') },
  italic: { title: 'Italic', keys: '⌘I', run: () => app.editor.format('italic') },
  underline: { title: 'Underline', keys: '⌘U', run: () => app.editor.format('underline') },
  strike: { title: 'Strikethrough', keys: '⇧⌘X', run: () => app.editor.format('strike') },
  code: { title: 'Inline Code', keys: '⇧⌘C', run: () => app.editor.format('code') },
  'follow-link': { title: 'Follow Link', keys: '⌘↩', run: followAtCursor },
  back: { title: 'Go Back', keys: '⌘[', run: goBack },
  forward: { title: 'Go Forward', keys: '⌘]', run: goForward },

  'toggle-sidebar': {
    title: 'Show Library',
    keys: '⌘\\',
    on: () => app.settings.sidebar,
    run: () => set('sidebar', !app.settings.sidebar)
  },
  'focus-cycle': {
    title: 'Next Focus Mode',
    keys: '⌘D',
    hidden: true,
    run: () => setFocus(FOCUS[(FOCUS.indexOf(app.settings.focus) + 1) % FOCUS.length], true)
  },
  ...choices(
    'focus',
    'Focus',
    FOCUS.map((id) => ({ id, name: label(id) })),
    (id) => app.settings.focus === id,
    (id) => setFocus(id)
  ),
  'text-bigger': { title: 'Bigger Text', keys: '⌘+', run: () => stepText(1) },
  'text-smaller': { title: 'Smaller Text', keys: '⌘−', run: () => stepText(-1) },
  'text-reset': { title: 'Actual Size', keys: '⌘0', run: () => stepText(0) },
  ...choices(
    'theme',
    'Appearance',
    THEMES.map((id) => ({ id, name: label(id) })),
    (id) => app.settings.theme === id,
    (id) => set('theme', id)
  ),
  'toggle-fullscreen': {
    title: 'Full Screen',
    keys: '⌃⌘F',
    on: () => app.settings.fullscreen,
    run: () => set('fullscreen', !app.settings.fullscreen)
  },

  about: { title: 'About Typr', run: () => openAbout(app.version) },
  'check-updates': { title: 'Check for Updates…', run: () => api.checkForUpdates() },
  palette: { title: 'Command Palette', keys: '⇧⌘P', run: showPalette, hidden: true },
  undo: { title: 'Undo', run: () => undo(app.editor.view), hidden: true },
  redo: { title: 'Redo', run: () => redo(app.editor.view), hidden: true }
}

function showPalette(): void {
  openList({
    placeholder: 'Type a command…',
    items: Object.values(commands)
      .filter((c) => !c.hidden)
      .map((c): PaletteItem => ({ label: c.title, hint: c.on?.() ? '✓' : c.keys, run: () => c.run() }))
  })
}
