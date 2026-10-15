# Typr — notes for agents

Minimal macOS (Apple silicon only) Markdown editor. Electron + electron-vite + CodeMirror 6 + TypeScript. Owner: John Price. Read README.md for features and keys.

## Commands

- `npm run check` — types, Prettier, unit tests. Run before every commit.
- `npm run build` then `perl -e 'alarm 240; exec @ARGV' npx playwright test --reporter=line`, then `pkill -f "work/typr/node_modules/electron"`. ~35 s.
- `npm run dist` — clears `dist/`, builds `Typr-mac-arm64.dmg` + signed `.sig`, and leaves `dist/mac-arm64/Typr.app`. Don't run it while the user is running a copy from `dist/`.
- `npm run screenshots` — retakes `docs/images/*.png` from the real app.

## Layout

- `src/main/` — main process. `ipc.ts` is the only file-system access for the window and is guarded: paths must be inside open folders or known files. `updates.ts`/`install.ts` hold the self-updater.
- `src/renderer/src/app/session.ts` — document lifecycle. Saves, renames and outside changes go through `serial()`; switching documents goes through `navigate()`. Never await one from inside the other.
- `src/renderer/src/app/actions.ts` — the command registry. Menu items only send command ids, so add commands here and in `src/main/menu.ts`. Give a command `available()` if it can't always apply: the palette hides it. Assert the full menu layout in the e2e menu test.
- `src/shared/` — types, the IPC channel list (`ipc.ts`), and settings normalisation (every new setting needs a default there and in `tests/unit/settings.test.ts`).
- `docs/` — the static website (GitHub Pages, `main`/`docs`).

## Rules

- Ask before anything disruptive: quitting the user's Typr, `killall Dock`, changing system settings, publishing.
- Never modify the user's documents. Read-only sample: `~/work/unbroken-chronicles/stories/the-beast-of-briarfen.md`.
- Mac built-in fonts only (system sans; Menlo for mono). No iA Writer fonts or references.
- Minimal UI. The palette (⇧⌘P) is for things you'd look up by name: documents, views, settings, inserting. Actions on whatever is under the cursor live on it (the comment card, the right-click menu) or behind a shortcut, not in the palette (e.g. Resolve, Accept/Reject, Follow Link). Settings live in menus; there's no Settings panel.
- Before committing: review the diff (a subagent review for anything non-trivial), fix findings, run the check and e2e.
- Install for the user (only when they want it): `osascript -e 'quit app "Typr"'`, wait for exit, `rm -rf /Applications/Typr.app && ditto dist/mac-arm64/Typr.app /Applications/Typr.app && open /Applications/Typr.app`.
- Don't bump the version or release unless asked.

## Editor gotchas

- Never put CSS margins on editor lines or block widgets (anything directly inside `.cm-content`), including a child's margin that collapses out through its parent. CodeMirror only measures heights, so a margin shifts every line below it and clicks land on the next line down. Space them with padding instead, and wrap bordered boxes (see `.md-properties-wrap`). Add any new block widget to the "click low on a line" test in `formatted.spec.ts`.
- To find layout bugs like this, compare `view.lineBlockAt(pos).top + view.documentTop` with each `.cm-line`'s `getBoundingClientRect().top`. Any difference is drift.

## Testing gotchas

- E2E launches the app once, invisibly (opacity 0, no Dock icon), and resets it per test with `__typrReset`. Never relaunch per test, never touch the clipboard, and always cap the run with `alarm`.
- The test window must stay click-through and unfocusable (`setIgnoreMouseEvents`, `setFocusable(false)` in `window.ts`). Otherwise the invisible window swallows the user's clicks and their Mac seems frozen while tests run. Tests drive the page via CDP, so they don't need it.
- The invisible window never paints. CodeMirror measurements can be stale, OS appearance changes don't reach `prefers-color-scheme` (check `nativeTheme` in main instead), and hover tests are timing-sensitive.
- Tests that stub `net.fetch` or `dialog` in main must restore them: the app is shared across tests.
- Wait for focus (`toBeFocused()`) before typing into the palette or editor.
- `npx prettier --write` reflows long lines, so re-read a file after formatting it before matching text in scripted edits.

## Build gotchas

- Icon: `build/Typr.icon` (Icon Composer), compiled by electron-builder via Xcode's `actool`. `npm run dist` puts Xcode on PATH because `xcode-select` points at the Command Line Tools. The light, dark and tinted Dock icons follow the user's macOS icon-style setting, not Typr.
- Size: almost all of Typr is Electron. Only English Chromium languages ship (`electronLanguages` in `electron-builder.yml`). The dmg stays electron-builder's default zlib (UDZO): LZMA would be about 25% smaller but takes twice as long to open and install.
- Ad-hoc signing (`identity: '-'`, no hardened runtime). The bundle id is `com.johnprice.typr`. Not notarised, so downloads show Gatekeeper's warning once.

## Releasing (the user publishes)

1. Bump `version` in package.json, then `npm run dist`.
2. A GitHub release tagged with the version (no "v"), attaching both `dist/Typr-mac-arm64.dmg` and `.dmg.sig`, marked latest.

- The update check reads `releases/latest`. It installs only if the `.sig` verifies against `src/main/update-key.ts`; the private key is `~/.config/typr/update-key.pem` and is never committed. A missing `.sig` falls back to the browser download; a bad one is refused.
- The asset name `Typr-mac-arm64.dmg` is fixed: the website and the updater depend on it.
