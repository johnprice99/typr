import { chmodSync, existsSync, lstatSync, readFileSync, renameSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'fs'
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

  test('a new document isn’t written until its first line is finished (or you leave it)', async ({ launch }) => {
    const t = await launch({ files: { 'Other.md': 'other' } })
    await t.page.locator('.cm-content').click()
    await expect(t.page.locator('.cm-content')).toBeFocused()
    await t.page.keyboard.insertText('The Lant')
    await settle(t.page)
    await t.page.keyboard.insertText('ern')
    await settle(t.page)
    expect(t.ls()).toEqual(['Other.md']) // nothing yet, so no "The Lant.md" on the way
    await t.page.keyboard.press('Enter')
    await settle(t.page)
    expect(t.ls()).toEqual(['Other.md', 'The Lantern.md'])
    // Leaving a document whose first line isn't finished still saves it.
    await t.command('new')
    await t.page.keyboard.insertText('Half a title')
    await t.open(join(t.lib, 'Other.md'))
    await expect(t.page.locator('#title')).toHaveText('Other')
    expect(t.ls()).toEqual(['Half a title.md', 'Other.md', 'The Lantern.md'])
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
    await t.setText('the storm\n')
    await settle(t.page)
    await t.setText('The storm\n')
    await settle(t.page)
    expect(t.ls()).toEqual(['The storm.md'])
  })

  test('a draft left empty leaves no file behind', async ({ launch }) => {
    const t = await launch()
    await t.setText('x\n')
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

  test('a file outside the open folders that is renamed in Finder keeps saving', async ({ launch }) => {
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

test.describe('fixes from the third review', () => {
  test('saving a symlinked document changes the file it points to, and keeps the link', async ({ launch }) => {
    const t = await launch()
    const real = join(t.outside, 'Real.md')
    writeFileSync(real, 'real words')
    symlinkSync(real, join(t.lib, 'Link.md'))
    await t.open(join(t.lib, 'Link.md'))
    await expect(t.page.locator('#title')).toHaveText('Link')
    await t.select((await t.text()).length)
    await t.page.keyboard.insertText(' and more')
    await settle(t.page)
    expect(readFileSync(real, 'utf8')).toBe('real words and more')
    expect(lstatSync(join(t.lib, 'Link.md')).isSymbolicLink()).toBe(true)
  })

  test('saving keeps a file’s permissions', async ({ launch }) => {
    const t = await launch({ files: { 'Shared.md': 'team notes' } })
    chmodSync(join(t.lib, 'Shared.md'), 0o664)
    await t.open(join(t.lib, 'Shared.md'))
    await expect(t.page.locator('#title')).toHaveText('Shared')
    await t.select((await t.text()).length)
    await t.page.keyboard.insertText('!')
    await settle(t.page)
    expect(t.read('Shared.md')).toBe('team notes!')
    expect(statSync(join(t.lib, 'Shared.md')).mode & 0o777).toBe(0o664)
  })

  test('mixed line endings don’t make a “changed elsewhere” copy', async ({ launch }) => {
    const t = await launch({ files: { 'Mixed.md': 'one\r\ntwo\nthree' } })
    await t.open(join(t.lib, 'Mixed.md'))
    await expect(t.page.locator('#title')).toHaveText('Mixed')
    await t.select((await t.text()).length)
    await t.page.keyboard.insertText(' four')
    await settle(t.page)
    expect(t.ls()).toEqual(['Mixed.md'])
    expect(t.read('Mixed.md').replace(/\r/g, '')).toBe('one\ntwo\nthree four')
  })

  test('a file that isn’t UTF-8 is refused rather than corrupted', async ({ launch }) => {
    const t = await launch({ files: { 'Latin.txt': Buffer.from([0x63, 0x61, 0x66, 0xe9]) } })
    await t.open(join(t.lib, 'Latin.txt'))
    await expect(t.page.locator('#toast')).toContainText('isn’t UTF-8')
    await expect(t.page.locator('#title')).toHaveText('Untitled')
    expect(readFileSync(join(t.lib, 'Latin.txt'))).toEqual(Buffer.from([0x63, 0x61, 0x66, 0xe9]))
  })

  test('a new document doesn’t stay tied to a folder you close', async ({ launch }) => {
    const t = await launch()
    await t.command('new')
    await t.command('close-folder')
    await expect(t.page.locator('#toast')).toContainText('Closed')
    await t.page.keyboard.insertText('Homeless words')
    // It asks where to save (rather than failing to save into the closed folder).
    await t.command('save')
    await expect(t.page.locator('.palette input')).toHaveAttribute('placeholder', 'Save this document in…')
    await t.page.keyboard.press('Escape')
    expect(t.ls()).toEqual([])
  })

  test('a document with front matter opens showing its Properties box', async ({ launch }) => {
    const t = await launch({ files: { 'Story.md': '---\ntitle: The Beast\n---\n\n# Chapter 1\n\nText.' } })
    await t.open(join(t.lib, 'Story.md'))
    await expect(t.page.locator('.md-properties')).toBeVisible()
    await expect(t.page.locator('.md-prop-value')).toHaveText(['The Beast'])
  })

  test('Back after a draft renamed itself on the way out still returns to it', async ({ launch }) => {
    const t = await launch({ files: { 'Other.md': 'other' } })
    await t.command('new')
    await t.page.keyboard.insertText('Hello')
    await settle(t.page)
    await t.page.keyboard.insertText(' world')
    // Leave before the autosave: leaving saves, and renames it "Hello world".
    await t.open(join(t.lib, 'Other.md'))
    await expect(t.page.locator('#title')).toHaveText('Other')
    await t.command('back')
    await expect(t.page.locator('#title')).toHaveText('Hello world')
    await t.command('forward')
    await expect(t.page.locator('#title')).toHaveText('Other')
  })
})

test.describe('typewriter focus', () => {
  test('keeps the line you’re typing near the middle of the window, without dimming', async ({ launch }) => {
    const t = await launch()
    await t.setText(Array.from({ length: 120 }, (_, i) => `Line ${i + 1} of a long story.`).join('\n\n'))
    await t.command('focus-typewriter')
    await expect.poll(() => t.savedSettings().focus).toBe('typewriter')
    /** How far down the window the cursor is (0 = top, 1 = bottom). */
    const where = (): Promise<number> =>
      t.page.evaluate(() => {
        const v = (window as never as { typr: { view: import('@codemirror/view').EditorView } }).typr.view
        const c = v.coordsAtPos(v.state.selection.main.head)
        const box = v.scrollDOM.getBoundingClientRect()
        return c ? (c.top - box.top) / box.height : -1
      })
    await t.page.keyboard.insertText(' More.')
    await expect.poll(where).toBeGreaterThan(0.35)
    expect(await where()).toBeLessThan(0.65)
    // Moving up with the keyboard keeps it there too.
    for (let i = 0; i < 12; i++) await t.page.keyboard.press('ArrowUp')
    await expect.poll(where).toBeGreaterThan(0.35)
    expect(await where()).toBeLessThan(0.65)
    // Nothing is dimmed.
    await expect(t.page.locator('.cm-dim')).toHaveCount(0)
    // It's the fourth choice in View › Focus, ticked; ⌘D cycles through all four.
    const focusMenu = await t.app.evaluate(({ Menu }) => {
      const view = Menu.getApplicationMenu()!.items.find((m) => m.label === 'View')!.submenu!
      const focus = view.items.find((i) => i.label === 'Focus')!.submenu!
      return focus.items.filter((i) => i.type === 'radio').map((i) => `${i.label}${i.checked ? ' ✓' : ''}`)
    })
    expect(focusMenu).toEqual(['Off', 'Paragraph', 'Sentence', 'Typewriter ✓'])
    await t.command('focus-cycle')
    await expect.poll(() => t.savedSettings().focus).toBe('off')
  })
})
