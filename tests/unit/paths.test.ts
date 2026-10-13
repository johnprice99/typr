import { describe, expect, it } from 'vitest'
import {
  basename,
  dirname,
  imageSrc,
  isInside,
  join,
  normalize,
  relativePath,
  relativeTo,
  safeDecode,
  stem
} from '../../src/renderer/src/paths'
import { isImagePath, isTextPath } from '../../src/shared/files'

describe('paths', () => {
  it('joins, splits and normalises', () => {
    expect(join('/lib/', 'a', '', 'b.md')).toBe('/lib/a/b.md')
    expect(dirname('/lib/a/b.md')).toBe('/lib/a')
    expect(dirname('/b.md')).toBe('/')
    expect(basename('/lib/a/b.md')).toBe('b.md')
    expect(stem('/lib/My Story.markdown')).toBe('My Story')
    expect(normalize('/lib/a/../b/./c.md')).toBe('/lib/b/c.md')
  })

  it('knows what is inside a folder', () => {
    expect(isInside('/lib/a.md', '/lib')).toBe(true)
    expect(isInside('/lib', '/lib')).toBe(true)
    expect(isInside('/library/a.md', '/lib')).toBe(false)
    expect(relativeTo('/lib/x/a.md', '/lib')).toBe('x/a.md')
    expect(relativeTo('/elsewhere/a.md', '/lib')).toBeNull()
  })

  it.each([
    ['/lib/stories', '/lib/stories/map.png', 'map.png'],
    ['/lib/stories', '/lib/Pictures/map.png', '../Pictures/map.png'],
    ['/lib', '/lib/a/b/c.png', 'a/b/c.png'],
    ['/lib/x/y', '/lib/z.png', '../../z.png']
  ])('relative path from %s to %s', (from, to, want) => {
    expect(relativePath(from, to)).toBe(want)
  })

  it('decodes links without throwing on a stray %', () => {
    expect(safeDecode('My%20Map.png')).toBe('My Map.png')
    expect(safeDecode('100%.png')).toBe('100%.png')
  })

  it('turns image links into loadable URLs', () => {
    expect(imageSrc('pic%20one.png', '/lib/a')).toBe('typr-file://local/lib/a/pic%20one.png')
    expect(imageSrc('../b.png', '/lib/a')).toBe('typr-file://local/lib/b.png')
    expect(imageSrc('/abs/c.png', '/lib')).toBe('typr-file://local/abs/c.png')
    expect(imageSrc('https://x.com/d.png', '/lib')).toBe('https://x.com/d.png')
    expect(imageSrc('100%.png', '/lib')).toBe('typr-file://local/lib/100%25.png')
  })

  it('recognises documents and images', () => {
    expect(isTextPath('/a/B.MD')).toBe(true)
    expect(isTextPath('/a/notes.txt')).toBe(true)
    expect(isTextPath('/a/.md')).toBe(false)
    expect(isImagePath('/a/p.JPeG')).toBe(true)
    expect(isImagePath('/a/p.pdf')).toBe(false)
  })
})
