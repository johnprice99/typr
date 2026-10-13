import { _electron as electron, ElectronApplication, expect, Page, test as base } from '@playwright/test'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join, resolve } from 'path'

// The real, built app is launched once per run (invisible, no Dock icon) and
// reset before each test with a throwaway folder (open in the sidebar) and fresh settings.
// Nothing touches your documents, settings or clipboard.

const ROOT = resolve(__dirname, '../..')

export interface LaunchOptions {
  /** Settings to start with (merged over test defaults). */
  settings?: Record<string, unknown>
  /** Files to create in the test's folder: relative path → contents. */
  files?: Record<string, string | Buffer>
}

export interface Typr {
  app: ElectronApplication
  page: Page
  /** Errors logged by the page. */
  errors: string[]
  /** The test's folder, open in the sidebar. */
  lib: string
  /** A temporary folder that isn't open (for "elsewhere" files). */
  outside: string
  userData: string
  /** Runs a command by id, as a menu item or the palette would. */
  command(id: string, path?: string): Promise<void>
  /** Opens a file as Finder would. */
  open(path: string): Promise<void>
  /** The editor's text. */
  text(): Promise<string>
  /** Replaces the editor's text and puts the cursor at `cursor` (default: end). */
  setText(text: string, cursor?: number): Promise<void>
  /** Moves the cursor (or selects from..to). */
  select(from: number, to?: number): Promise<void>
  /** Selects the first (or nth) occurrence of some text. */
  selectText(needle: string, nth?: number): Promise<void>
  /** What a line looks like on screen (Markdown hidden in the formatted view). */
  lineShown(line: number): Promise<string>
  title(): Promise<string>
  toast(): Promise<string>
  /** Files in the test's folder (or a subfolder), sorted. */
  ls(rel?: string): string[]
  read(rel: string): string
  /** The settings file as saved. */
  savedSettings(): Record<string, unknown>
}

interface Running {
  app: ElectronApplication
  page: Page
  errors: string[]
  /** The app's settings folder (one for the whole run). */
  userData: string
}

/** Starts Typr once per run, invisible and without a Dock icon. */
async function start(): Promise<{ running: Running; base: string }> {
  const base = mkdtempSync(join(tmpdir(), 'typr-test-'))
  const userData = join(base, 'user-data')
  mkdirSync(join(base, 'library'), { recursive: true })
  mkdirSync(userData, { recursive: true })
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({ folders: [join(base, 'library')] }))
  const app = await electron.launch({
    args: ['.'],
    cwd: ROOT,
    env: { ...process.env, TYPR_TEST: '1', TYPR_USER_DATA: userData }
  })
  // TYPR_DEBUG=1 shows the app's own output while the tests run.
  if (process.env.TYPR_DEBUG) app.process().stderr?.on('data', (d) => process.stderr.write(`[typr] ${d}`))
  const page = await app.firstWindow()
  if (process.env.TYPR_DEBUG) page.on('console', (m) => process.stderr.write(`[page ${m.type()}] ${m.text()}\n`))
  // The window is invisible and never focused, so tell the page it has focus.
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  const errors: string[] = []
  // A missing image is reported by the browser as a failed load; that's expected, not a bug.
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(String(e)))
  return { running: { app, page, errors, userData }, base }
}

