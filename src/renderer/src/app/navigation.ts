import { isTextPath } from '../../../shared/files'
import { Link, linkAt } from '../editor/links'
import { basename, dirname, join, normalize, relativeTo, safeDecode } from '../paths'
import { api, app, notify } from './context'
import { current, docDir, open, openNamed } from './session'

// Following links: [[wikilinks]] between notes, Markdown links to files, and web links.

const EXT = /\.(md|markdown|txt)$/i
const docFiles = (): string[] => app.files.filter((f) => !f.endsWith('/'))

/** Names offered when typing [[: just the name, or the folder too if two notes share it. */
export function linkNames(): string[] {
  const stems = docFiles().map((f) => f.replace(EXT, ''))
  const count = new Map<string, number>()
  for (const s of stems) count.set(basename(s), (count.get(basename(s)) ?? 0) + 1)
  return [...new Set(stems.map((s) => (count.get(basename(s))! > 1 ? s : basename(s))))]
}

const linkTarget = (raw: string): string => raw.split('|')[0].split('#')[0].trim()

/** The note a [[link]] points to: same folder first, then the shortest path in the library. */
async function resolveWiki(raw: string): Promise<string | null> {
  const target = linkTarget(raw).replace(EXT, '')
  if (!target) return null
  const want = target.toLowerCase()
  const doc = current()
  const here = doc.path ? relativeTo(dirname(doc.path), app.settings.library) : null
  const dirOf = (f: string): string => (f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '')
  const matches = docFiles()
    .filter((f) => {
      const s = f.replace(EXT, '').toLowerCase()
      return s === want || s.endsWith('/' + want)
    })
    .sort((a, b) => Number(dirOf(b) === here) - Number(dirOf(a) === here) || a.length - b.length)
  if (matches.length) return join(app.settings.library, matches[0])
  if (doc.path) {
    const sibling = join(dirname(doc.path), `${target}.md`)
    if (await api.exists(sibling)) return sibling
  }
  return null
}

export async function follow(link: Link): Promise<void> {
  if (link.kind === 'url') {
    if (/^[a-z][a-z0-9+.-]*:/i.test(link.url)) return api.openExternal(link.url)
    const rel = safeDecode(link.url.split('#')[0])
    const p = normalize(rel.startsWith('/') ? rel : join(docDir(), rel))
    if (!(await api.exists(p))) return notify(`Can't find ${rel}`)
    return isTextPath(p) ? open(p) : api.reveal(p)
  }
  const found = await resolveWiki(link.target)
  if (found) return open(found)
  const name = linkTarget(link.target)
  if (!name) return
  // A link to a note that doesn't exist opens it; it's saved once you type.
  await openNamed(name)
  notify(`New note “${basename(name)}”. ⌘[ to go back`)
}

export function followAtCursor(): void {
  const { state } = app.editor.view
  const link = linkAt(state, state.selection.main.head)
  if (link) void follow(link)
  else notify('No link here')
}
