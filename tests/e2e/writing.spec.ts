import { chmodSync, existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { expect, settle, test } from './fixtures'

test.describe('writing and saving', () => {
  test('a new document saves itself, named after its first line', async ({ launch }) => {
    const t = await launch()
    await t.page.locator('.cm-content').click()
    await t.page.keyboard.insertText('# The Storm\n\nIt was a dark night.')
    await settle(t.page)
    expect(t.ls()).toEqual(['The Storm.md'])
    expect(t.read('The Storm.md')).toBe('# The Storm\n\nIt was a dark night.')
    await expect(t.page.locator('#title')).toHaveText('The Storm')
  })

  test('the name follows the first line while new, then settles', async ({ launch }) => {
    const t = await launch()
    await t.setText('# Draft\n\nHello.')
    await settle(t.page)
    await t.setText('# Better Draft\n\nHello.')
    await settle(t.page)
    expect(t.ls()).toEqual(['Better Draft.md'])

    await t.command('new')
    await settle(t.page, 300)
    await t.command('back')
    await settle(t.page, 500)
    await t.setText('# Much Better Draft\n\nHello.')
    await settle(t.page)
    expect(t.ls()).toEqual(['Better Draft.md'])
    expect(t.read('Better Draft.md')).toContain('Much Better Draft')
  })

  test('capitalising a title renames the file rather than making "2"', async ({ launch }) => {
    const t = await launch()
    await t.setText('the storm')
    await settle(t.page)
    await t.setText('The storm')
    await settle(t.page)
    expect(t.ls()).toEqual(['The storm.md'])
  })

  test('a draft left empty leaves no file behind', async ({ launch }) => {
    const t = await launch()
    await t.setText('x')
    await settle(t.page)
    expect(t.ls()).toEqual(['x.md'])
    await t.setText('')
    await settle(t.page)
    await t.command('new')
    await settle(t.page)
    expect(t.ls()).toEqual([])
  })

  test('Back after New returns to the previous document', async ({ launch }) => {
    const t = await launch({ files: { 'First.md': '# First' } })
    await t.open(join(t.lib, 'First.md'))
    await expect(t.page.locator('#title')).toHaveText('First')
    await t.command('new')
    await expect(t.page.locator('#title')).toHaveText('Untitled')
    await t.command('back')
    await expect(t.page.locator('#title')).toHaveText('First')
  })

  test('if a save fails, Typr stays on the document instead of losing it', async ({ launch }) => {
    const t = await launch({ files: { 'Locked.md': 'original', 'Other.md': 'other' } })
    await t.open(join(t.lib, 'Locked.md'))
    await expect(t.page.locator('#title')).toHaveText('Locked')
    chmodSync(join(t.lib, 'Locked.md'), 0o444)
    try {
      await t.setText('changed words')
      await t.open(join(t.lib, 'Other.md'))
      await expect(t.page.locator('#toast')).toContainText("Couldn't save")
      await expect(t.page.locator('#title')).toHaveText('Locked')
      expect(await t.text()).toBe('changed words')
    } finally {
      chmodSync(join(t.lib, 'Locked.md'), 0o644)
    }
  })

  test('⇧⌘K does not delete the line', async ({ launch }) => {
    const t = await launch()
    await t.setText('keep this line')
    await t.page.keyboard.press('Meta+Shift+K')
    expect(await t.text()).toBe('keep this line')
  })
})

test.describe('lists and quotes', () => {
  test('Enter continues a list, and Enter on an empty item ends it', async ({ launch }) => {
    const t = await launch()
    await t.page.locator('.cm-content').click()
    await t.page.keyboard.type('* one')
    await t.page.keyboard.press('Enter')
    await t.page.keyboard.type('two')
    await t.page.keyboard.press('Enter')
    await t.page.keyboard.press('Enter')
    await t.page.keyboard.type('After.')
    expect(await t.text()).toBe('* one\n* two\n\nAfter.')
  })

  test('tasks and numbered lists continue; quotes end on an empty line', async ({ launch }) => {
    const t = await launch()
    await t.page.locator('.cm-content').click()
    for (const [keys, enters] of [
      ['- [ ] task', 1],
      ['next', 2],
      ['1. a', 1],
      ['b', 2],
      ['> quote', 2],
      ['done', 0]
    ] as const) {
      await t.page.keyboard.type(keys)
      for (let i = 0; i < enters; i++) await t.page.keyboard.press('Enter')
    }
    expect(await t.text()).toBe('- [ ] task\n- [ ] next\n\n1. a\n2. b\n\n> quote\n\ndone')
  })
})

test.describe('files changed outside Typr', () => {
  test('a rename in Finder is followed', async ({ launch }) => {
    const t = await launch({ files: { 'Bob.md': 'Bob is tall.' } })
    await t.open(join(t.lib, 'Bob.md'))
    await expect(t.page.locator('#title')).toHaveText('Bob')
    renameSync(join(t.lib, 'Bob.md'), join(t.lib, 'Robert.md'))
    await expect(t.page.locator('#title')).toHaveText('Robert', { timeout: 5000 })
    await t.setText('Bob is tall. Very.')
    await settle(t.page)
    expect(t.read('Robert.md')).toBe('Bob is tall. Very.')
    expect(existsSync(join(t.lib, 'Bob.md'))).toBe(false)
  })

  test('if another app changes the file while you type, both versions are kept', async ({ launch }) => {
    const t = await launch({ files: { 'Shared.md': 'original' } })
    await t.open(join(t.lib, 'Shared.md'))
    await expect(t.page.locator('#title')).toHaveText('Shared')
    await t.setText('my new words')
    writeFileSync(join(t.lib, 'Shared.md'), 'their words')
    await expect(t.page.locator('#toast')).toContainText('changed in another app', { timeout: 5000 })
    expect(t.ls()).toEqual(['Shared (changed elsewhere).md', 'Shared.md'])
    expect(t.read('Shared.md')).toBe('my new words')
    expect(t.read('Shared (changed elsewhere).md')).toBe('their words')
  })

  test('a delete in Finder closes the document calmly', async ({ launch }) => {
    const t = await launch({ files: { 'Gone.md': 'soon gone' } })
    await t.open(join(t.lib, 'Gone.md'))
    await expect(t.page.locator('#title')).toHaveText('Gone')
    unlinkSync(join(t.lib, 'Gone.md'))
    await expect(t.page.locator('#toast')).toContainText('was deleted', { timeout: 5000 })
    await expect(t.page.locator('#title')).toHaveText('Untitled')
    await settle(t.page)
    expect(t.ls()).toEqual([])
  })
})

test.describe('fixes from the second review', () => {
  test('Markdown spanning a line break does not break the formatted view or autosave', async ({ launch }) => {
    const t = await launch({
      files: {
        'Wrapped.md': '# Wrapped\n\n![a long\nalt](x.png) and [a link](\nhttps://x.com) and {==text==}{>>a\nnote<<}\n\nEnd.'
      }
    })
    await t.open(join(t.lib, 'Wrapped.md'))
    await expect(t.page.locator('#title')).toHaveText('Wrapped')
    await t.select((await t.text()).length)
    expect(await t.lineShown(1)).toBe('Wrapped')
    await t.page.keyboard.insertText(' More.')
    await settle(t.page)
    expect(t.read('Wrapped.md').endsWith('End. More.')).toBe(true)
    expect(t.errors).toEqual([])
  })

  test('Windows line endings are kept, and edits from other apps are taken', async ({ launch }) => {
    const t = await launch({ files: { 'Win.md': 'one\r\ntwo\r\n', 'Other.md': 'other' } })
    await t.open(join(t.lib, 'Win.md'))
    await expect(t.page.locator('#title')).toHaveText('Win')
    // Opening and leaving must not rewrite the file.
    await t.open(join(t.lib, 'Other.md'))
    await expect(t.page.locator('#title')).toHaveText('Other')
    expect(t.read('Win.md')).toBe('one\r\ntwo\r\n')
    // Another app edits it while it's open: Typr takes the change and doesn't make a conflict copy.
    await t.open(join(t.lib, 'Win.md'))
    await expect(t.page.locator('#title')).toHaveText('Win')
    writeFileSync(join(t.lib, 'Win.md'), 'one\r\ntwo\r\nthree\r\n')
    await expect.poll(() => t.text(), { timeout: 5000 }).toBe('one\ntwo\nthree\n')
    // Typing keeps the Windows line endings.
    await t.select((await t.text()).length)
    await t.page.keyboard.insertText('four')
    await settle(t.page)
    expect(t.read('Win.md')).toBe('one\r\ntwo\r\nthree\r\nfour')
    expect(t.ls()).toEqual(['Other.md', 'Win.md'])
  })

  test('if the file is deleted just before you move on, your words are saved as a new file', async ({ launch }) => {
    const t = await launch({ files: { 'Doomed.md': 'start' } })
    await t.open(join(t.lib, 'Doomed.md'))
    await expect(t.page.locator('#title')).toHaveText('Doomed')
    await t.setText('start and my last words')
    unlinkSync(join(t.lib, 'Doomed.md'))
    await t.command('new') // straight away: before the watcher can notice
    await expect.poll(() => t.ls()).toEqual(['Doomed.md'])
    expect(t.read('Doomed.md')).toBe('start and my last words')
  })

  test('a file outside the library that is renamed in Finder keeps saving', async ({ launch }) => {
    const t = await launch()
    const before = join(t.outside, 'a.md')
    writeFileSync(before, 'hello')
    await t.open(before)
    await expect(t.page.locator('#title')).toHaveText('a')
    renameSync(before, join(t.outside, 'b.md'))
    await expect(t.page.locator('#title')).toHaveText('b', { timeout: 5000 })
    await t.setText('hello again')
    await settle(t.page)
    expect(readFileSync(join(t.outside, 'b.md'), 'utf8')).toBe('hello again')
    await expect(t.page.locator('#toast')).not.toContainText("Couldn't save")
  })

  test('Move to Trash on an unsaved draft discards it instead of saving it', async ({ launch }) => {
    const t = await launch()
    await t.setText('throwaway words')
    await t.command('trash')
    await settle(t.page)
    expect(t.ls()).toEqual([])
    expect(await t.text()).toBe('')
  })
})
