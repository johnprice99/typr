# Typr

A quiet Markdown editor. Open it and type.

- Opens maximised on a blank page (it remembers the window size if you change it). It saves itself as you write. A new document is named after its first line, and the name settles once you move on; rename any time with ⇧⌘R or by clicking the title.
- Plain `.md` files in ordinary folders. **Open Folder…** (⇧⌘O) adds any folder to the sidebar, so notes in Documents and stories in a project folder can sit side by side. Each folder collapses; close it with File › Close Folder… or by right-clicking (nothing on disk changes).
- A new document is saved next to the one you're in (or in the only open folder). If there's nowhere obvious, it waits: ⌘S, leaving it, or quitting asks which folder.
- Markdown links: ⌘-click (or ⌘↩) opens web links in your browser and links to other documents in Typr.
- Notices when the open file is renamed, moved or deleted in Finder.
- You edit a formatted page: headings, bold, links, bullets, checkboxes and images look the way they will read, and the Markdown appears only where your cursor is. **Show Markdown** (⌘E) switches to the plain-text view. The file on disk is always plain Markdown.
- Focus mode (View › Focus, off by default): dims all but the paragraph or sentence you're writing. Links in dimmed text keep a soft underline.
- Tables: Format › **Table**, then Tab / ⇧Tab between cells (Tab in the last cell adds a row). They render as a table when you're not editing them.
- Images: Format › **Image…** or drag one onto the page. Typr links to the file where it is (a relative link within the same open folder, absolute otherwise); nothing is copied. Images from the internet show a placeholder until you click, so opening a document never tells a website you read it.
- Comments for proofreading: select text, ⇧⌘M, type a note. They're stored in the file as [CriticMarkup](https://fletcher.github.io/MultiMarkdown-6/syntax/critic.html) (`{==text==}{>>note<<}`), shown as highlighted text; hover to read, edit or resolve. **Go to Comment…** lists them all; Edit has all three comment commands.
- View › Typewriter Scrolling: keeps the line you're typing near the middle of the window.
- View › Appearance: System, Light or Dark. Text size: ⌘+, ⌘− and ⌘0 (also in the View menu).
- Typr › Check for Updates…: asks GitHub for the newest release, then downloads it, checks it's genuine (signed with the developer's key) and intact, and restarts into it with your document open. Typr also checks quietly once a day. If it can't replace itself (e.g. it's running from the disk image), it offers the download instead.
- The command palette (⇧⌘P) lists only what you can do right now, your recently used commands first; settings that are on show a tick and their shortcut.
- Right-click in the text: spelling suggestions, **Open Link** on a link, and **Add Comment** / **Link** for a selection.
- Help › menu search finds any command; Help also links to the website and to reporting a problem.
- If another app changes a file while you're typing in it, nothing is lost: their version is kept as a “(changed elsewhere)” copy next to it.

```sh
npm install
npm run dev      # run with hot reload
npm run build    # production build into out/
npm start        # run the production build
npm run dist     # build Typr.app + a .dmg into dist/
npm run pack     # just Typr.app (quicker), in dist/mac-arm64/
```

## Tests

```sh
npm run check       # types, formatting and unit tests (no app window)
npm run test:e2e    # builds, then drives the real app (launched once, invisible, ~20 s)
npm test            # unit and end-to-end tests
npm run format      # format the code with Prettier
```

End-to-end tests launch the app once, invisibly and without a Dock icon (the window lets clicks pass through and never takes focus, so you can keep working), and reset it with a throwaway library and settings before each test, so they never touch your documents, settings, clipboard or Recent Documents. The run stops after 5 minutes or 10 failures.

Icons: `build/Typr.icon` (made in Icon Composer) is the app icon, which macOS shows in light, dark or tinted style to match your Mac; `build/icon.icns` is the fallback for older macOS. `resources/icon-light.png` and `resources/icon-dark.png` are used in the About panel and as the Dock icon when running from source; the website shows the light one. Packaged builds register `.md`, `.markdown` and `.txt`, so **Open With → Typr** works in Finder.

