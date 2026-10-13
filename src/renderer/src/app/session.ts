import { deriveName } from '../naming'
import { basename, dirname, isInside, join, stem } from '../paths'
import { openPrompt } from '../ui/palette'
import { api, app, errorText, notify } from './context'

// The open document: creating, opening, saving, naming, history and the file
// commands (rename, new folder, trash), plus reacting to changes made elsewhere.

export interface Doc {
  /** null until there's something worth saving. */
  path: string | null
  /** Where the file will be created. */
  dir: string
  /** A name chosen up front (e.g. from a link); otherwise the first line names it. */
  name?: string
  /** Last content written to disk. */
  saved: string
  /** A new document is named after its first line until you leave it; then the name settles. */
  autoName: boolean
  /** Created this session, so safe to clean up if left empty. */
  created: boolean
}

let doc: Doc
const back: string[] = []
const forward: string[] = []
let onAnnounce: () => void = () => {}

export const current = (): Doc => doc

/** Called whenever the current document or its name changes (title bar, sidebar). */
export function onDocumentChange(cb: () => void): void {
  onAnnounce = cb
}

const untitled = (dir: string, name?: string): Doc => ({ path: null, dir, name, saved: '', autoName: !name, created: false })

export const title = (): string => (doc.path ? stem(doc.path) : (doc.name ?? 'Untitled'))

// ---------- saving ----------

let saveTimer = 0
let chain: Promise<void> = Promise.resolve()

export function scheduleSave(): void {
  clearTimeout(saveTimer)
  saveTimer = window.setTimeout(save, 400)
}

/** Saves now. Resolves false if the save failed (the error has been shown). */
export function save(): Promise<boolean> {
  clearTimeout(saveTimer)
  const d = doc
  const run = chain.then(writeNow).then(
    () => true,
    (e) => {
      if (errorText(e).includes('ENOENT')) {
        fileGone(d.path)
        return true
      }
      notify(`Couldn't save: ${errorText(e)}`)
      return false
    }
  )
  chain = run.then(() => undefined)
  return run
}

async function writeNow(): Promise<void> {
  const d = doc
  const text = app.editor.getDoc()
  if (!d.path) {
    if (!text.trim()) return
    d.path = await api.create(d.dir, d.name ?? deriveName(text), text)
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
  if (text !== d.saved) {
    const copy = await api.write(d.path, text, d.saved)
    d.saved = text
    if (copy) notify(`“${stem(d.path)}” was changed in another app. Their version is in “${stem(copy)}”`)
  }
}

/**
 * Save the current doc before switching away, tidy up empty drafts, and settle
 * its name. Resolves false if it couldn't be saved; callers must then stay put
 * rather than throw the user's words away.
 */
export async function leave(): Promise<boolean> {
  const d = doc
  if (!d) return true
  if (!(await save())) return false
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
  const text = await api.read(path).catch(() => null)
  if (text === null || text === doc.saved || path !== doc.path) return
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
  doc = next
  app.editor.setDoc(text)
  announce()
}

function announce(): void {
  api.setCurrent(doc.path, title())
  onAnnounce()
}

/** Folder for new things: next to the current file if it's in the library, else the library root. */
export function hereDir(): string {
  return doc?.path && isInside(doc.path, app.settings.library) ? dirname(doc.path) : app.settings.library
}

/** The folder relative links and images in the current document start from. */
export const docDir = (): string => (doc?.path ? dirname(doc.path) : (doc?.dir ?? app.settings.library))

/** Starts with an empty, unsaved document in the library. */
export function startEmpty(): void {
  setDoc(untitled(app.settings.library), '')
}

/** The library moved: an unsaved document follows it. */
export function libraryChanged(library: string): void {
  if (doc && !doc.path) doc.dir = library
}

function pushHistory(): void {
  if (!doc.path) return
  back.push(doc.path)
  forward.length = 0
}

export async function newDoc(dir?: string): Promise<void> {
  const target = dir ?? hereDir()
  if (!(await leave())) return
  pushHistory()
  setDoc(untitled(target), '')
}

export async function open(path: string, record = true): Promise<void> {
  if (doc?.path === path) return app.editor.view.focus()
  let text: string
  try {
    text = await api.read(path)
  } catch {
    forget(path)
    return notify(`Couldn't open ${basename(path)}`)
  }
  if (!(await leave())) return
  if (record) pushHistory()
  setDoc({ path, dir: dirname(path), saved: text, autoName: false, created: false }, text)
  remember(path)
}

/** Opens a named document that's only written to disk once you type in it. */
export async function openNamed(name: string): Promise<void> {
  const parts = name.split('/').filter(Boolean)
  const base = parts.pop() ?? 'Untitled'
  const dir = join(hereDir(), ...parts)
  if (!(await leave())) return
  pushHistory()
  setDoc(untitled(dir, base), '')
}

async function travel(from: string[], to: string[]): Promise<void> {
  while (from.length) {
    const p = from.pop()!
    if (p === doc.path || !(await api.exists(p))) continue
    const here = doc.path
    await open(p, false)
    // Only record where we came from if we actually moved.
    if (here && doc.path === p) to.push(here)
    return
  }
}

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
      const p = await api.mkdir(dir ?? hereDir(), name)
      notify(`Created ${basename(p)}/`)
    }
  })
}

export async function trash(target?: string): Promise<void> {
  const path = target ?? doc.path
  if (!path) return newDoc()
  const isCurrent = doc.path !== null && isInside(doc.path, path)
  if (isCurrent) {
    clearTimeout(saveTimer)
    await chain
  }
  await api.trash(path)
  forget(path)
  if (isCurrent) {
    clearTimeout(saveTimer)
    setDoc(untitled(isInside(dirname(path), app.settings.library) ? dirname(path) : app.settings.library), '')
  }
  notify(`Moved “${basename(path)}” to Trash`)
}
