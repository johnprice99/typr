import { ChildProcess, execFile, spawn } from 'child_process'
import { createHash, verify } from 'crypto'
import { createReadStream, readdirSync, rmSync } from 'fs'
import { lstat, mkdtemp, readdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { promisify } from 'util'

// Installing an update: copy the new Typr out of its disk image next to the
// running one, check it, and swap it in once Typr has quit. Nothing here uses
// Electron, so it can be tested on its own.

const exec = promisify(execFile)
/** Runs a tool, giving up after `seconds` (so a stuck one can't hold the update forever). */
const run = (cmd: string, args: string[], seconds = 120): Promise<{ stdout: string }> =>
  exec(cmd, args, { timeout: seconds * 1000 })

/** The SHA-256 digest of a file (what update signatures are made over). */
export async function digest(path: string): Promise<Buffer> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest()
}

/**
 * Whether `signature` (base64, from the release's .sig file) was made over this
 * download by the private key matching `publicKey`, which only the developer
 * holds. This is what proves an update is genuine.
 */
export async function signedBy(file: string, signature: string, publicKey: string): Promise<boolean> {
  try {
    return verify(null, await digest(file), publicKey, Buffer.from(signature.trim(), 'base64'))
  } catch {
    return false
  }
}

/** Where a downloaded update waits beside the app. */
export const stagedPath = (target: string): string => join(dirname(target), '.Typr-update.app')

const plistValue = async (app: string, key: string): Promise<string> =>
  (await run('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', join(app, 'Contents', 'Info.plist')])).stdout.trim()

/** The app's bundle identifier, e.g. "com.johnprice.typr". */
export const bundleId = (app: string): Promise<string> => plistValue(app, 'CFBundleIdentifier')

/**
 * Copies the app out of a downloaded disk image to sit beside `target`, and
 * checks it before anything is replaced: the same bundle identifier, the
 * version the release said, and intact (its code signature verifies). These
 * catch a wrong or damaged download; that it's genuine is checked first, by
 * the release's signature (see signedBy).
 * Returns where it was put; throws (leaving nothing behind) if any check fails.
 */
export async function stageUpdate(dmg: string, target: string, version: string, id: string): Promise<string> {
  const mount = await mkdtemp(join(tmpdir(), 'typr-update-'))
  const staged = stagedPath(target)
  await rm(staged, { recursive: true, force: true })
  try {
    await run('/usr/bin/hdiutil', ['attach', dmg, '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mount])
    try {
      const app = (await readdir(mount)).includes('Typr.app') ? join(mount, 'Typr.app') : null
      const info = app ? await lstat(app) : null
      if (!app || !info?.isDirectory()) throw new Error('The download doesn’t contain Typr')
      await run('/usr/bin/ditto', [app, staged], 600)
    } finally {
      await run('/usr/bin/hdiutil', ['detach', mount, '-force']).catch(() => {})
    }
    if ((await bundleId(staged)) !== id) throw new Error('The download isn’t Typr')
    const got = await plistValue(staged, 'CFBundleShortVersionString')
    if (got !== version) throw new Error(`The download is version ${got}, not ${version}`)
    await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', staged], 300).catch(() => {
      throw new Error('The download is damaged (its signature doesn’t check out)')
    })
    // So macOS doesn't treat it as freshly downloaded from the internet.
    await run('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', staged]).catch(() => {})
    return staged
  } catch (e) {
    await rm(staged, { recursive: true, force: true }).catch(() => {})
    throw e
  } finally {
    await rm(mount, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Waits for Typr (process `pid`) to exit, then swaps the staged app in, putting
 * the old one back if that fails, and records how it went in `log` for the next
 * launch to report. Then, if asked, opens Typr again with the document.
 * The old app goes to a name of its own, so a leftover from an earlier,
 * interrupted update can never get in the way; and once the swap starts it
 * can't be stopped halfway (e.g. by logging out).
 */
export const SWAP_SCRIPT = `
pid="$1"; target="$2"; staged="$3"; reopen="$4"; doc="$5"; log="$6"; version="$7"
old="$(dirname "$target")/.Typr-old-$$.app"
while kill -0 "$pid" 2>/dev/null && ps -p "$pid" -o comm= | grep -q Typr; do sleep 0.3; done
trap '' HUP INT TERM
result="failed"
if [ ! -e "$old" ] && mv "$target" "$old"; then
  if mv "$staged" "$target"; then result="installed"; rm -rf "$old"; else mv "$old" "$target"; fi
fi
rm -rf "$staged"
[ -n "$log" ] && printf '%s %s\\n' "$result" "$version" > "$log"
[ "$reopen" = 1 ] || exit 0
if [ -n "$doc" ] && [ -e "$doc" ]; then open -a "$target" "$doc"; else open "$target"; fi
`

export interface Swap {
  target: string
  staged: string
  /** Open Typr again afterwards (with this document, if it still exists). */
  reopen: boolean
  doc: string | null
  /** Where the result ("installed 1.2.0" / "failed 1.2.0") is written. */
  log: string
  version: string
}

/**
 * Starts the swap; it happens as soon as process `pid` (Typr) has quit.
 * Resolves with the waiting helper once it's running (killing it, before Typr
 * quits, calls the update off).
 */
export function installOnExit(pid: number, s: Swap): Promise<ChildProcess> {
  const args = [String(pid), s.target, s.staged, s.reopen ? '1' : '0', s.doc ?? '', s.log, s.version]
  const helper = spawn('/bin/sh', ['-c', SWAP_SCRIPT, 'typr-update', ...args], { detached: true, stdio: 'ignore' })
  return new Promise((resolve, reject) => {
    helper.once('spawn', () => {
      helper.unref()
      resolve(helper)
    })
    helper.once('error', reject)
  })
}

/** Removes anything an interrupted update left beside the app (quietly: it's only tidying). */
export function cleanLeftovers(target: string): void {
  let names: string[] = []
  try {
    names = readdirSync(dirname(target))
  } catch {
    return
  }
  for (const name of names) {
    if (name !== '.Typr-update.app' && !/^\.Typr-old(-\d+)?\.app$/.test(name)) continue
    try {
      rmSync(join(dirname(target), name), { recursive: true, force: true })
    } catch (e) {
      console.error('Typr: couldn’t tidy up after an update', e)
    }
  }
}
