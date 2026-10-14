// Makes the key that signs Typr's updates (run once: `npm run update-key`).
// The private key stays on this Mac, readable only by you, outside the repo;
// its public half is written into the app (src/main/update-key.ts), which uses
// it to check every update before installing it. Back the private key up: if
// it's lost, make a new one, and older copies of Typr fall back to the browser
// download once.

import { generateKeyPairSync } from 'crypto'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const KEY = process.env.TYPR_UPDATE_KEY || join(homedir(), '.config', 'typr', 'update-key.pem')

if (existsSync(KEY)) {
  console.log(`There's already a signing key at ${KEY}; it hasn't been changed.`)
  console.log('(To replace a lost or leaked key, delete that file and run this again.)')
  process.exit(0)
}

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
mkdirSync(dirname(KEY), { recursive: true, mode: 0o700 })
writeFileSync(KEY, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' })

const pem = publicKey.export({ type: 'spki', format: 'pem' }).trim()
writeFileSync(
  join(ROOT, 'src', 'main', 'update-key.ts'),
  `// The public half of the key that signs Typr's updates (made by \`npm run update-key\`).
// Typr only installs an update whose .sig file this key accepts.
export const UPDATE_PUBLIC_KEY = \`${pem}\`
`
)
console.log(`Made a signing key: ${KEY} (private: keep it, and back it up).`)
console.log('Its public half is in src/main/update-key.ts; commit that.')
