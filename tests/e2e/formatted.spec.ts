import { writeFileSync } from 'fs'
import { join } from 'path'
import { expect, test } from './fixtures'

const png = (): Buffer =>
  // 2×2 grey PNG
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGNoaGhgYGBgYGBgYGBgAAAJ+AEB1l5xfgAAAABJRU5ErkJggg==',
    'base64'
  )

test.describe('the formatted view', () => {
  test('hides Markdown away from the cursor and shows it where you edit', async ({ launch }) => {
    const t = await launch()
    await t.setText('# The Storm\n\nIt was a **dark** night. See [the map](https://example.com) and [[Mara]].\n\nEnd.')
    expect(await t.lineShown(1)).toBe('The Storm')
    // [[double brackets]] and [single ones] are just text.
    expect(await t.lineShown(3)).toBe('It was a dark night. See the map and [[Mara]].')
    await t.select(3)
    expect(await t.lineShown(1)).toBe('# The Storm')
    const doc = await t.text()
    await t.select(doc.indexOf('dark') + 1)
    expect(await t.lineShown(3)).toContain('**dark**')
  })

  test('draws bullets and clickable checkboxes, indented', async ({ launch }) => {
    const t = await launch()
    await t.setText('Body text\n\n- first\n  - nested\n- [ ] buy bread\n\nEnd.')
    await expect(t.page.locator('.md-bullet')).toHaveCount(2)
    await expect(t.page.locator('.md-check')).toHaveCount(1)
    const x = (needle: string): Promise<number> =>
      t.page.evaluate((n) => {
        const v = (window as never as { typr: { view: import('@codemirror/view').EditorView } }).typr.view
        return Math.round(v.coordsAtPos(v.state.doc.toString().indexOf(n))!.left)
      }, needle)
    const body = await x('Body')
    expect(await x('first')).toBeGreaterThan(body)
    expect(await x('buy')).toBe(await x('first'))
    expect(await x('nested')).toBeGreaterThan(await x('first'))
    await t.page.locator('.md-check').dispatchEvent('mousedown')
    expect(await t.text()).toContain('- [x] buy bread')
  })

  test('renders tables; arrows step into them and Tab moves between cells', async ({ launch }) => {
    const t = await launch()
    await t.setText('Above\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nBelow')
    await expect(t.page.locator('.md-table-widget th')).toHaveText(['A', 'B'])
    await t.select(2)
    await t.page.keyboard.press('ArrowDown')
    await t.page.keyboard.press('ArrowDown')
    await expect(t.page.locator('.md-table-widget')).toHaveCount(0)
    await t.select((await t.text()).length)
    await t.page.keyboard.press('ArrowUp')
    await t.page.keyboard.press('ArrowUp')
    await expect(t.page.locator('.md-table-widget')).toHaveCount(0)
  })

  test('Insert Table, then Tab through the cells', async ({ launch }) => {
    const t = await launch()
    await t.setText('')
    await t.command('table')
    for (const [text, tab] of [
      ['Name', true],
      ['Age', true],
      ['Ann', true],
      ['42', true],
      ['Bob', false]
    ] as const) {
      await t.page.keyboard.insertText(text)
      if (tab) await t.page.keyboard.press('Tab')
    }
    expect(await t.text()).toBe('| Name | Age |\n| --- | --- |\n| Ann | 42 |\n| Bob |  |\n')
  })

  test('folds code fences away until you edit the block', async ({ launch }) => {
    const t = await launch()
    await t.setText('```js\nconst a = 1\n```\n\nThe end.')
    await expect(t.page.locator('.md-fence')).toHaveCount(2)
    expect(await t.lineShown(1)).toBe('')
    await t.select(8)
    await expect(t.page.locator('.md-fence')).toHaveCount(0)
  })

  test('shows images from relative and absolute links, and keeps the cursor aligned', async ({ launch }) => {
    const t = await launch({ files: { 'Pictures/Harbour map.png': png(), 'Stories/Trip.md': '' } })
    const outsidePic = join(t.outside, 'outside (2).png')
    writeFileSync(outsidePic, png())
    const abs = encodeURI(outsidePic).replace(/\(/g, '%28').replace(/\)/g, '%29')
    writeFileSync(join(t.lib, 'Stories/Trip.md'), `# Trip\n\n![map](../Pictures/Harbour%20map.png)\n\n![out](${abs})\n\nEnd.`)
    await t.open(join(t.lib, 'Stories/Trip.md'))
    await expect(t.page.locator('#title')).toHaveText('Trip')
    await t.select((await t.text()).length)
    await expect
      .poll(() => t.page.evaluate(() => [...document.querySelectorAll<HTMLImageElement>('.md-img')].map((i) => i.naturalWidth)))
      .toEqual([2, 2])
    // The editor re-measures on the frame after the images load.
    await expect
      .poll(() =>
        t.page.evaluate(() => {
          const v = (window as never as { typr: { view: import('@codemirror/view').EditorView } }).typr.view
          const cursor = document.querySelector('.cm-cursor')!.getBoundingClientRect()
          return Math.abs(cursor.top - v.coordsAtPos(v.state.selection.main.head)!.top) < 3
        })
      )
      .toBe(true)
  })

  test('a stray % in a link does not break the page', async ({ launch }) => {
    const t = await launch()
    await t.setText('![x](100%.png) and **bold**\n\nEnd.')
    expect(await t.lineShown(1)).toContain('and bold')
  })

  test('Show Markdown switches to the plain view', async ({ launch }) => {
    const t = await launch()
    await t.setText('# Title\n\nEnd.')
    await t.command('toggle-markdown')
    await expect(t.page.locator('.cm-live')).toHaveCount(0)
    expect(await t.lineShown(1)).toBe('# Title')
  })

  test('Insert Link leaves the address empty; pasting a URL onto text links it', async ({ launch }) => {
    const t = await launch()
    await t.setText('See the map here.')
    await t.selectText('the map')
    await t.command('link')
    expect(await t.text()).toBe('See [the map]() here.')
    await t.setText('The harbour was quiet.')
    await t.selectText('harbour')
    await t.page.evaluate(() => {
      const dt = new DataTransfer()
      dt.setData('text/plain', 'https://harbour.example.com')
      document
        .querySelector('.cm-content')!
        .dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    })
    expect(await t.text()).toBe('The [harbour](https://harbour.example.com) was quiet.')
  })

  test('focus lights one block at a time, and dimmed links stay underlined', async ({ launch }) => {
    const t = await launch({ settings: { focus: 'paragraph' } })
    await t.setText('# Title\n## Sub\nA paragraph with [a link](https://x.com).\n\nAnother paragraph.', 2)
    const lit = (): Promise<string[]> =>
      t.page.evaluate(() =>
        [...document.querySelectorAll('.cm-content > .cm-line')]
          .filter((l) => l.textContent && !l.querySelector('.cm-dim'))
          .map((l) => l.textContent!)
      )
    // The cursor is on the heading, so its "#" shows; only that block is lit.
    expect(await lit()).toEqual(['# Title'])
    const deco = await t.page.evaluate(() => {
      const link = document.querySelector('.md-link')!
      return getComputedStyle(link.querySelector('.cm-dim') ?? link).textDecorationLine
    })
    expect(deco).toBe('underline')
  })
})

