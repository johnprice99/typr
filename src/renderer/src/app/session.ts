import { deriveName, nameSettled } from '../naming'
import { rebase } from '../../../shared/paths'
import { basename, dirname, isInside, join, stem } from '../paths'
import { readList } from '../storage'
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
  /** The name last asked for from the first line (the file may be "Name 2" if "Name" was taken). */
  askedName?: string
  /** Created this session, so safe to clean up if left empty. */
  created: boolean
  /** The file's line endings, kept when saving (the editor always uses "\n"). */
  eol: '\n' | '\r\n'
}

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

let doc: Doc = untitled(null)

// The editor works with "\n" line breaks; files keep whatever they had (e.g. Windows "\r\n").
const fromDisk = (raw: string): string => raw.replace(/\r\n?/g, '\n')
const eolOf = (raw: string): Doc['eol'] => (raw.includes('\r\n') ? '\r\n' : '\n')
const toDisk = (text: string, eol: Doc['eol']): string => (eol === '\n' ? text : text.replace(/\n/g, eol))

export const title = (): string => (doc.path ? stem(doc.path) : (doc.name ?? 'Untitled'))

// ---------- saving ----------

let saveTimer = 0
/** While the open document is going to the Trash, typing doesn't save it (and bring it back). */
let trashing = false

export function scheduleSave(): void {
  clearTimeout(saveTimer)
  if (!trashing) saveTimer = window.setTimeout(() => save(false), 400)
}

let chain: Promise<unknown> = Promise.resolve()
/**
 * Runs `fn` once everything queued before it has finished: saves, renames and
 * changes made elsewhere happen one at a time, so they never act on a stale path.
 */
function serial<T>(fn: () => Promise<T> | T): Promise<T> {
  const run = chain.then(fn)
  chain = run.catch(() => undefined)
  return run
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
 * error has been shown). An autosave (`force` false) doesn't create a new
 * document's file until its first line is finished, so it's made once, with
 * its name, rather than renamed with every key; leaving, ⌘S and quitting do.
 */
export function save(force = true): Promise<boolean> {
  clearTimeout(saveTimer)
  const d = doc
  const text = app.editor.getDoc()
  return serial(() => writeNow(d, text, force)).then(
    () => true,
    (e) => {
      notify(`Couldn't save: ${errorText(e)}`)
      return false
    }
  )
}

/** The document now lives at `next` (renamed, or moved elsewhere). */
function movedTo(d: Doc, next: string): void {
  if (d.path && d.path !== next) retarget(d.path, next)
  d.path = next
  if (d === doc) announce()
}

async function writeNow(d: Doc, text: string, force: boolean): Promise<void> {
  if (trashing && d === doc) return // it's going to the Trash; saving would bring it back
  if (!d.path) {
    // Nothing to save yet, or nowhere to put it (⌘S or leaving will ask).
    const dir = placeOf(d)
    if (!text.trim() || !dir) return
    if (!force && !d.name && !nameSettled(text)) return
    d.dir = dir
    d.askedName = d.name ?? deriveName(text)
    d.path = await api.create(dir, d.askedName, toDisk(text, d.eol))
    d.created = true
    d.saved = text
    if (d === doc) announce()
    return
  }
  if (d.autoName) {
    const name = deriveName(text)
    if (name !== (d.askedName ?? stem(d.path))) {
      movedTo(d, await api.rename(d.path, name))
      d.askedName = name
    }
  }
  if (text === d.saved) return
  const path = d.path
  const result = await api.write(path, toDisk(text, d.eol), toDisk(d.saved, d.eol))
  if ('gone' in result) {
    // The file was deleted (a move is followed by the main process). Save these
    // words as a new file right now, before anything else.
    d.path = await api.create(dirname(path), stem(path), toDisk(text, d.eol))
    d.saved = text
    d.created = true
    forget(path)
    if (d === doc) announce()
    notify(`“${stem(path)}” was deleted. Your latest changes are saved in “${stem(d.path)}”`)
    return
  }
  if (result.path !== path) {
    // Renamed or moved in Finder before the watcher noticed: Typr wrote to the new place.
    d.autoName = false
    movedTo(d, result.path)
  }
  d.saved = text
  if (result.copy) notify(`“${stem(result.path)}” was changed in another app. Their version is in “${stem(result.copy)}”`)
}

/**
 * Save the current doc before switching away, tidy up empty drafts, and settle
 * its name. Resolves false if it couldn't be saved; callers must then stay put
 * rather than throw the user's words away.
 */
export async function leave(): Promise<boolean> {
  const d = doc
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
    const empty = d.path
    await serial(() => api.trash(empty)).catch(() => {})
    forget(empty)
    d.path = null
  } else if (d.path) {
    remember(d.path)
  }
  d.autoName = false
  return true
}

/** Leaves the document (saving it) after any switch already under way; used when quitting. */
export const flush = (): Promise<boolean> => navigate(leave)

