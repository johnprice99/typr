import { mkdirSync, readdirSync, writeFileSync } from 'fs'
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
    expect(find('Edit')).toContain('Find and Replace… [CmdOrCtrl+Shift+F]')
    expect(find('View')).toContain('Command Palette… [CmdOrCtrl+Shift+P]')
    expect(find('File')).toContain('Rename… [CmdOrCtrl+Shift+R]')
    expect(find('Format')).toEqual([
      'Bold [CmdOrCtrl+B]',
      'Italic [CmdOrCtrl+I]',
      'Underline [CmdOrCtrl+U]',
      'Strikethrough [CmdOrCtrl+Shift+X]',
      'Inline Code [CmdOrCtrl+Shift+C]',
      'Link [CmdOrCtrl+K]'
    ])
    expect(menus.map((m) => m.label)).toEqual(['Typr', 'File', 'Edit', 'Format', 'View', 'Go', 'Window'])
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
    await expect(t.page.locator('.setting-label')).toHaveText(['Appearance', 'Text size'])
    await expect(t.page.locator('.stepper-value')).toHaveText('100%')
    await t.page.keyboard.press('ArrowRight') // Appearance: Light → Dark
    await expect(t.page.locator('.segmented [aria-checked=true]').first()).toHaveText('Dark')
    await expect.poll(() => t.savedSettings().theme).toBe('dark')
    await t.page.keyboard.press('Escape')
  })

  test('with no folder open, a new document asks where to go when you save', async ({ launch }) => {
    const t = await launch({ settings: { folders: [] } })
    await expect(t.page.locator('.sidebar-empty')).toContainText('No folders open')
    await t.setText('Words with nowhere to go')
    await expect(t.page.locator('#stats')).toContainText('Not saved yet')
    await t.command('save')
    await expect(t.page.locator('.palette input')).toHaveAttribute('placeholder', 'Save this document in…')
    await expect(t.page.locator('.palette-item .label')).toHaveText(['Choose a folder…'])
    await t.page.keyboard.press('Escape')
    // Leaving the document asks too, and stays put if you don't choose.
    await t.command('new')
    await expect(t.page.locator('.palette input')).toHaveAttribute('placeholder', 'Save this document in…')
    await t.page.keyboard.press('Escape')
    expect(await t.text()).toBe('Words with nowhere to go')
  })

  test('several folders show in the sidebar; each collapses, and new documents go next to the open one', async ({ launch }) => {
    const t = await launch({ files: { 'Note.md': '# Note' } })
    const stories = join(t.outside, 'Stories')
    mkdirSync(stories)
    writeFileSync(join(stories, 'Chapter.md'), '# Chapter')
    await t.app.evaluate(
      async (_e, folders) => {
        const g = globalThis as never as { __typrReset: (s: unknown) => Promise<void> }
        await g.__typrReset({
          folders,
          focus: 'off',
          theme: 'light',
          window: { maximized: false, bounds: { x: 60, y: 40, width: 1200, height: 900 } }
        })
      },
      [t.lib, stories]
    )
    await t.page.waitForFunction(() => (window as never as { typr?: { ready: boolean } }).typr?.ready === true)
    await t.command('toggle-sidebar')
    await expect(t.page.locator('.sidebar-header')).toHaveText(['library', 'Stories'])
    await expect(t.page.locator('#sidebar .file')).toHaveText(['Note', 'Chapter'])
    await t.page.locator('.sidebar-header').nth(1).click()
    await expect(t.page.locator('#sidebar .file:visible')).toHaveText(['Note'])
    // Two folders and nothing open: no guessing. Open a story, then New goes beside it.
    await t.open(join(stories, 'Chapter.md'))
    await expect(t.page.locator('#title')).toHaveText('Chapter')
    await t.command('new')
    await t.page.keyboard.insertText('# Chapter two')
    await settle(t.page)
    expect(readdirSync(stories).sort()).toEqual(['Chapter two.md', 'Chapter.md'])
    await t.command('close-folder', stories)
    await expect(t.page.locator('.sidebar-header')).toHaveText(['library'])
    // Its files leave Go to File too, even ones you opened recently.
    await t.command('quick-open')
    await expect(t.page.locator('.palette-item .label')).toHaveText(['Note'])
  })

  test('subfolders start collapsed; the way to the open document opens', async ({ launch }) => {
    const t = await launch({ files: { 'Top.md': 'top', 'Book/Part 1/Chapter.md': 'ch', 'Book/Part 2/Other.md': 'x' } })
    await t.command('toggle-sidebar')
    await expect(t.page.locator('#sidebar .file:visible')).toHaveText(['Top'])
    await t.open(join(t.lib, 'Book/Part 1/Chapter.md'))
    await expect(t.page.locator('#sidebar .file:visible')).toHaveText(['Chapter', 'Top'])
    // "Part 2" stays collapsed until you open it.
    await t.page.locator('#sidebar .folder', { hasText: 'Part 2' }).click()
    await expect(t.page.locator('#sidebar .file:visible')).toHaveText(['Chapter', 'Other', 'Top'])
    // Collapsing the whole folder is remembered too.
    await t.page.locator('.sidebar-header').click()
    await expect(t.page.locator('#sidebar .file:visible')).toHaveCount(0)
  })

  test('folders that only hold pictures stay out of the sidebar', async ({ launch }) => {
    const t = await launch({ files: { 'Pictures/a.png': 'x', 'Stories/One.md': '# One' } })
    const entries = await t.page.evaluate(() => window.api.init().then((s) => s.folders[0].entries))
    expect(entries).toEqual(['Stories/', 'Stories/One.md'])
  })

  test('files outside the open folders can only be changed if Typr opened them', async ({ launch }) => {
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

test.describe('file-system guards', () => {
  test('".." cannot be used to reach outside the open folders', async ({ launch }) => {
    const t = await launch()
    const tricks = await t.page.evaluate(async (lib) => {
      const attempt = (p: Promise<unknown>): Promise<string> =>
        p.then(
          () => 'allowed',
          (e) => String(e)
        )
      return {
        trashParent: await attempt(window.api.trash(`${lib}/..`)),
        trashUp: await attempt(window.api.trash(`${lib}/../../x.md`)),
        createUp: await attempt(window.api.create(`${lib}/../..`, 'escape', 'x')),
        renameFolder: await attempt(window.api.rename(lib, 'Renamed')),
        setFolders: await attempt(window.api.setSetting('folders', ['/']))
      }
    }, t.lib)
    for (const [what, result] of Object.entries(tricks)) expect(result, what).not.toBe('allowed')
  })

  test('a new document named with ".." stays inside the folder', async ({ launch }) => {
    const t = await launch()
    await t.command('quick-open')
    await t.page.keyboard.insertText('../../Escape')
    await t.page.locator('.palette-item', { hasText: 'New document' }).click()
    await expect(t.page.locator('#title')).toHaveText('Escape')
    await t.page.keyboard.insertText('hi')
    await settle(t.page)
    expect(t.ls()).toContain('Escape.md')
  })
})

test.describe('remote images and fonts', () => {
  test('remote images wait for a click before loading', async ({ launch }) => {
    const t = await launch()
    let requests = 0
    // A stand-in for the internet, so nothing leaves the machine.
    await t.page.route('https://images.example.test/**', (route) => {
      requests++
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGNoaGhgYGBgYGBgYGBgAAAJ+AEB1l5xfgAAAABJRU5ErkJggg==',
        'base64'
      )
      return route.fulfill({ status: 200, contentType: 'image/png', body: png })
    })
    await t.setText('![harbour](https://images.example.test/harbour.png)\n\nEnd.')
    await expect(t.page.locator('.md-remote-img')).toContainText('Click to load')
    expect(requests).toBe(0)
    await t.page.locator('.md-remote-img').dispatchEvent('mousedown')
    await expect.poll(() => t.page.evaluate(() => document.querySelector<HTMLImageElement>('.md-img')?.naturalWidth)).toBe(2)
    expect(requests).toBe(1)
  })

  test('the Markdown view uses the Mac’s built-in monospace font', async ({ launch }) => {
    const t = await launch({ settings: { showMarkdown: true } })
    const usesMenlo = await t.page.evaluate(() => {
      const c = document.createElement('canvas').getContext('2d')!
      const box = (font: string): string => {
        c.font = `40px ${font}`
        const m = c.measureText('Hgjy@')
        return `${m.width}|${m.actualBoundingBoxAscent}|${m.actualBoundingBoxDescent}`
      }
      const editorFont = getComputedStyle(document.querySelector('.cm-scroller')!).fontFamily
      return box(editorFont) === box('Menlo') && box('Menlo') !== box('Courier')
    })
    expect(usesMenlo).toBe(true)
  })
})

test.describe('opening folders', () => {
  test('Open Folder adds the chosen folder to the sidebar', async ({ launch }) => {
    const t = await launch({ files: { 'Note.md': '# Note' } })
    const other = join(t.outside, 'Typr')
    mkdirSync(other)
    writeFileSync(join(other, 'Scratch pad.md'), 'scratch')
    // Stand in for the folder chooser.
    await t.app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as never
    }, other)
    await t.command('open-folder')
    await t.command('toggle-sidebar')
    await expect(t.page.locator('.sidebar-header')).toHaveText(['library', 'Typr'])
    await expect.poll(() => t.savedSettings().folders).toEqual([t.lib, other])
  })
})