/** Gives a test a fresh library and settings, and reloads the window. */
async function reset({ app, page, errors, userData }: Running, opts: LaunchOptions, dirs: string[]): Promise<Typr> {
  const base = mkdtempSync(join(tmpdir(), 'typr-test-'))
  dirs.push(base)
  const lib = join(base, 'library')
  const outside = join(base, 'elsewhere')
  for (const d of [lib, outside]) mkdirSync(d, { recursive: true })
  for (const [rel, content] of Object.entries(opts.files ?? {})) {
    const p = join(lib, rel)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, content)
  }
  const settings = {
    folders: [lib],
    focus: 'off',
    theme: 'light',
    window: { maximized: false, bounds: { x: 60, y: 40, width: 1200, height: 900 } },
    ...opts.settings
  }
  errors.length = 0
  await app.evaluate(
    async (_electron, s) => (globalThis as never as { __typrReset: (s: unknown) => Promise<void> }).__typrReset(s),
    settings
  )
  await page.waitForFunction(() => (window as never as { typr?: { ready: boolean } }).typr?.ready === true)

  const view = 'window.typr.view'
  const t: Typr = {
    app,
    page,
    errors,
    lib,
    outside,
    userData,
    command: async (id, path) => {
      // Commands arrive as messages; wait until the editor has handled this one.
      const before = (await page.evaluate('window.typr.commands')) as number
      await app.evaluate(({ BrowserWindow }, cmd) => BrowserWindow.getAllWindows()[0].webContents.send('command', cmd), {
        id,
        path
      })
      await page.waitForFunction((n) => (window as never as { typr: { commands: number } }).typr.commands > n, before)
    },
    open: (path) => app.evaluate(({ BrowserWindow }, p) => BrowserWindow.getAllWindows()[0].webContents.send('open', p), path),
    text: () => page.evaluate(`${view}.state.doc.toString()`) as Promise<string>,
    setText: (text, cursor) =>
      page.evaluate(
        ([text, cursor]) => {
          const v = (window as never as { typr: { view: import('@codemirror/view').EditorView } }).typr.view
          v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text as string } })
          v.dispatch({ selection: { anchor: (cursor as number | null) ?? v.state.doc.length } })
          v.focus()
        },
        [text, cursor ?? null]
      ),
    select: (from, to) =>
      page.evaluate(
        ([from, to]) => {
          const v = (window as never as { typr: { view: import('@codemirror/view').EditorView } }).typr.view
          v.dispatch({ selection: { anchor: from as number, head: (to as number | null) ?? (from as number) } })
          v.focus()
        },
        [from, to ?? null]
      ),
    selectText: async (needle, nth = 0) => {
      const doc = await t.text()
      let i = -1
      for (let k = 0; k <= nth; k++) i = doc.indexOf(needle, i + 1)
      if (i < 0) throw new Error(`"${needle}" not found`)
      await t.select(i, i + needle.length)
    },
    lineShown: (line) =>
      page.evaluate((n) => {
        const v = (window as never as { typr: { view: import('@codemirror/view').EditorView } }).typr.view
        const el = [...document.querySelectorAll('.cm-content > .cm-line')].find(
          (e) => v.state.doc.lineAt(v.posAtDOM(e)).number === n
        )
        return el?.textContent ?? '(not rendered)'
      }, line),
    title: () => page.locator('#title').innerText(),
    toast: () => page.locator('#toast').innerText(),
    ls: (rel = '') =>
      readdirSync(join(lib, rel))
        .filter((f) => !f.startsWith('.'))
        .sort(),
    read: (rel) => readFileSync(join(lib, rel), 'utf8'),
    savedSettings: () => JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'))
  }
  return t
}

export const test = base.extend<{ launch: (opts?: LaunchOptions) => Promise<Typr> }, { running: Running }>({
  // One app for the whole run, so macOS isn't asked to launch it over and over.
  running: [
    async ({}, use) => {
      const { running, base } = await start()
      await use(running)
      const closed = await Promise.race([
        running.app.close().then(
          () => true,
          () => true
        ),
        new Promise<boolean>((r) => setTimeout(() => r(false), 10_000))
      ])
      if (!closed) running.app.process().kill('SIGKILL')
      rmSync(base, { recursive: true, force: true })
      if (!closed) throw new Error('the app did not quit within 10 s')
    },
    { scope: 'worker' }
  ],
  launch: async ({ running }, use) => {
    const dirs: string[] = []
    let used = false
    await use(async (opts = {}) => {
      if (used) throw new Error('launch() can only be used once per test')
      used = true
      return reset(running, opts, dirs)
    })
    for (const d of dirs) rmSync(d, { recursive: true, force: true })
    if (running.errors.length) throw new Error(`page errors: ${running.errors.join(' | ')}`)
  }
})

export { expect }

/** Waits for autosave (400 ms) and the file system to settle. */
export const settle = (page: Page, ms = 900): Promise<void> => page.waitForTimeout(ms)
