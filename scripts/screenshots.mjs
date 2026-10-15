// Takes the website's screenshots (docs/images) from the real app, using
// made-up sample documents in a throwaway folder. Run with `npm run screenshots`.
// Like the tests, the app runs invisibly and never touches your own documents or settings.

import { _electron as electron } from '@playwright/test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'docs', 'images')

const SAMPLES = {
  'Stories/The Lantern at Hollow Point.md': `---
title: The Lantern at Hollow Point
status: second draft
words: 4,200
---

# Chapter One

The lighthouse had been dark for eleven years when Mara climbed its stairs with a borrowed key and a tin of oil. The village below pretended not to watch.

She counted the steps, as her father had, and lost count at the same turn of the stair where the wind came through the {==broken pane==}{>>Broken, or just loose? Decide before chapter three.<<}. Somewhere above her, something shifted its weight.

> "Nobody keeps a light for ships that don't come," the harbourmaster had said.

*Somebody has to*, she thought, and {==kept climbing==}{>>Too calm? She should be frightened here.<<}.

## The lamp room

Dust lay on the brass like snow. The great lens was whole, which no one had told her, and in its curved glass she saw the whole bay at once: the boats drawn up, the church, the long grey line of the sea.
`,
  'Stories/Chapter Two.md': '# Chapter Two\n\nThe storm arrived on a Tuesday.\n',
  'Stories/Chapter Three.md': '# Chapter Three\n\nMara found the logbook.\n',
  'Stories/Drafts/Opening (old).md': 'The lighthouse was dark.\n',
  'Notes/Ideas.md': `# Ideas

- [x] Give the harbourmaster a reason to lie
- [ ] Who left the key under the stone?
- [ ] The logbook entries stop on the same date every year

**Ending:** the light comes back on, but not because of Mara.
`,
  'Notes/Characters.md': '# Characters\n\n**Mara** — the keeper’s daughter.\n\n**Elias Penn** — harbourmaster.\n',
  'Notes/Reading list.md': '# Reading list\n\n- *The Rings of Saturn*\n- *Lanny*\n'
}

async function main() {
  const base = mkdtempSync(join(tmpdir(), 'typr-shots-'))
  const userData = join(base, 'user-data')
  mkdirSync(userData, { recursive: true })
  for (const [rel, text] of Object.entries(SAMPLES)) {
    const p = join(base, rel)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, text)
  }
  writeFileSync(
    join(userData, 'settings.json'),
    JSON.stringify({
      folders: [join(base, 'Stories'), join(base, 'Notes')],
      sidebar: true,
      focus: 'off',
      theme: 'light',
      window: { maximized: false, bounds: { x: 40, y: 40, width: 1280, height: 800 } }
    })
  )
  mkdirSync(OUT, { recursive: true })

  const app = await electron.launch({ args: ['.'], cwd: ROOT, env: { ...process.env, TYPR_TEST: '1', TYPR_USER_DATA: userData } })
  try {
    const page = await app.firstWindow()
    await page.waitForFunction(() => window.typr?.ready === true)
    // The window is invisible and never focused, so tell the page it has focus.
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
    let handled = 0
    const command = async (id) => {
      handled = await page.evaluate(() => window.typr.commands)
      await app.evaluate(({ BrowserWindow }, cmd) => BrowserWindow.getAllWindows()[0].webContents.send('command', cmd), { id })
      await page.waitForFunction((n) => window.typr.commands > n, handled)
    }
    const open = async (rel, title) => {
      await app.evaluate(({ BrowserWindow }, p) => BrowserWindow.getAllWindows()[0].webContents.send('open', p), join(base, rel))
      await page.waitForFunction((t) => document.querySelector('#title')?.textContent === t, title)
    }
    /** Puts the cursor at the end of a line containing `text` (so nothing near it shows as Markdown). */
    const cursorAfter = (text) =>
      page.evaluate((needle) => {
        const v = window.typr.view
        const at = v.state.doc.toString().indexOf(needle) + needle.length
        v.dispatch({ selection: { anchor: at } })
        v.contentDOM.blur() // no blinking cursor in the picture
      }, text)
    const shot = async (name) => {
      await page.mouse.move(5, 400) // chrome shows while the mouse moves
      await page.waitForTimeout(500)
      await page.screenshot({ path: join(OUT, `${name}.png`) })
      console.log(`docs/images/${name}.png`)
    }

    await open('Stories/The Lantern at Hollow Point.md', 'The Lantern at Hollow Point')
    await cursorAfter('the long grey line of the sea.')
    await shot('writing-light')

    // Comments live in the file; with the cursor in one, its note shows.
    await page.evaluate(() => {
      const v = window.typr.view
      v.dispatch({ selection: { anchor: v.state.doc.toString().indexOf('broken pane') + 3 } })
      v.contentDOM.blur() // no blinking cursor in the picture
    })
    await page.waitForTimeout(800)
    await shot('comments')

    // The same page in dark, then with focus on the paragraph being written.
    await page.emulateMedia({ colorScheme: 'dark' })
    await cursorAfter('the long grey line of the sea.')
    await shot('writing-dark')
    await command('focus-paragraph')
    await cursorAfter('the long grey line of the sea.')
    await shot('focus-dark')
    await command('focus-off')
    await page.emulateMedia({ colorScheme: 'light' })

    // Everything is a command away.
    await command('palette')
    await page.waitForTimeout(200)
    await shot('palette')
    await page.keyboard.press('Escape')

    await open('Notes/Ideas.md', 'Ideas')
    await cursorAfter('not because of Mara.')
    await shot('notes')
  } finally {
    await app.close().catch(() => {})
    rmSync(base, { recursive: true, force: true })
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
