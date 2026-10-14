import { mkdirSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { contextProbe } from '../../src/shared/ipc'
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
    expect(find('View')).toEqual([
      'Show Sidebar [CmdOrCtrl+\\]',
      'Show Markdown [CmdOrCtrl+E]',
      'Focus',
      'Bigger Text [CmdOrCtrl+Plus]',
      'Smaller Text [CmdOrCtrl+-]',
      'Actual Size [CmdOrCtrl+0]',
      'Appearance',
      'Command Palette… [CmdOrCtrl+Shift+P]'
    ])
    expect(find('Edit').slice(-3)).toEqual(['Add Comment [CmdOrCtrl+Shift+M]', 'Go to Comment…', 'Resolve Comment'])
    expect(find('Edit').some((i) => i.startsWith('Insert'))).toBe(false)
    expect(find('Help')).toEqual(['Typr Website', 'Report a Problem'])
    expect(find('Typr')).not.toContain('Settings… [CmdOrCtrl+,]')
    expect(find('Typr')).toContain('Check for Updates…')
    expect(find('File')).toEqual([
      'New [CmdOrCtrl+N]',
      'Open… [CmdOrCtrl+O]',
      'Open Recent',
      'Open Folder… [CmdOrCtrl+Shift+O]',
      'Close Folder…',
      'Save [CmdOrCtrl+S]',
      'Rename… [CmdOrCtrl+Shift+R]',
      'Show in Finder',
      'Move to Trash',
      'Close Document [CmdOrCtrl+W]'
    ])
    expect(find('File').some((i) => i.startsWith('Close Window'))).toBe(false)
    expect(find('Typr')).toEqual(expect.arrayContaining(['Hide Others [Command+Alt+H]', 'Show All']))
    expect(find('Format')).toEqual([
      'Bold [CmdOrCtrl+B]',
      'Italic [CmdOrCtrl+I]',
      'Underline [CmdOrCtrl+U]',
      'Strikethrough [CmdOrCtrl+Shift+X]',
      'Inline Code [CmdOrCtrl+Shift+C]',
      'Link [CmdOrCtrl+K]',
      'Image…',
      'Table'
    ])
    expect(menus.map((m) => m.label)).toEqual(['Typr', 'File', 'Edit', 'Format', 'View', 'Go', 'Window', 'Help'])
  })

  test('the palette lists commands with ticks for current settings', async ({ launch }) => {
    const t = await launch({ settings: { focus: 'paragraph' } })
    await t.command('palette')
    const items = await t.page.locator('.palette-item').allInnerTexts()
    expect(items.some((i) => /Focus: Paragraph\s*✓/.test(i))).toBe(true)
    expect(items.some((i) => /Appearance: Dark/.test(i))).toBe(true)
    await t.page.keyboard.press('Escape')
  })

  test('the palette only offers what can be done, shows ticks with shortcuts, and lists recent commands first', async ({
    launch
  }) => {
    const t = await launch({ files: { 'Note.md': 'A {==note==}{>>check<<} and [a link](https://example.com).' } })
    const labels = async (): Promise<string[]> => {
      await t.command('palette')
      const items = await t.page.locator('.palette-item .label').allInnerTexts()
      await t.page.keyboard.press('Escape')
      return items
    }
    // An empty, unsaved page: nothing to go to, resolve or follow. (Show in
    // Finder stays: it shows the folder a new document will go in.)
    let items = await labels()
    for (const absent of ['Go to Comment…', 'Resolve Comment', 'Follow Link', 'Remove from Open Files', 'Go Back']) {
      expect(items).not.toContain(absent)
    }
    await t.open(join(t.lib, 'Note.md'))
    await expect(t.page.locator('#title')).toHaveText('Note')
    await t.selectText('note')
    items = await labels()
    expect(items).toEqual(expect.arrayContaining(['Go to Comment…', 'Resolve Comment', 'Show in Finder']))
    expect(items).not.toContain('Follow Link')
    await t.selectText('a link')
    expect(await labels()).toContain('Follow Link')
    // A setting that's on shows both its tick and its shortcut.
    await t.command('toggle-markdown')
    await t.command('palette')
    await expect(t.page.locator('.palette-item', { hasText: 'Show Markdown' }).locator('.hint')).toHaveText(/✓\s+⌘E/)
    // Run a command from the palette: next time it's at the top.
    await expect(t.page.locator('.palette input')).toBeFocused()
    await t.page.keyboard.insertText('Focus: Typewriter')
    await t.page.keyboard.press('Enter')
    await expect.poll(() => t.savedSettings().focus).toBe('typewriter')
    expect((await labels())[0]).toBe('Focus: Typewriter')
  })

  test('right-clicking a link offers to open it', async ({ launch }) => {
    const t = await launch({ files: { 'Note.md': 'Read [the guide](https://example.com/guide) today.' } })
    await t.open(join(t.lib, 'Note.md'))
    await expect(t.page.locator('#title')).toHaveText('Note')
    await t.select(0)
    // Asked exactly the way the main process asks when you right-click.
    const probe = (x: number, y: number): Promise<unknown> =>
      t.app.evaluate(
        ({ BrowserWindow }, js) => BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(js),
        contextProbe(x, y)
      )
    const box = (await t.page.locator('.cm-content .md-link').first().boundingBox())!
    const middle = box.y + box.height / 2
    expect(await probe(box.x + box.width / 2, middle)).toEqual({
      inEditor: true,
      selection: false,
      link: 'https://example.com/guide'
    })
    // Off to the right of the line, it isn't the link any more.
    const line = (await t.page.locator('.cm-content').boundingBox())!
    expect(await probe(line.x + line.width - 4, middle)).toEqual({ inEditor: true, selection: false, link: null })
    expect(await probe(5, 5)).toEqual({ inEditor: false, selection: false, link: null })
  })

  test('View › Appearance switches System / Light / Dark, ticked and saved', async ({ launch }) => {
    const t = await launch()
    const appearance = (): Promise<{ label: string; checked: boolean }[]> =>
      t.app.evaluate(({ Menu }) => {
        const view = Menu.getApplicationMenu()!.items.find((m) => m.label === 'View')!.submenu!
        const sub = view.items.find((i) => i.label === 'Appearance')!.submenu!
        return sub.items.map((i) => ({ label: i.label, checked: i.checked }))
      })
    expect(await appearance()).toEqual([
      { label: 'System', checked: false },
      { label: 'Light', checked: true },
      { label: 'Dark', checked: false }
    ])
    await t.command('theme-dark')
    await expect.poll(() => t.savedSettings().theme).toBe('dark')
    await expect.poll(async () => (await appearance()).find((i) => i.checked)?.label).toBe('Dark')
    // The app switches to dark (the window follows macOS's appearance; an invisible
    // test window doesn't receive that change, so check the app itself).
    expect(await t.app.evaluate(({ nativeTheme }) => [nativeTheme.themeSource, nativeTheme.shouldUseDarkColors])).toEqual([
      'dark',
      true
    ])
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
    await t.page.keyboard.insertText('# Chapter two\n')
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

test.describe('open files', () => {
  test('a file opened from outside the folders stays in Open Files, and follows renames', async ({ launch }) => {
    const t = await launch({ files: { 'Note.md': '# Note' }, settings: { sidebar: true } })
    const loose = join(t.outside, 'Loose idea.md')
    writeFileSync(loose, 'an idea')
    await t.open(loose)
    await expect(t.page.locator('#title')).toHaveText('Loose idea')
    await expect(t.page.locator('.sidebar-header')).toHaveText(['Open Files', 'library'])
    await expect(t.page.locator('.sidebar-open-files .file')).toHaveText(['Loose idea'])
    await expect.poll(() => t.savedSettings().files).toEqual([loose])
    // It's in Go to File, from another document.
    await t.command('new')
    await t.command('quick-open')
    await expect(t.page.locator('.palette-item .label')).toContainText(['Loose idea'])
    await t.page.keyboard.press('Escape')
    // Renaming it keeps it in the list under its new name.
    await t.open(loose)
    await expect(t.page.locator('#title')).toHaveText('Loose idea')
    await t.command('rename')
    await expect(t.page.locator('.palette input')).toBeFocused()
    await t.page.keyboard.press('Meta+a')
    await t.page.keyboard.insertText('Better idea')
    await t.page.keyboard.press('Enter')
    await expect(t.page.locator('.sidebar-open-files .file')).toHaveText(['Better idea'])
    // Removing it from the list leaves the file alone.
    await t.command('forget-file')
    await expect(t.page.locator('.sidebar-open-files')).toHaveCount(0)
    expect(readdirSync(t.outside)).toContain('Better idea.md')
  })

  test('opening the folder a file lives in moves it out of Open Files', async ({ launch }) => {
    const t = await launch({ settings: { sidebar: true } })
    const dir = join(t.outside, 'Drafts')
    mkdirSync(dir)
    const file = join(dir, 'Draft.md')
    writeFileSync(file, 'draft')
    await t.open(file)
    await expect(t.page.locator('.sidebar-open-files .file')).toHaveText(['Draft'])
    await t.app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as never
    }, dir)
    await t.command('open-folder')
    await expect(t.page.locator('.sidebar-header')).toHaveText(['library', 'Drafts'])
    await expect(t.page.locator('.sidebar-open-files')).toHaveCount(0)
    await expect.poll(() => t.savedSettings().files).toEqual([])
  })
})

