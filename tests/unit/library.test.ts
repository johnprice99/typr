import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { sanitize, scan, uniquePath, writeAtomic } from '../../src/main/library'

const root = mkdtempSync(join(tmpdir(), 'typr-unit-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const file = (rel: string, content = ''): void => {
  mkdirSync(join(root, rel, '..'), { recursive: true })
  writeFileSync(join(root, rel), content)
}

describe('the library list', () => {
  it('lists documents and folders, skipping hidden, ignored and picture-only folders', async () => {
    file('Story.md')
    file('notes.txt')
    file('Chapters/One.md')
    file('Chapters/Deep/Two.markdown')
    file('Pictures/map.png')
    file('.obsidian/config.md')
    file('node_modules/x/readme.md')
    mkdirSync(join(root, 'Empty'))
    const list = await scan(root)
    expect(list.sort()).toEqual([
      'Chapters/',
      'Chapters/Deep/',
      'Chapters/Deep/Two.markdown',
      'Chapters/One.md',
      'Empty/',
      'Story.md',
      'notes.txt'
    ])
  })
})

describe('safe file names', () => {
  it('strips characters a file name cannot hold', () => {
    expect(sanitize('What: a/b\\c?')).toBe('What abc')
    expect(sanitize('  ...hidden  ')).toBe('hidden')
    expect(sanitize('trailing dots...')).toBe('trailing dots')
    expect(sanitize('')).toBe('Untitled')
  })

  it('picks a free name, but a case-only rename is the same file', () => {
    file('dir/Notes.md')
    expect(uniquePath(join(root, 'dir'), 'Notes', '.md')).toBe(join(root, 'dir', 'Notes 2.md'))
    // On a Mac disk "notes.md" and "Notes.md" are the same file, so renaming it to itself is allowed.
    expect(uniquePath(join(root, 'dir'), 'NOTES', '.md', join(root, 'dir', 'Notes.md'))).toBe(join(root, 'dir', 'NOTES.md'))
  })
})

describe('saving', () => {
  it('replaces a file in one step, keeping its permissions and leaving no temp files', async () => {
    file('save/doc.md', 'old')
    chmodSync(join(root, 'save/doc.md'), 0o600)
    await writeAtomic(join(root, 'save/doc.md'), 'new text')
    expect(readFileSync(join(root, 'save/doc.md'), 'utf8')).toBe('new text')
    expect(statSync(join(root, 'save/doc.md')).mode & 0o777).toBe(0o600)
    expect(readdirSync(join(root, 'save'))).toEqual(['doc.md'])
  })
})

describe('saving a read-only file', () => {
  it('is refused rather than quietly replaced', async () => {
    file('ro/doc.md', 'locked')
    chmodSync(join(root, 'ro/doc.md'), 0o444)
    await expect(writeAtomic(join(root, 'ro/doc.md'), 'new')).rejects.toThrow(/EACCES/)
    expect(readFileSync(join(root, 'ro/doc.md'), 'utf8')).toBe('locked')
    chmodSync(join(root, 'ro/doc.md'), 0o644)
  })
})
