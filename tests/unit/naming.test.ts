import { describe, expect, it } from 'vitest'
import { cleanName, deriveName, nameSettled } from '../../src/renderer/src/naming'

describe('naming a new document from its first line', () => {
  it.each([
    ['# The Storm\n\nIt was dark.', 'The Storm'],
    ['\n\n  ## Chapter one  \n', 'Chapter one'],
    ['- a list item first', 'a list item first'],
    ['> quoted opening', 'quoted opening'],
    ['**Bold** and _italic_ title', 'Bold and italic title'],
    ['See [the map](https://x.com) now', 'See the map now'],
    ['Meet [[Mara|our hero]] today', 'Meet Mara today'],
    ['One sentence. Two sentence. Three.', 'One sentence. Two sentence. Three'],
    ['What: a/b\\c?', 'What a b c'],
    ['', 'Untitled'],
    ['###', 'Untitled']
  ])('%j → %j', (text, name) => {
    expect(deriveName(text)).toBe(name)
  })

  it('uses a front-matter title, or skips front matter', () => {
    expect(deriveName('---\ntitle: "My Post"\ntags: a\n---\n# Heading')).toBe('My Post')
    expect(deriveName('---\ntags: a\n---\n\n# Heading')).toBe('Heading')
  })

  it('ignores comment notes', () => {
    expect(deriveName('The {==harbour==}{>>check<<} at dawn')).toBe('The harbour at dawn')
  })

  it('keeps long names to about 60 characters, on a word boundary', () => {
    const name = cleanName('This is a very long opening line that just keeps going and going well past sixty')
    expect(name.length).toBeLessThanOrEqual(60)
    expect(name.endsWith(' ')).toBe(false)
    expect('This is a very long opening line that just keeps going and going well past sixty'.startsWith(name)).toBe(true)
  })
})

describe('when a new document’s name is settled', () => {
  it.each([
    ['The Sto', false],
    ['The Storm\n', true],
    ['\n\n  The Storm', false],
    ['\n\nThe Storm\nIt was', true],
    ['---\ntitle: The Storm', false],
    ['---\ntitle: The Storm\n---\n', true],
    ['---\ntags: a\n---\nOpening', false],
    ['---\ntags: a\n---\nOpening line\n', true]
  ])('%j → %s', (text, settled) => {
    expect(nameSettled(text)).toBe(settled)
  })
})