test.describe('updates', () => {
  test('Check for Updates says when there’s a newer release, and when you’re up to date', async ({ launch }) => {
    const t = await launch()
    // Stand in for GitHub and the dialog, so nothing goes to the network or appears on screen.
    const check = async (tag: string): Promise<string> => {
      await t.app.evaluate(({ net, dialog }, tag) => {
        const g = globalThis as never as { __shown: string[]; __real?: { fetch: unknown; box: unknown } }
        g.__real ??= { fetch: net.fetch, box: dialog.showMessageBox }
        g.__shown = []
        net.fetch = (async () =>
          new Response(JSON.stringify({ tag_name: tag, html_url: 'https://example.com', assets: [] }), { status: 200 })) as never
        dialog.showMessageBox = (async (...args: unknown[]) => {
          const opts = (args.length > 1 ? args[1] : args[0]) as { message: string }
          g.__shown.push(opts.message)
          return { response: 1, checkboxChecked: false }
        }) as never
      }, tag)
      await t.command('check-updates')
      return t.app.evaluate(() => (globalThis as never as { __shown: string[] }).__shown.join(' | '))
    }
    try {
      await expect.poll(() => check('v9.0.0')).toBe('Typr 9.0.0 is available')
      await expect.poll(() => check('v1.0.0')).toBe('Typr is up to date')
    } finally {
      // The app is shared by every test (and loads images with net.fetch): put the real ones back.
      await t.app.evaluate(({ net, dialog }) => {
        const g = globalThis as never as { __real?: { fetch: typeof net.fetch; box: typeof dialog.showMessageBox } }
        if (g.__real) Object.assign(net, { fetch: g.__real.fetch }) && Object.assign(dialog, { showMessageBox: g.__real.box })
        delete g.__real
      })
    }
  })
})