## Releasing

1. Bump `version` in `package.json` (e.g. 1.2.0 → 1.3.0 for new features, → 1.2.1 for fixes).
2. `npm run dist`: builds `dist/Typr-mac-arm64.dmg` and signs it, writing `dist/Typr-mac-arm64.dmg.sig`.
3. On GitHub, **Releases › Draft a new release**: a new tag (e.g. `1.3.0`), a title, and attach **both** files. Publish.

Copies of Typr then offer the update, download it, and install it themselves, but only if its `.sig` checks out against the key built into the app (`src/main/update-key.ts`). Without a `.sig`, they offer the browser download instead; with a wrong one, they refuse it.

**The signing key** is `~/.config/typr/update-key.pem` (made once with `npm run update-key`, never in the repo). Back it up somewhere safe. If it's lost or leaked, delete it, run `npm run update-key` for a new one, commit the new `src/main/update-key.ts` and release; copies with the old key fall back to the browser download once.

## Website

`docs/` is a single static page (no build step) with a download link. To publish it with GitHub Pages: **Settings › Pages › Deploy from a branch › `main` / `docs`**. (On a free GitHub plan, Pages and release downloads need the repository to be public.)

- **Download link:** points at `releases/latest/download/Typr-mac-arm64.dmg`, so it always gets the newest release (see Releasing).
- **Screenshots:** `npm run screenshots` retakes `docs/images/*.png` from the real app, using made-up sample documents (invisibly, like the tests).

## Keys

Everything is in the command palette (⇧⌘P), so you never need the mouse.

|              |                                                                 |
| ------------ | --------------------------------------------------------------- |
| ⇧⌘P          | Command palette                                                 |
| ⌘P           | Go to file, or type a new name to create one                    |
| ⌘N           | New document                                                    |
| ⌘O           | Open any file                                                   |
| ⇧⌘O          | Open a folder in the sidebar                                    |
| ⌘S           | Save (only needed to choose where a new document goes)          |
| ⇧⌘R          | Rename (or click the title)                                     |
| ⌘\\          | Show / hide the sidebar                                         |
| ⌘D           | Focus: Off → Paragraph → Sentence                               |
| ⌘E           | Show Markdown / formatted view                                  |
| ⌘+ / ⌘− / ⌘0 | Bigger / smaller / actual text size                             |
| ⌃⌘F          | Full screen                                                     |
| ⌘F           | Find (↩ next, ⇧↩ previous, Esc close)                           |
| ⇧⌘F          | Find and replace (↩ replace, ⌘↩ replace all)                    |
| ⌘↩ / ⌘-click | Follow link under cursor                                        |
| ⌘[ / ⌘]      | Back / forward                                                  |
| ⌘B / ⌘I      | Bold / italic                                                   |
| ⌘K           | Insert link. Pasting a URL onto selected text also makes a link |
| ⇧⌘M          | Add a comment (or edit the one under the cursor)                |

Fonts: the Mac's own. The formatted view uses the system font; the Markdown view and code use Menlo (Electron can't reach SF Mono).

## Code layout

- `src/main/` — the Electron main process: `settings`, `library` (listing and watching folders, safe file names, atomic writes), `watcher` (the open file), `ipc` (file access for the window), `menu`, `window`, `dock`, `updates` and `install` (the self-updater).
- `src/preload/` — the bridge to the window. Every message is typed in `src/shared/ipc.ts`.
- `src/renderer/src/app/` — the app: documents and saving (`session`), links, images, comments, open folders (`library`), commands.
- `src/renderer/src/editor/` — the CodeMirror editor and its features (formatted view, focus, find, tables, comments).
- `src/renderer/src/ui/` — the palette, the about panel, and the sidebar.
- `tests/unit/` (Vitest) and `tests/e2e/` (Playwright).
- `docs/` — the website; `scripts/screenshots.mjs` takes its screenshots.
- `AGENTS.md` — rules and gotchas for coding agents working on Typr.
