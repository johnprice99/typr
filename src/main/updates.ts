import { app, dialog, net, shell } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { isNewer } from '../shared/versions'
import { getWindow } from './window'

// Check for Updates: asks GitHub for the newest release and, if it's newer,
// offers to download its disk image (installed by dragging it into
// Applications, as before). Also checks quietly about once a day.

const LATEST = 'https://api.github.com/repos/johnprice99/typr/releases/latest'
const DMG = 'Typr-mac-arm64.dmg'
const DAY = 24 * 60 * 60 * 1000

interface Release {
  tag_name: string
  html_url: string
  assets?: { name: string; browser_download_url: string }[]
}

async function latest(): Promise<Release> {
  const res = await net.fetch(LATEST, { headers: { Accept: 'application/vnd.github+json' } })
  if (!res.ok) throw new Error(res.status === 404 ? 'No releases have been published yet.' : `GitHub answered ${res.status}.`)
  return (await res.json()) as Release
}

const message = async (opts: Electron.MessageBoxOptions): Promise<number> => {
  const win = getWindow()
  return (win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)).response
}

/** Checks now. `quiet` (the daily check) says nothing unless there's an update. */
export async function checkForUpdates(quiet = false): Promise<void> {
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
  const choice = await message({
    message: `Typr ${version} is available`,
    detail: `You have ${current}. Download the new version, then drag it into Applications to replace this one.`,
    buttons: ['Download', 'Later'],
    defaultId: 0,
    cancelId: 1
  })
  if (choice === 0) {
    const dmg = release.assets?.find((a) => a.name === DMG)?.browser_download_url
    await shell.openExternal(dmg ?? release.html_url)
  }
}

const stampPath = (): string => join(app.getPath('userData'), 'update-check.json')
const lastChecked = (): number => {
  try {
    return Number(JSON.parse(readFileSync(stampPath(), 'utf8')).at) || 0
  } catch {
    return 0
  }
}

/** The quiet check: at launch if a day has passed since the last one, then daily while Typr is open. */
export function checkDaily(): void {
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
