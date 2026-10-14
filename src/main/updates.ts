import { app, dialog, net, shell } from 'electron'
import type { ChildProcess } from 'child_process'
import { constants, createWriteStream, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { access, mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join, resolve } from 'path'
import { Readable, Transform } from 'stream'
import { pipeline } from 'stream/promises'
import { isNewer } from '../shared/versions'
import { bundleId, cleanLeftovers, installOnExit, signedBy, stageUpdate } from './install'
import { UPDATE_PUBLIC_KEY } from './update-key'
import { testing } from './setup'
import { watchedFile } from './watcher'
import { getWindow, onQuitCancelled, sendToRenderer } from './window'

// Check for Updates: asks GitHub for the newest release and, if it's newer,
// downloads it, checks it's genuine (signed with the developer's key; see
// scripts/sign-update.mjs) and intact, and restarts into it with your document open.
// If Typr can't replace itself (e.g. it's running from the disk image), the
// download opens in the browser instead. Also checks quietly about once a day.

const FEED = 'https://api.github.com/repos/johnprice99/typr/releases/latest'
const DMG = 'Typr-mac-arm64.dmg'
const DAY = 24 * 60 * 60 * 1000

interface Release {
  tag_name: string
  html_url: string
  assets?: { name: string; browser_download_url: string }[]
}

/** The tests point the check at their own release. */
const feed = (): string => (testing && process.env.TYPR_UPDATE_FEED) || FEED

async function latest(): Promise<Release> {
  const res = await net.fetch(feed(), { headers: { Accept: 'application/vnd.github+json' } })
  if (!res.ok) throw new Error(res.status === 404 ? 'No releases have been published yet.' : `GitHub answered ${res.status}.`)
  return (await res.json()) as Release
}

const message = async (opts: Electron.MessageBoxOptions): Promise<number> => {
  const win = getWindow()
  return (win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)).response
}

/** The running app's bundle (…/Typr.app), if this is a packaged copy. */
const ownBundle = (): string | null => {
  if (!app.isPackaged) return null
  const bundle = resolve(app.getPath('exe'), '../../..')
  return bundle.endsWith('.app') ? bundle : null
}

/** Why this copy can't replace itself, if it can't. */
async function cantReplace(bundle: string | null): Promise<string | null> {
  if (!bundle) return 'This copy of Typr isn’t an installed app.'
  // macOS runs a downloaded app from a hidden, read-only copy until it's moved.
  if (bundle.includes('/AppTranslocation/') || bundle.startsWith('/Volumes/')) {
    return 'Move Typr into your Applications folder first.'
  }
  try {
    await access(dirname(bundle), constants.W_OK)
    await access(bundle, constants.W_OK)
  } catch {
    return `Typr can’t replace itself in ${dirname(bundle)}.`
  }
  return null
}

/**
 * Downloads a file, showing progress on the Dock icon. Gives up if no data
 * arrives for a minute; a full disk or other write error fails it cleanly.
 */
async function download(url: string, to: string): Promise<void> {
  const stalled = new AbortController()
  let idle = setTimeout(() => stalled.abort(), 60_000)
  const alive = (): void => {
    clearTimeout(idle)
    idle = setTimeout(() => stalled.abort(), 60_000)
  }
  try {
    const res = await net.fetch(url, { signal: stalled.signal })
    if (!res.ok || !res.body) throw new Error(`The download failed (${res.status}).`)
    const total = Number(res.headers.get('content-length')) || 0
    let got = 0
    const progress = new Transform({
      transform(chunk: Buffer, _enc, done) {
        alive()
        got += chunk.length
        if (total) getWindow()?.setProgressBar(got / total)
        done(null, chunk)
      }
    })
    await pipeline(Readable.fromWeb(res.body as never), progress, createWriteStream(to))
    if (total && got !== total) throw new Error('The download was cut short.')
  } catch (e) {
    throw stalled.signal.aborted ? new Error('The download stopped (no data for a minute).') : e
  } finally {
    clearTimeout(idle)
    getWindow()?.setProgressBar(-1)
  }
}

/** Set once an update is waiting to be swapped in, so it's never fetched twice. */
let state: 'idle' | 'busy' | 'pending' = 'idle'
/** The helper waiting to swap the update in once Typr quits. */
let helper: ChildProcess | null = null

/** What the swap helper reports for the next launch. */
const logPath = (): string => join(app.getPath('logs'), 'update.log')

// "Don't Quit" (e.g. a document couldn't be saved): call the update off rather
// than install it, and reopen Typr, at some surprising later moment.
onQuitCancelled(() => {
  if (state !== 'pending') return
  helper?.kill()
  helper = null
  state = 'idle'
  const bundle = ownBundle()
  if (bundle) cleanLeftovers(bundle)
  sendToRenderer('notice', 'Update cancelled. Check for Updates again when you’re ready')
})

/** Fetches a small text file (the release's signature). */
async function text(url: string): Promise<string> {
  const res = await net.fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`The update’s signature couldn’t be downloaded (${res.status}).`)
  return res.text()
}

/**
 * Downloads, checks and installs the update, then restarts. If Typr can't do
 * it itself, it offers the browser download; but an update whose signature is
 * wrong is refused outright, since it may not be genuine.
 */
