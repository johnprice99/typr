import { execFileSync, spawnSync } from 'child_process'
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { generateKeyPairSync, sign } from 'crypto'
import { cleanLeftovers, digest, signedBy, SWAP_SCRIPT, stagedPath, stageUpdate } from '../../src/main/install'

// A tiny stand-in for Typr: a signed app bundle in a real disk image.

const ID = 'com.johnprice.typr'
let base: string

function fakeApp(dir: string, version: string, id = ID, tamper = false): string {
  const app = join(dir, 'Typr.app')
  mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true })
  writeFileSync(
    join(app, 'Contents', 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${id}</string>
<key>CFBundleShortVersionString</key><string>${version}</string>
<key>CFBundleExecutable</key><string>Typr</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>`
  )
  copyFileSync('/usr/bin/true', join(app, 'Contents', 'MacOS', 'Typr'))
  execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', '--identifier', id, app], { stdio: 'ignore' })
  if (tamper) appendFileSync(join(app, 'Contents', 'MacOS', 'Typr'), 'tampered')
  return app
}

function fakeDmg(name: string, version: string, id = ID, tamper = false): string {
  const src = join(base, `${name}-src`)
  mkdirSync(src)
  fakeApp(src, version, id, tamper)
  const dmg = join(base, `${name}.dmg`)
  execFileSync('/usr/bin/hdiutil', ['create', '-quiet', '-srcfolder', src, '-volname', 'Typr', '-format', 'UDZO', dmg])
  return dmg
}

/** Where the current Typr is "installed" for a test. */
function installed(name: string): string {
  const dir = join(base, `${name}-apps`)
  mkdirSync(dir)
  return fakeApp(dir, '1.1.0')
}

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'typr-install-test-'))
})
afterAll(() => rmSync(base, { recursive: true, force: true }))

describe('staging an update from its disk image', () => {
  it('copies the new version beside the app once it checks out', async () => {
    const target = installed('good')
    const staged = await stageUpdate(fakeDmg('good', '1.2.0'), target, '1.2.0', ID)
    expect(staged).toBe(stagedPath(target))
    const version = execFileSync('/usr/bin/plutil', [
      '-extract',
      'CFBundleShortVersionString',
      'raw',
      '-o',
      '-',
      join(staged, 'Contents', 'Info.plist')
    ])
    expect(String(version).trim()).toBe('1.2.0')
  }, 30_000)

  it.each([
    ['another app', { version: '1.2.0', id: 'com.example.other' }, 'isn’t Typr'],
    ['the wrong version', { version: '1.1.5', id: ID }, 'not 1.2.0'],
    ['a damaged app', { version: '1.2.0', id: ID, tamper: true }, 'damaged']
  ])(
    'refuses %s and leaves nothing behind',
    async (name, opts, error) => {
      const key = name.replace(/\W/g, '')
      const target = installed(key)
      const dmg = fakeDmg(key, opts.version, opts.id, 'tamper' in opts)
      await expect(stageUpdate(dmg, target, '1.2.0', ID)).rejects.toThrow(error)
      expect(existsSync(stagedPath(target))).toBe(false)
    },
    30_000
  )
})

describe('swapping it in after Typr quits', () => {
  // A process that has already exited, standing in for Typr after it quits.
  const gone = (): number => spawnSync('/usr/bin/true').pid!
  /** Runs the swap and returns what it logged. */
  const swap = (target: string, staged: string): string => {
    const log = join(base, `log-${Math.random()}`)
    execFileSync('/bin/sh', ['-c', SWAP_SCRIPT, 'typr-update', String(gone()), target, staged, '0', '', log, '1.2.0'])
    return readFileSync(log, 'utf8').trim()
  }
  const version = (app: string): string =>
    String(
      execFileSync('/usr/bin/plutil', [
        '-extract',
        'CFBundleShortVersionString',
        'raw',
        '-o',
        '-',
        join(app, 'Contents', 'Info.plist')
      ])
    ).trim()

  it('replaces the app with the new version and tidies up', () => {
    const target = installed('swap')
    const staged = join(base, 'swap-staged', 'Typr.app')
    mkdirSync(join(base, 'swap-staged'))
    fakeApp(join(base, 'swap-staged'), '1.2.0')
    // A leftover from an earlier, interrupted update doesn't get in the way.
    mkdirSync(join(base, 'swap-apps', '.Typr-old.app', 'Contents'), { recursive: true })
    expect(swap(target, staged)).toBe('installed 1.2.0')
    expect(version(target)).toBe('1.2.0')
    expect(existsSync(staged)).toBe(false)
    expect(readdirSync(join(base, 'swap-apps')).filter((n) => n.startsWith('.Typr-old-'))).toEqual([])
  })

  it('keeps the old version if the new one can’t be moved in, and says so', () => {
    const target = installed('rollback')
    expect(swap(target, join(base, 'nothing-here', 'Typr.app'))).toBe('failed 1.2.0')
    expect(version(target)).toBe('1.1.0')
  })

  it('tidies up whatever an interrupted update left beside the app', () => {
    const target = installed('tidy')
    for (const n of ['.Typr-update.app', '.Typr-old.app', '.Typr-old-123.app']) mkdirSync(join(base, 'tidy-apps', n))
    cleanLeftovers(target)
    expect(readdirSync(join(base, 'tidy-apps'))).toEqual(['Typr.app'])
  })
})

describe('the update’s signature', () => {
  const pair = (): { pub: string; priv: import('crypto').KeyObject } => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    return { pub: publicKey.export({ type: 'spki', format: 'pem' }) as string, priv: privateKey }
  }

  it('accepts a download signed with the matching key, and nothing else', async () => {
    const mine = pair()
    const file = join(base, 'signed.dmg')
    writeFileSync(file, 'the real update')
    const sig = sign(null, await digest(file), mine.priv).toString('base64')
    expect(await signedBy(file, sig, mine.pub)).toBe(true)
    // Signed by someone else's key.
    expect(await signedBy(file, sig, pair().pub)).toBe(false)
    // Changed after it was signed.
    writeFileSync(file, 'a different update')
    expect(await signedBy(file, sig, mine.pub)).toBe(false)
    // Not a signature at all.
    expect(await signedBy(file, 'not a signature', mine.pub)).toBe(false)
  })

  it('the key built into Typr is a valid Ed25519 public key', async () => {
    const { UPDATE_PUBLIC_KEY } = await import('../../src/main/update-key')
    const { createPublicKey } = await import('crypto')
    expect(createPublicKey(UPDATE_PUBLIC_KEY).asymmetricKeyType).toBe('ed25519')
  })
})