test.describe('find', () => {
  test('counts matches, matches case only when you type a capital, closes when you leave', async ({ launch }) => {
    const t = await launch()
    await t.setText('the cat and the dog and THE end')
    await t.command('find')
    await t.page.keyboard.type('the')
    await expect(t.page.locator('.find-count').first()).toHaveText('1 of 3')
    await t.page.keyboard.type('T')
    await expect(t.page.locator('.find-count').first()).toHaveText('No results')
    await expect(t.page.locator('.find input').first()).toHaveValue('theT')
    await t.page.locator('.cm-content').click()
    await expect(t.page.locator('.find')).toHaveCount(0)
  })

  test('replace all', async ({ launch }) => {
    const t = await launch()
    await t.setText('the cat and the dog and THE end')
    await t.command('replace')
    await t.page.locator('.find input').first().fill('and')
    await t.page.locator('.find input').nth(1).fill('&')
    await t.page.locator('.find input').nth(1).press('Meta+Enter')
    expect(await t.text()).toBe('the cat & the dog & THE end')
    await t.page.keyboard.press('Escape')
    await expect(t.page.locator('.find')).toHaveCount(0)
  })
})

test.describe('find after editing', () => {
  test('typing in Find after Replace All shrinks the text does not crash', async ({ launch }) => {
    const t = await launch()
    await t.setText('aaaa bbbb aaaa bbbb aaaa bbbb')
    await t.command('replace')
    await t.page.locator('.find input').first().fill('aaaa')
    await t.page.locator('.find input').nth(1).fill('a')
    await t.page.locator('.find input').nth(1).press('Meta+Enter')
    await t.page.locator('.find input').first().focus()
    await t.page.keyboard.type('b')
    await expect(t.page.locator('.find-count').first()).toHaveText('No results')
    expect(t.errors).toEqual([])
  })
})