async function install(release: Release, version: string, dmgUrl: string, sigUrl: string): Promise<void> {
  const bundle = ownBundle()
  const why = await cantReplace(bundle)
  if (why || !bundle) return offerBrowser(release, dmgUrl, why ?? '')
  if (!sigUrl) return offerBrowser(release, dmgUrl, 'This release isn’t signed, so Typr can’t check it’s genuine.')
  state = 'busy'
  const dir = await mkdtemp(join(tmpdir(), 'typr-download-'))
  try {
    sendToRenderer('notice', `Downloading Typr ${version}…`)
    const signature = await text(sigUrl)
    const dmg = join(dir, DMG)
    await download(dmgUrl, dmg)
    if (!(await signedBy(dmg, signature, UPDATE_PUBLIC_KEY))) {
      state = 'idle'
      await message({
        type: 'warning',
        message: `Typr ${version} wasn’t installed`,
        detail: 'It isn’t signed with Typr’s key, so it may not be genuine. Nothing was changed.'
      })
      return
    }
    sendToRenderer('notice', `Installing Typr ${version}…`)
    const staged = await stageUpdate(dmg, bundle, version, await bundleId(bundle))
    mkdirSync(dirname(logPath()), { recursive: true })
    // Quitting saves everything (or asks); the swap happens once Typr has exited.
    helper = await installOnExit(process.pid, {
      target: bundle,
      staged,
      reopen: !testing,
      doc: watchedFile(),
      log: logPath(),
      version
    })
    state = 'pending'
    app.quit()
  } catch (e) {
    state = 'idle'
    cleanLeftovers(bundle)
    await offerBrowser(release, dmgUrl, (e as Error).message)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

async function offerBrowser(release: Release, dmgUrl: string, why: string): Promise<void> {
  const choice = await message({
    type: 'warning',
    message: 'Typr couldn’t install the update itself',
    detail: `${why} You can download it and drag it into Applications instead.`,
    buttons: ['Download', 'Cancel'],
    defaultId: 0,
    cancelId: 1
  })
  if (choice === 0) await shell.openExternal(dmgUrl || release.html_url)
}

/** Checks now. `quiet` (the daily check) says nothing unless there's an update. */
export async function checkForUpdates(quiet = false): Promise<void> {
  if (state !== 'idle') {
    if (!quiet) {
      await message({
        message: state === 'busy' ? 'The update is downloading' : 'The update will install when Typr quits'
      })
    }
    return
  }
  const current = app.getVersion()
  let release: Release
  try {
    release = await latest()
  } catch (e) {
    if (quiet) return
    await message({ type: 'warning', message: 'Couldn’t check for updates', detail: (e as Error).message })
    return
  }
  const version = release.tag_name.replace(/^v/i, '')
  if (!isNewer(version, current)) {
    if (!quiet) await message({ message: 'Typr is up to date', detail: `You have the newest version, ${current}.` })
    return
  }
  const asset = (name: string): string => release.assets?.find((a) => a.name === name)?.browser_download_url ?? ''
  const dmgUrl = asset(DMG)
  const choice = await message({
    message: `Typr ${version} is available`,
    detail: `You have ${current}. Typr will download it and restart, with your document open again.`,
    buttons: ['Install and Restart', 'Later'],
    defaultId: 0,
    cancelId: 1
  })
  if (choice !== 0) return
  if (!dmgUrl) return offerBrowser(release, '', 'This release has no download for Typr.')
  await install(release, version, dmgUrl, asset(`${DMG}.sig`))
}

const stampPath = (): string => join(app.getPath('userData'), 'update-check.json')
const lastChecked = (): number => {
  try {
    return Number(JSON.parse(readFileSync(stampPath(), 'utf8')).at) || 0
  } catch {
    return 0
  }
}

/** After an update: says it worked (or that it didn't), once. */
function reportLastUpdate(): void {
  let result = ''
  try {
    result = readFileSync(logPath(), 'utf8').trim()
    rmSync(logPath(), { force: true })
  } catch {
    return
  }
  const [outcome, version] = result.split(' ')
  setTimeout(() => {
    if (outcome === 'installed' && version === app.getVersion()) sendToRenderer('notice', `Typr was updated to ${version}`)
    else if (outcome === 'failed') {
      void message({
        type: 'warning',
        message: `Typr ${version} couldn’t be installed`,
        detail: `You still have ${app.getVersion()}. Try Check for Updates again, or download it from the website.`
      })
    }
  }, 2500) // once the window is showing
}

/** At launch: reports and tidies up after any update, then starts the quiet daily check. */
export function checkDaily(): void {
  const bundle = ownBundle()
  if (bundle) cleanLeftovers(bundle)
  reportLastUpdate()
  const run = (): void => {
    if (Date.now() - lastChecked() < DAY) return
    try {
      writeFileSync(stampPath(), JSON.stringify({ at: Date.now() }))
    } catch {
      // Only means it may check again sooner.
    }
    void checkForUpdates(true)
  }
  setTimeout(run, 10_000) // after startup, so it never slows opening
  setInterval(run, 60 * 60 * 1000).unref()
}
