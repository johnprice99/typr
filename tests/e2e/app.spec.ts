import { join } from 'path'
import { expect, settle, test } from './fixtures'

test.describe('comments', () => {
  test('add, show as a highlight, read on hover, list, edit and resolve', async ({ launch }) => {
    const t = await launch()
    await t.setText('The harbour was quiet that morning.\n\nEnd.')
    await t.selectText('quiet')
    await t.command('comment')
    await expect(t.page.locator('.palette input')).toHaveAttribute('placeholder', 'Comment on “quiet”…')
    await t.page.keyboard.insertText('Too passive?')
    await t.page.keyboard.press('Enter')
    expect(await t.text()).toContain('{==quiet==}{>>Too passive?<<}')

    await t.select((await t.text()).length)
    expect(await t.lineShown(1)).toBe('The harbour was quiet that morning.')
    await expect(t.page.locator('.md-comment')).toHaveText('quiet')
    await expect(t.page.locator('#stats')).toContainText('1 comment')

    // The hover card needs the pointer to arrive and rest, like a real mouse.
    const box = (await t.page.locator('.md-comment').boundingBox())!
    await t.page.mouse.move(box.x + box.width / 2 - 3, box.y + box.height / 2)
    await t.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 3 })
    await expect(t.page.locator('.comment-tip')).toContainText('Too passive?')

    await t.command('comments')
    await expect(t.page.locator('.palette-item')).toHaveCount(1)
    await t.page.keyboard.press('Enter')
    await t.command('comment')
    await expect(t.page.locator('.palette input')).toHaveValue('Too passive?')
    await t.page.keyboard.press('Escape')

    await t.command('resolve-comment')
    expect(await t.text()).toBe('The harbour was quiet that morning.\n\nEnd.')
  })

  test('a comment needs some text to sit on', async ({ launch }) => {
    const t = await launch()
    await t.setText('Words\n\n')
    await t.command('comment')
    await expect(t.page.locator('#toast')).toHaveText('Select some text to comment on')
  })
})

test.describe('links between notes', () => {
  test('following a link to a missing note opens it, and Back returns', async ({ launch }) => {
    const t = await launch()
    await t.setText('Meet [[Bob]]', 8)
    await settle(t.page)
    await t.command('follow-link')
    await expect(t.page.locator('#title')).toHaveText('Bob')
    await expect(t.page.locator('#toast')).toContainText('New note')
    expect(t.ls()).toEqual(['Meet Bob.md'])
    await t.page.keyboard.insertText('Bob is tall.')
    await settle(t.page)
    expect(t.ls()).toEqual(['Bob.md', 'Meet Bob.md'])
    await t.command('back')
    await expect(t.page.locator('#title')).toHaveText('Meet Bob')
  })
})

test.describe('app chrome', () => {
  test('menus have the agreed items and shortcuts', async ({ launch }) => {
    const t = await launch()
    const menus = await t.app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()!.items.map((m) => ({
        label: m.label,
        items: m
          .submenu!.items.filter((i) => i.type !== 'separator' && i.visible)
          .map((i) => `${i.label}${i.accelerator ? ` [${i.accelerator}]` : ''}`)
      }))
    )
    const find = (label: string): string[] => menus.find((m) => m.label === label)!.items
    expect(find('Edit')).toContain('Insert Link [CmdOrCtrl+K]')
    expect(find('Edit')).toContain('Find and Replace… [CmdOrCtrl+Shift+F]')
    expect(find('View')).toContain('Command Palette… [CmdOrCtrl+Shift+P]')
    expect(find('File')).toContain('Rename… [CmdOrCtrl+Shift+R]')
    expect(menus.map((m) => m.label)).toEqual(['Typr', 'File', 'Edit', 'View', 'Go', 'Window'])
  })

  test('the palette lists commands with ticks for current settings', async ({ launch }) => {
    const t = await launch({ settings: { focus: 'paragraph' } })
    await t.command('palette')
    const items = await t.page.locator('.palette-item').allInnerTexts()
    expect(items.some((i) => /Focus: Paragraph\s*✓/.test(i))).toBe(true)
    expect(items.some((i) => /Appearance: Dark/.test(i))).toBe(true)
  })

  test('Settings works from the keyboard and saves', async ({ launch }) => {
    const t = await launch()
    await t.command('settings')
    await expect(t.page.locator('.setting-label')).toHaveText(['Appearance', 'Text size', 'Library'])
    await t.page.keyboard.press('ArrowRight') // Appearance: Light → Dark
    await expect(t.page.locator('.segmented [aria-checked=true]').first()).toHaveText('Dark')
    await expect.poll(() => t.savedSettings().theme).toBe('dark')
    await t.page.keyboard.press('Escape')
  })

  test('first launch asks where writing should live; Esc picks Documents', async ({ launch }) => {
    const t = await launch({ settings: { librarySet: false } })
    await expect(t.page.locator('.palette input')).toHaveAttribute('placeholder', /Where should your writing live/)
    await expect(t.page.locator('.palette-item .label').first()).toHaveText('Documents')
  })

  test('folders that only hold pictures stay out of the library list', async ({ launch }) => {
    const t = await launch({ files: { 'Pictures/a.png': 'x', 'Stories/One.md': '# One' } })
    const files = await t.page.evaluate(() => window.api.init().then((s) => s.files))
    expect(files).toEqual(['Stories/', 'Stories/One.md'])
  })

  test('files outside the library can only be changed if Typr opened them', async ({ launch }) => {
    const t = await launch()
    const stranger = join(t.outside, 'not-mine.md')
    const result = await t.page.evaluate(
      (p) =>
        window.api.trash(p).then(
          () => 'trashed',
          (e) => String(e)
        ),
      stranger
    )
    expect(result).toContain("Typr didn't open")
  })
})
