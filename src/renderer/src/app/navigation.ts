import { isTextPath } from '../../../shared/files'
import { linkAt } from '../editor/links'
import { decodePath, join, normalize } from '../paths'
import { api, app, notify } from './context'
import { hereDir, open } from './session'

// Following links: web addresses open in the browser; a link to a document on
// disk opens it in Typr; any other file is shown in Finder.

export async function follow(url: string): Promise<void> {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return api.openExternal(url)
  const rel = decodePath(url.split('#')[0])
  const base = hereDir()
  if (!rel.startsWith('/') && !base) return notify(`Save this document first to follow “${rel}”`)
  const p = normalize(rel.startsWith('/') ? rel : join(base!, rel))
  if (!(await api.exists(p))) return notify(`Can't find ${rel}`)
  return isTextPath(p) ? open(p) : api.reveal(p)
}

export function followAtCursor(): void {
  const { state } = app.editor.view
  const url = linkAt(state, state.selection.main.head)
  if (url) void follow(url)
  else notify('No link here')
}
