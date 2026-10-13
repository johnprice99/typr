import { isImagePath, isTextPath } from '../../../shared/files'
import { encodePath, isInside, relativePath, stem } from '../paths'
import { api, app, notify } from './context'
import { folderOf } from './library'
import { hereDir, open } from './session'

// Images are linked where they are, never copied. When the image and the
// document are in the same open folder the link is relative, so it survives
// moving or syncing that folder; otherwise it's absolute.

function imageMarkdown(file: string): string {
  const here = hereDir()
  const folder = folderOf(file)
  const target = here && folder && isInside(here, folder) ? relativePath(here, file) : file
  const alt = stem(file)
    .replace(/\.[^.]+$/, '')
    .replace(/[[\]]/g, '')
  return `![${alt}](${encodePath(target)})`
}

/** Files dropped or pasted onto the page. Returns true if handled. */
export function insertFiles(files: File[], pos: number): boolean {
  const paths = files.map((f) => api.pathForFile(f)).filter(Boolean)
  const images = paths.filter(isImagePath)
  if (images.length) {
    app.editor.insertBlock(pos, images.map(imageMarkdown).join('\n\n'))
    return true
  }
  // Dropping a Markdown file opens it.
  const notes = paths.filter(isTextPath)
  if (notes.length) {
    void open(notes[0])
    return true
  }
  if (files.some((f) => f.type.startsWith('image/'))) {
    notify('Pasted images aren’t supported. Save it as a file and drag it in')
    return true
  }
  return false
}

export async function pickImage(): Promise<void> {
  const path = await api.pickImage()
  if (path) app.editor.insertBlock(app.editor.view.state.selection.main.head, imageMarkdown(path))
}