// ---------- changes made elsewhere ----------
// These wait for any save in progress, so they see the document as it now is.

/** The open file was deleted outside the app. */
export const fileGone = (path: string | null): Promise<void> => serial(() => goneNow(path))

function goneNow(path: string | null): void {
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
export const fileChanged = (path: string): Promise<void> => serial(() => changedNow(path))

async function changedNow(path: string): Promise<void> {
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

export const fileMoved = (from: string, to: string): Promise<void> =>
  serial(() => {
    if (doc.path !== from) return
    doc.autoName = false
    movedTo(doc, to)
  })

/**
 * A folder was closed, renamed (`to`) or trashed: a new document that was going
 * to be saved in it goes in the renamed folder, or asks again.
 */
export function folderMoved(from: string, to: string | null): void {
  if (doc.path || !doc.dir || !isInside(doc.dir, from)) return
  doc.dir = to ? rebase(doc.dir, from, to) : null
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
export const hereDir = (): string | null => (doc.path ? dirname(doc.path) : placeOf(doc))

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
    // Next to this document, or where this one was going; with neither, it's
    // worked out when saving (so closing a folder can't leave it nowhere).
    const target = dir ?? (doc.path ? dirname(doc.path) : doc.dir)
    if (!(await leave())) return
    pushHistory()
    setDoc(untitled(target), '')
  })

export const open = (path: string): Promise<void> => navigate(async () => void (await openNow(path, pushHistory)))

/**
 * Closes the document (saving it first), leaving an empty page; ⌘[ reopens it.
 * Resolves false if it couldn't be saved, in which case it stays open.
 */
export const closeDoc = (): Promise<boolean> =>
  navigate(async () => {
    if (!(await leave())) return false
    pushHistory()
    setDoc(untitled(null), '')
    return true
  })

/**
 * Opens a file. `record` is told about the document being left (once it's been
 * saved, and so has its settled name). Resolves whether it opened, couldn't be
 * read, or stayed on the current document (which couldn't be saved).
 */
async function openNow(path: string, record: () => void): Promise<'opened' | 'unreadable' | 'stayed'> {
  if (doc.path === path) {
    app.editor.view.focus()
    return 'opened'
  }
  let raw: string
  try {
    raw = await api.read(path)
  } catch (e) {
    forget(path)
    notify(`Couldn't open ${basename(path)}: ${errorText(e)}`)
    return 'unreadable'
  }
  if (!(await leave())) return 'stayed'
  record()
  const text = fromDisk(raw)
  setDoc({ ...untitled(dirname(path)), path, saved: text, autoName: false, eol: eolOf(raw) }, text)
  remember(path)
  return 'opened'
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
      const result = await openNow(p, () => {
        if (doc.path) to.push(doc.path)
      })
      if (result === 'unreadable') continue // skip it, on to the step before
      // Couldn't leave this document: keep the step for next time.
      if (result === 'stayed') from.push(p)
      return
    }
  })

export const goBack = (): Promise<void> => travel(back, forward)
export const goForward = (): Promise<void> => travel(forward, back)

/** Keep history and recents pointing at a file after it moves. */
function retarget(old: string, next: string): void {
  const fix = (p: string): string => rebase(p, old, next)
  back.splice(0, back.length, ...back.map(fix))
  forward.splice(0, forward.length, ...forward.map(fix))
  saveRecents(recents().map(fix))
}

// ---------- recents ----------

const RECENT = 'typr.recent'

export const recents = (): string[] => readList(RECENT)
const saveRecents = (list: string[]): void => localStorage.setItem(RECENT, JSON.stringify([...new Set(list)].slice(0, 30)))
/** Recents only ever hold settled names, never a half-typed title. */
function remember(p: string): void {
  saveRecents([p, ...recents()])
  api.addRecent(p)
}
const forget = (p: string): void => saveRecents(recents().filter((r) => r !== p))
/** A folder was closed: its files leave the recent list too. */
export const forgetRecentsIn = (folder: string): void => saveRecents(recents().filter((r) => !isInside(r, folder)))

// ---------- file commands ----------

export async function rename(target?: string): Promise<void> {
  await save(false) // a new document is named here, so don't create it under another name first
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
      const next = await serial(() => api.rename(path, name))
      if (doc.path === path) doc.autoName = false
      if (doc.path) doc.path = rebase(doc.path, path, next)
      folderMoved(path, next)
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
    trashing = true
  }
  try {
    await serial(() => api.trash(path))
  } catch (e) {
    if (isCurrent) {
      trashing = false
      scheduleSave() // keep anything typed meanwhile
    }
    throw e
  }
  forget(path)
  folderMoved(path, null)
  if (isCurrent) {
    // The trashed document's folder, unless that went too.
    setDoc(untitled(doc.path === path ? dirname(path) : null), '')
    trashing = false
  }
  notify(`Moved “${basename(path)}” to Trash`)
}
