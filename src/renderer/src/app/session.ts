import { deriveName } from '../naming'
import { basename, dirname, isInside, join, stem } from '../paths'
import { openPrompt } from '../ui/palette'
import { api, app, errorText, notify } from './context'

// The open document: creating, opening, saving, naming, history and the file
// commands (rename, new folder, trash), plus reacting to changes made elsewhere.

export interface Doc {
  /** null until there's something worth saving. */
  path: string | null
  /** Where the file will be created; null until you choose (when nothing was open to put it next to). */
  dir: string | null
  /** A name chosen up front (e.g. from a link); otherwise the first line names it. */
  name?: string
  /** Last content written to disk. */
  saved: string
  /** A new document is named after its first line until you leave it; then the name settles. */
  autoName: boolean
  /** Created this session, so safe to clean up if left empty. */
  created: boolean
  /** The file's line endings, kept when saving (the editor always uses "\n"). */
  eol: '\n' | '\r\n'
}

let doc: Doc
const back: string[] = []
const forward: string[] = []
const listeners: (() => void)[] = []

export const current = (): Doc => doc

/** Adds a listener for when the current document or its name changes (title bar, sidebar). */
export function onDocumentChange(cb: () => void): void {
  listeners.push(cb)
}

const untitled = (dir: string | null, name?: string): Doc => ({
  path: null,
  dir,
  name,
  saved: '',
  autoName: !name,
  created: false,
  eol: '\n'
})

// The editor works with "\n" line breaks; files keep whatever they had (e.g. Windows "\r\n").
const fromDisk = (raw: string): string => raw.replace(/\r\n?/g, '\n')
const eolOf = (raw: string): Doc['eol'] => (raw.includes('\r\n') ? '\r\n' : '\n')
const toDisk = (text: string, eol: Doc['eol']): string => (eol === '\n' ? text : text.replace(/\n/g, eol))

export const title = (): string => (doc.path ? stem(doc.path) : (doc.name ?? 'Untitled'))

// ---------- saving ----------

let saveTimer = 0
let chain: Promise<void> = Promise.resolve()

export function scheduleSave(): void {
  clearTimeout(saveTimer)
  saveTimer = window.setTimeout(save, 400)
}

/** Asks which folder a new document should go in (set by main.ts); resolves null if cancelled. */
let whereToSave: () => Promise<string | null> = async () => null
export function setWhereToSave(ask: () => Promise<string | null>): void {
  whereToSave = ask
}

/**
 * Where an unsaved document will go: its own folder, or (if it has none) the
 * only open folder when exactly one is open. Worked out at save time, so opening
 * a folder after you start typing just works.
 */
const placeOf = (d: Doc): string | null => d.dir ?? (app.folders.length === 1 ? app.folders[0].path : null)

/** A new document with words in it but nowhere to go yet. */
export const needsAPlace = (d: Doc = doc): boolean => !d.path && !placeOf(d) && app.editor.getDoc().trim() !== ''

/** ⌘S: everything saves itself, but a new document with nowhere to go asks where first. */
export async function saveNow(): Promise<void> {
  if (needsAPlace()) {
    const dir = await whereToSave()
    if (!dir) return
    doc.dir = dir
  }
  if (await save()) notify(`Saved “${title()}”`)
}

/**
 * Saves now: the document and its text as they are at this moment, even if you
 * switch documents before the write happens. Resolves false if it failed (the
 * error has been shown).
 */
export function save(): Promise<boolean> {
  clearTimeout(saveTimer)
  const d = doc
  const text = app.editor.getDoc()
  const run = chain
    .then(() => writeNow(d, text))
    .then(
      () => true,
      (e) => {
        notify(`Couldn't save: ${errorText(e)}`)
        return false
      }
    )
  chain = run.then(() => undefined)
  return run
}

