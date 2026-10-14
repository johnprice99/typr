import { redo, undo } from '@codemirror/commands'
import { commentAt, listComments } from '../editor/comments'
import { openFind } from '../editor/find'
import { linkAt } from '../editor/links'
import { readList } from '../storage'
import { ISSUES, WEBSITE } from '../../../shared/urls'
import { openList, PaletteItem } from '../ui/palette'
import { openAbout } from '../ui/panels'
import { FOCUS, label, set, setFocus, stepText, THEMES } from './appearance'
import { api, app, notify, errorText } from './context'
import { pickImage } from './images'
import { closeFolder, openFolder, quickOpen } from './library'
import { follow, followAtCursor } from './navigation'
import { goToComment, promptComment, resolveAtCursor } from './review'
import {
  canGoBack,
  canGoForward,
  closeDoc,
  current,
  goBack,
  goForward,
  newDoc,
  newFolder,
  open,
  rename,
  saveNow,
  trash
} from './session'

// Every command, by id. Menus send these ids; the palette lists them. Keeping
// one table means the menu bar and the palette can never disagree.

interface Cmd {
  title: string
  keys?: string
  run: (path?: string) => unknown
  /** Shows a tick in the palette when true. */
  on?: () => boolean
  /** Left out of the palette while it can't do anything (e.g. no comments to go to). */
  available?: () => boolean
  hidden?: boolean
}

/** What Show in Finder shows: the document, or where a new one will go. */
const revealTarget = (): string | undefined => current().path ?? current().dir ?? app.folders[0]?.path
const head = (): number => app.editor.view.state.selection.main.head
const hasText = (): boolean => app.editor.view.state.doc.length > 0

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
  'close-folder': { title: 'Close Folder…', available: () => app.folders.length > 0, run: (p) => closeFolder(p) },
  'forget-file': {
    title: 'Remove from Open Files',
    available: () => !!current().path && app.openFiles.includes(current().path!),
    run: async (p) => {
      const path = p ?? current().path
      if (!path || !app.openFiles.includes(path)) return notify('This document isn’t in Open Files')
      await api.forgetFile(path)
      notify('Removed from Open Files (the file is untouched)')
    }
  },
  save: { title: 'Save', keys: '⌘S', run: saveNow },
  'close-doc': { title: 'Close Document', keys: '⌘W', available: () => !!current().path || hasText(), run: closeDoc },
  'quick-open': { title: 'Go to File…', keys: '⌘P', run: quickOpen },
  rename: { title: 'Rename Document…', keys: '⇧⌘R', run: (p) => rename(p) },
  'toggle-markdown': {
    title: 'Show Markdown',
    keys: '⌘E',
    on: () => app.settings.showMarkdown,
    run: () => set('showMarkdown', !app.settings.showMarkdown)
  },
  'toggle-typewriter': {
    title: 'Typewriter Scrolling',
    on: () => app.settings.typewriter,
    run: () => set('typewriter', !app.settings.typewriter)
  },
  'new-folder': { title: 'New Folder…', run: (p) => newFolder(p) },
  trash: { title: 'Move Document to Trash', available: () => !!current().path || hasText(), run: (p) => trash(p) },
  reveal: {
    title: 'Show in Finder',
    available: () => !!revealTarget(),
    run: () => {
      const target = revealTarget()
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
  comments: { title: 'Go to Comment…', available: () => listComments(app.editor.view.state).length > 0, run: goToComment },
  'resolve-comment': {
    title: 'Resolve Comment',
    available: () => !!commentAt(app.editor.view.state, head()),
    run: resolveAtCursor
  },
  bold: { title: 'Bold', keys: '⌘B', run: () => app.editor.format('bold') },
  italic: { title: 'Italic', keys: '⌘I', run: () => app.editor.format('italic') },
  underline: { title: 'Underline', keys: '⌘U', run: () => app.editor.format('underline') },
  strike: { title: 'Strikethrough', keys: '⇧⌘X', run: () => app.editor.format('strike') },
  code: { title: 'Inline Code', keys: '⇧⌘C', run: () => app.editor.format('code') },
  'follow-link': {
    title: 'Follow Link',
    keys: '⌘↩',
    available: () => !!linkAt(app.editor.view.state, head()),
    run: followAtCursor
  },
  /** Right-click › Open Link: follows the link that was clicked. */
  'open-link': { title: 'Open Link', hidden: true, run: (url) => (url ? follow(url) : followAtCursor()) },
  back: { title: 'Go Back', keys: '⌘[', available: canGoBack, run: goBack },
  forward: { title: 'Go Forward', keys: '⌘]', available: canGoForward, run: goForward },

  'toggle-sidebar': {
    title: 'Show Sidebar',
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
  // The Help menu opens these itself (see menu.ts), so a closed window stays closed.
  website: { title: 'Typr Website', run: () => api.openExternal(WEBSITE) },
  'report-problem': { title: 'Report a Problem', run: () => api.openExternal(ISSUES) },
  palette: { title: 'Command Palette', keys: '⇧⌘P', run: showPalette, hidden: true },
  undo: { title: 'Undo', run: () => undo(app.editor.view), hidden: true },
  redo: { title: 'Redo', run: () => redo(app.editor.view), hidden: true }
}

/** The commands you've run from the palette, most recent first: they're listed first next time. */
const USED = 'typr.usedCommands'

function showPalette(): void {
  const used = readList(USED)
  const ids = Object.keys(commands).filter((id) => !commands[id].hidden && (commands[id].available?.() ?? true))
  // Recently used first; the rest keep their usual order (the sort is stable).
  const rank = (id: string): number => (used.includes(id) ? used.indexOf(id) : used.length)
  openList({
    placeholder: 'Type a command…',
    items: ids
      .sort((a, b) => rank(a) - rank(b))
      .map((id): PaletteItem => {
        const c = commands[id]
        return {
          label: c.title,
          // A setting that's on shows its tick and its shortcut.
          hint: [c.on?.() ? '✓' : '', c.keys ?? ''].filter(Boolean).join('  ') || undefined,
          run: () => {
            localStorage.setItem(USED, JSON.stringify([id, ...used.filter((u) => u !== id)].slice(0, 8)))
            return c.run()
          }
        }
      })
  })
}
