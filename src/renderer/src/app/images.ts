import { isImagePath, isTextPath } from '../../../shared/files'
import { isInside, relativePath, stem } from '../paths'
import { api, app, notify } from './context'
import { docDir, open } from './session'

// Images are linked where they are, never copied. Inside the library the link
// is relative, so it survives moving or syncing the library; elsewhere it's absolute.

function imageMarkdown(file: string): string {
  const here = docDir()
  const lib = app.settings.library
  const target = isInside(file, lib) && isInside(here, lib) ? relativePath(here, file) : file
  const alt = stem(file)
    .replace(/\.[^.]+$/, '')
    .replace(/[[\]]/g, '')
  return `![${alt}](${encodeURI(target).replace(/\(/g, '%28').replace(/\)/g, '%29')})`
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