async function writeNow(d: Doc, text: string): Promise<void> {
  if (!d.path) {
    // Nothing to save yet, or nowhere to put it (⌘S or leaving will ask).
    const dir = placeOf(d)
    if (!text.trim() || !dir) return
    d.dir = dir
    d.path = await api.create(dir, d.name ?? deriveName(text), toDisk(text, d.eol))
    d.created = true
    d.saved = text
    if (d === doc) announce()
    return
  }
  if (d.autoName) {
    const old = d.path
    const name = deriveName(text)
    if (name !== stem(old)) {
      d.path = await api.rename(old, name)
      if (d.path !== old) {
        retarget(old, d.path)
        if (d === doc) announce()
      }
    }
  }
  if (text === d.saved) return
  let result
  try {
    result = await api.write(d.path, toDisk(text, d.eol), toDisk(d.saved, d.eol))
  } catch (e) {
    if (!errorText(e).includes('ENOENT')) throw e
    // The file is gone (deleted, not moved: a move is followed by the main
    // process). Save these words as a new file right now, before anything else.
    const old = d.path
    d.path = await api.create(dirname(old), stem(old), toDisk(text, d.eol))
    d.saved = text
    d.created = true
    forget(old)
    if (d === doc) announce()
    notify(`“${stem(old)}” was deleted. Your latest changes are saved in “${stem(d.path)}”`)
    return
  }
  if (result.path !== d.path) {
    // Renamed or moved in Finder before the watcher noticed: Typr wrote to the new place.
    retarget(d.path, result.path)
    d.path = result.path
    d.autoName = false
    if (d === doc) announce()
  }
  d.saved = text
  if (result.copy) notify(`“${stem(d.path)}” was changed in another app. Their version is in “${stem(result.copy)}”`)
}

/**
 * Save the current doc before switching away, tidy up empty drafts, and settle
 * its name. Resolves false if it couldn't be saved; callers must then stay put
 * rather than throw the user's words away.
 */
export async function leave(): Promise<boolean> {
  const d = doc
  if (!d) return true
  // Words with nowhere to go: ask now rather than lose them.
  if (needsAPlace(d)) {
    const dir = await whereToSave()
    if (!dir) return false
    d.dir = dir
  }
  // Keep saving until what's on screen is on disk: you may type while a save is in flight.
  for (let i = 0; i < 3; i++) {
    if (!(await save())) return false
    if (doc !== d || app.editor.getDoc() === d.saved) break
  }
  if (d.path && d.created && d.autoName && !app.editor.getDoc().trim()) {
    await api.trash(d.path).catch(() => {})
  } else if (d.path) {
    remember(d.path)
  }
  d.autoName = false
  return true
}

// ---------- changes made elsewhere ----------

/** The open file was deleted outside the app (or vanished while saving). */
export function fileGone(path: string | null): void {
  if (!path || doc.path !== path) return
  clearTimeout(saveTimer)
  forget(path)
  const name = stem(path)
  if (app.editor.getDoc() === doc.saved) {
    setDoc(untitled(hereDir()), '')
    notify(`“${name}” was deleted`)
  } else {
    // Unsaved words are kept; they'll be saved as a new document.
    Object.assign(doc, { path: null, name, created: false })
    announce()
    scheduleSave()
    notify(`“${name}” was deleted. Your latest changes will be saved as a new file`)
  }
}

/** Another app changed the open file. */
export async function fileChanged(path: string): Promise<void> {
  if (path !== doc.path) return
  const raw = await api.read(path).catch(() => null)
  if (raw === null || path !== doc.path) return
  const text = fromDisk(raw)
  doc.eol = eolOf(raw)
  if (text === doc.saved) return
  if (text === app.editor.getDoc()) {
    // The file already matches the page (e.g. a save of ours reported late).
    doc.saved = text
    return
  }
  if (app.editor.getDoc() === doc.saved) {
    // Nothing unsaved here: take their version.
    doc.saved = text
    app.editor.replaceDoc(text)
    return
  }
  // Both sides changed. Saving notices, keeps their version as a copy, then writes ours.
  void save()
}

export function fileMoved(from: string, to: string): void {
  if (doc.path !== from) return
  doc.path = to
  doc.autoName = false
  retarget(from, to)
  announce()
}

// ---------- documents ----------

function setDoc(next: Doc, text: string): void {
  app.editor.setDoc(text)
  doc = next
  announce()
}

function announce(): void {
  api.setCurrent(doc.path, title())
  for (const cb of listeners) cb()
}

/**
 * Where new documents go: next to the current one; with nothing to put it next
 * to, the only open folder if exactly one is open; otherwise nowhere yet (⌘S
 * or leaving asks).
 */
export const hereDir = (): string | null => (doc ? (doc.path ? dirname(doc.path) : placeOf(doc)) : null)

/** The folder relative links and images in the current document start from. */
export const docDir = hereDir

/** Starts with an empty document that isn't anywhere yet. */
export function startEmpty(): void {
  setDoc(untitled(null), '')
}

// Switching documents happens one at a time (a double-click can't open a file twice
// or interleave two switches).
let navigating: Promise<unknown> = Promise.resolve()
function navigate<T>(fn: () => Promise<T>): Promise<T> {
  const run = navigating.then(fn)
  navigating = run.catch(() => undefined)
  return run
}

