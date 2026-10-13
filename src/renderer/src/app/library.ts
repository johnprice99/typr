import { basename, dirname, isInside, join, relativeTo, stem, tildify } from '../paths'
import { openList } from '../ui/palette'
import { renderSidebar } from '../ui/sidebar'
import { $, api, app, notify } from './context'
import { closeDoc, current, folderMoved, forgetRecentsIn, open, openNamed, recents } from './session'

// Open folders: the sidebar, opening and closing folders, Go to File, and
// asking where a new document should go.

/** The open folder a path is in, if any. */
export const folderOf = (path: string): string | null => app.folders.find((f) => isInside(path, f.path))?.path ?? null

export async function openFolder(): Promise<string | null> {
  const path = await api.openFolder()
  if (path) notify(`Opened “${basename(path)}”`)
  return path
}

/**
 * Closes a folder (asking which, if there are several). If the open document is
 * in it, that's closed too (saved first). Nothing on disk changes.
 */
export async function closeFolder(path?: string): Promise<void> {
  const close = async (p: string): Promise<void> => {
    const doc = current().path
    if (doc && isInside(doc, p) && !(await closeDoc())) return
    await api.closeFolder(p)
    folderMoved(p, null)
    forgetRecentsIn(p)
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
        {
          label: 'Choose a folder…',
          detail: 'Opens it in the sidebar too',
          run: () =>
            openFolder().then(resolve, (e) => {
              resolve(null)
              throw e
            })
        }
      ],
      onCancel: () => resolve(null)
    })
  })
}

let drawn = ''

/** Redraws the sidebar, but only if something it shows has changed. */
export function drawSidebar(): void {
  const path = current().path
  const key = `${path ?? ''}\n${JSON.stringify(app.folders)}\n${app.openFiles.join('\n')}`
  if (key === drawn) return
  drawn = key
  renderSidebar($('sidebar'), app.folders, app.openFiles, path, {
    open: (path) => open(path),
    menu: (path, isDir) => api.itemMenu(path, isDir),
    openFolder: () => void openFolder(),
    reorder: (order) => void api.reorderFolders(order)
  })
}

/** Go to File: your open folders' documents and Open Files, recently used ones first; typing a new name creates it. */
export function quickOpen(): void {
  const docs = [
    ...app.folders.flatMap((f) => f.entries.filter((e) => !e.endsWith('/')).map((e) => join(f.path, e))),
    ...app.openFiles
  ]
  const listed = new Set(docs)
  const all = [...new Set([...recents().filter((p) => listed.has(p)), ...docs])].filter((p) => p !== current().path)
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
