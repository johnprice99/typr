// One place for which files Typr treats as documents and images.

export const TEXT_EXTENSIONS = ['md', 'markdown', 'txt'] as const
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp'] as const

const ext = (path: string): string => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export const isTextPath = (path: string): boolean => (TEXT_EXTENSIONS as readonly string[]).includes(ext(path))
export const isImagePath = (path: string): boolean => (IMAGE_EXTENSIONS as readonly string[]).includes(ext(path))
