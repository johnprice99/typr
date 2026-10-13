import { basename, dirname, isInside, join, relativeTo, stem, tildify } from '../paths'
import { openList } from '../ui/palette'
import { renderSidebar } from '../ui/sidebar'
import { $, api, app, notify } from './context'
import { current, open, openNamed, recents } from './session'

// Open folders: the sidebar, opening and closing folders, Go to File, and
// asking where a new document should go.

/** The open folder a path is in, if any. */
export const folderOf = (path: string): string | null => app.folders.find((f) => isInside(path, f.path))?.path ?? null

export async function openFolder(): Promise<string | null> {
  const path = await api.openFolder()
  if (path) notify(`Opened “${basename(path)}”`)
  return path
}

/** Closes a folder (asking which, if there are several). Nothing on disk changes. */
export function closeFolder(path?: string): void {
  const close = (p: string): void => {
    void api.closeFolder(p)
    notify(`Closed “${basename(p)}”`)
  }
  if (path) return close(path)
  if (!app.folders.length) return notify('No folders are open')
  if (app.folders.length === 1) return close(app.folders[0].path)
  openList({
    placeholder: 'Close which folder?',
    items: app.folders.map((f) => ({ label: basename(f.path), detail: tildify(f.path), run: () => close(f.path) }))
  })
}

/** Asks which folder a new document goes in: one of the open folders, or another. */
export function chooseWhere(): Promise<string | null> {
  return new Promise((resolve) => {
    openList({
      placeholder: 'Save this document in…',
      items: [
        ...app.folders.map((f) => ({ label: basename(f.path), detail: tildify(f.path), run: () => resolve(f.path) })),
        { label: 'Choose a folder…', detail: 'Opens it in the sidebar too', run: async () => resolve(await openFolder()) }
      ],
      onCancel: () => resolve(null)
    })
  })
}

let drawn = ''

/** Redraws the sidebar, but only if something it shows has changed. */
export function drawSidebar(): void {
  const doc = current()
  const key = `${doc?.path ?? ''}\n${JSON.stringify(app.folders)}`
  if (key === drawn) return
  drawn = key
  renderSidebar($('sidebar'), app.folders, doc?.path ?? null, {
    open: (path) => open(path),
    menu: (path, isDir) => api.itemMenu(path, isDir),
    openFolder: () => void openFolder()
  })
}

/** Go to File: recent files first, then every open folder; typing a new name creates it. */
export function quickOpen(): void {
  const docs = app.folders.flatMap((f) => f.entries.filter((e) => !e.endsWith('/')).map((e) => join(f.path, e)))
  const all = [...new Set([...recents(), ...docs])].filter((p) => p !== current().path)
  const where = (p: string): string => {
    const folder = folderOf(p)
    if (!folder) return tildify(dirname(p))
    const rel = relativeTo(dirname(p), folder)
    return rel ? `${basename(folder)}/${rel}` : basename(folder)
  }
  openList({
    placeholder: 'Go to file, or type a new name…',
    items: all.map((p) => ({ label: stem(p), detail: where(p), run: () => open(p) })),
    fallback: (q) => ({ label: `New document “${q}”`, hint: '↩', run: () => openNamed(q) })
  })
}