function pushHistory(): void {
  if (!doc.path) return
  back.push(doc.path)
  forward.length = 0
}

export const newDoc = (dir?: string): Promise<void> =>
  navigate(async () => {
    const target = dir ?? hereDir()
    if (!(await leave())) return
    pushHistory()
    setDoc(untitled(target), '')
  })

export const open = (path: string): Promise<void> => navigate(() => openNow(path, true))

async function openNow(path: string, record: boolean): Promise<void> {
  if (doc?.path === path) return app.editor.view.focus()
  let raw: string
  try {
    raw = await api.read(path)
  } catch {
    forget(path)
    return notify(`Couldn't open ${basename(path)}`)
  }
  if (!(await leave())) return
  if (record) pushHistory()
  const text = fromDisk(raw)
  setDoc({ path, dir: dirname(path), saved: text, autoName: false, created: false, eol: eolOf(raw) }, text)
  remember(path)
}

/** Opens a named document that's only written to disk once you type in it. */
export const openNamed = (name: string): Promise<void> =>
  navigate(async () => {
    // A link like [[../../x]] must not reach outside the library.
    const parts = name.split('/').filter((p) => p && p !== '.' && p !== '..')
    const base = parts.pop() ?? 'Untitled'
    const here = hereDir()
    const dir = here ? join(here, ...parts) : null
    if (!(await leave())) return
    pushHistory()
    setDoc(untitled(dir, base), '')
  })

const travel = (from: string[], to: string[]): Promise<void> =>
  navigate(async () => {
    while (from.length) {
      const p = from.pop()!
      if (p === doc.path || !(await api.exists(p))) continue
      const here = doc.path
      await openNow(p, false)
      // Only record where we came from if we actually moved.
      if (here && doc.path === p) to.push(here)
      return
    }
  })

export const goBack = (): Promise<void> => travel(back, forward)
export const goForward = (): Promise<void> => travel(forward, back)

/** Keep history and recents pointing at a file after it moves. */
function retarget(old: string, next: string): void {
  const fix = (p: string): string => (isInside(p, old) ? next + p.slice(old.length) : p)
  back.splice(0, back.length, ...back.map(fix))
  forward.splice(0, forward.length, ...forward.map(fix))
  saveRecents(recents().map(fix))
}

// ---------- recents ----------

const RECENT = 'typr.recent'
export const recents = (): string[] => JSON.parse(localStorage.getItem(RECENT) ?? '[]')
const saveRecents = (list: string[]): void => localStorage.setItem(RECENT, JSON.stringify([...new Set(list)].slice(0, 30)))
/** Recents only ever hold settled names, never a half-typed title. */
function remember(p: string): void {
  saveRecents([p, ...recents()])
  api.addRecent(p)
}
const forget = (p: string): void => saveRecents(recents().filter((r) => r !== p))

// ---------- file commands ----------

export async function rename(target?: string): Promise<void> {
  await save()
  const path = target ?? doc.path
  openPrompt({
    placeholder: path ? 'Rename to…' : 'Name this document…',
    value: path ? stem(path) : (doc.name ?? deriveName(app.editor.getDoc())),
    submit: async (name) => {
      if (!path) {
        doc.name = name
        doc.autoName = false
        announce()
        if (app.editor.getDoc().trim()) await save()
        return
      }
      const next = await api.rename(path, name)
      if (doc.path === path) doc.autoName = false
      if (doc.path && isInside(doc.path, path)) doc.path = next + doc.path.slice(path.length)
      retarget(path, next)
      announce()
    }
  })
}

export function newFolder(dir?: string): void {
  openPrompt({
    placeholder: 'New folder name…',
    submit: async (name) => {
      const where = dir ?? hereDir()
      if (!where) return notify('Open a folder first (⇧⌘O)')
      const p = await api.mkdir(where, name)
      notify(`Created ${basename(p)}/`)
    }
  })
}

export const trash = (target?: string): Promise<void> => navigate(() => trashNow(target))

async function trashNow(target?: string): Promise<void> {
  const path = target ?? doc.path
  if (!path) {
    // An unsaved draft: just discard it.
    clearTimeout(saveTimer)
    setDoc(untitled(doc.dir), '')
    return
  }
  const isCurrent = doc.path !== null && isInside(doc.path, path)
  if (isCurrent) {
    clearTimeout(saveTimer)
    await chain
  }
  await api.trash(path)
  forget(path)
  if (isCurrent) {
    clearTimeout(saveTimer)
    setDoc(untitled(dirname(path)), '')
  }
  notify(`Moved “${basename(path)}” to Trash`)
}