test.describe('folder order', () => {
  test('drag a folder header to reorder; the order is remembered', async ({ launch }) => {
    const t = await launch({ files: { 'Note.md': '# Note' } })
    const stories = join(t.outside, 'Stories')
    mkdirSync(stories)
    writeFileSync(join(stories, 'Chapter.md'), '# Chapter')
    await t.app.evaluate(
      async (_e, folders) => {
        const g = globalThis as never as { __typrReset: (s: unknown) => Promise<void> }
        await g.__typrReset({
          folders,
          sidebar: true,
          focus: 'off',
          theme: 'light',
          window: { maximized: false, bounds: { x: 60, y: 40, width: 1200, height: 900 } }
        })
      },
      [t.lib, stories]
    )
    await t.page.waitForFunction(() => (window as never as { typr?: { ready: boolean } }).typr?.ready === true)
    await expect(t.page.locator('.sidebar-header')).toHaveText(['library', 'Stories'])
    await t.page
      .locator('.sidebar-header', { hasText: 'Stories' })
      .dragTo(t.page.locator('.sidebar-header', { hasText: 'library' }), {
        targetPosition: { x: 20, y: 2 }
      })
    await expect(t.page.locator('.sidebar-header')).toHaveText(['Stories', 'library'])
    await expect.poll(() => t.savedSettings().folders).toEqual([stories, t.lib])
  })

  test('a reorder must be the same folders (it cannot add one)', async ({ launch }) => {
    const t = await launch()
    const result = await t.page.evaluate(
      (lib) =>
        window.api.reorderFolders([lib, '/']).then(
          () => 'allowed',
          (e) => String(e)
        ),
      t.lib
    )
    expect(result).toContain('exactly the open folders')
  })
})
