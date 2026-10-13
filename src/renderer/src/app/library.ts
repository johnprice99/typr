import { basename, dirname, join, relativeTo, stem, tildify as home } from '../paths'
import { openList, PaletteItem } from '../ui/palette'
import { renderSidebar } from '../ui/sidebar'
import { $, api, app, notify } from './context'
import { current, open, openNamed, recents } from './session'

// The library: choosing its folder, the sidebar, and Go to File.

export async function chooseLibrary(firstRun = false): Promise<void> {
  const opts = await api.libraryOptions()
  const pick = async (path: string): Promise<void> => {
    await api.setLibrary(path)
    notify(`Library: ${home(path)}`)
  }
  const items: PaletteItem[] = [
    { label: 'Documents', detail: home(opts.documents), run: () => pick(opts.documents) },
    ...(opts.icloud ? [{ label: 'iCloud Drive', detail: home(opts.icloud), run: () => pick(opts.icloud!) }] : []),
    {
      label: 'Choose a folder…',
      detail: 'e.g. an existing notes folder',
      run: async () => {
        if (!(await api.chooseLibrary()) && firstRun) await api.setLibrary(opts.documents)
      }
    }
  ]
  openList({
    placeholder: firstRun ? 'Where should your writing live?  (Esc for Documents)' : 'Library folder…',
    items,
    onCancel: firstRun ? () => api.setLibrary(opts.documents) : undefined
  })
}

let drawn = ''

/** Redraws the sidebar, but only if something it shows has changed. */
export function drawSidebar(): void {
  const lib = app.settings.library
  const doc = current()
  const key = `${lib}\n${doc?.path ?? ''}\n${app.files.join('\n')}`
  if (key === drawn) return
  drawn = key
  renderSidebar($('sidebar'), app.files, basename(lib), doc?.path ? relativeTo(doc.path, lib) : null, {
    open: (rel) => open(join(lib, rel)),
    menu: (rel, isDir) => api.itemMenu(rel ? join(lib, rel) : lib, isDir)
  })
}

/** Go to File: recent files first, then the library; typing a new name creates it. */
export function quickOpen(): void {
  const lib = app.settings.library
  const docs = app.files.filter((f) => !f.endsWith('/')).map((f) => join(lib, f))
  const all = [...new Set([...recents(), ...docs])].filter((p) => p !== current().path)
  const where = (p: string): string => relativeTo(dirname(p), lib) ?? home(dirname(p))
  openList({
    placeholder: 'Go to file, or type a new name…',
    items: all.map((p) => ({ label: stem(p), detail: where(p), run: () => open(p) })),
    fallback: (q) => ({ label: `New document “${q}”`, hint: '↩', run: () => openNamed(q) })
  })
}
