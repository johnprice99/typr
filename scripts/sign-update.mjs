// Signs the disk image `npm run dist` just made, writing Typr-mac-arm64.dmg.sig
// beside it: attach both to the GitHub release. Typr only installs an update
// itself if this signature checks out against the key built into it.

import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'crypto'
import { createReadStream, existsSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const KEY = process.env.TYPR_UPDATE_KEY || join(homedir(), '.config', 'typr', 'update-key.pem')
const DMG = join(ROOT, 'dist', 'Typr-mac-arm64.dmg')

if (!existsSync(KEY)) {
  console.warn(`\n⚠  Not signed: there's no update signing key at ${KEY}.`)
  console.warn('   Copies of Typr won’t install this release themselves (they’ll offer the download instead).')
  console.warn('   Restore the key from your backup, or make one with `npm run update-key`.\n')
  process.exit(0)
}

const hash = createHash('sha256')
for await (const chunk of createReadStream(DMG)) hash.update(chunk)
const digest = hash.digest()

const privateKey = createPrivateKey(readFileSync(KEY))
const signature = sign(null, digest, privateKey)

// The key built into this Typr must be the one that just signed it.
const built = /`(-----BEGIN PUBLIC KEY-----[\s\S]+?-----END PUBLIC KEY-----)`/.exec(
  readFileSync(join(ROOT, 'src', 'main', 'update-key.ts'), 'utf8')
)?.[1]
if (!built || !verify(null, digest, createPublicKey(built), signature)) {
  console.error('\n✖  Your signing key doesn’t match the one built into Typr (src/main/update-key.ts).')
  console.error('   Run `npm run update-key` after replacing a key, then build again.\n')
  process.exit(1)
}

writeFileSync(`${DMG}.sig`, signature.toString('base64') + '\n')
console.log(`Signed: dist/Typr-mac-arm64.dmg.sig (attach it to the release with the .dmg)`)
