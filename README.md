# Typr

A quiet Markdown editor. Open it and type.

- Opens maximised on a blank page (it remembers the window size if you change it). It saves itself as you write. A new document is named after its first line, and the name settles once you move on; rename any time with ⇧⌘R or by clicking the title.
- Plain `.md` files in real folders. You choose the library folder on first launch; change it with **Library Folder…**.
- `[[Wikilinks]]` and normal Markdown links. Following a link to a note that doesn't exist opens it, and the file is created once you type.
- Notices when the open file is renamed, moved or deleted in Finder.
- You edit a formatted page: headings, bold, links, bullets, checkboxes and images look the way they will read, and the Markdown appears only where your cursor is. **Show Markdown** (⌘E) switches to the plain-text view. The file on disk is always plain Markdown.
- Focus mode (paragraph by default). Links in dimmed text keep a soft underline.
- Tables: **Insert Table**, then Tab / ⇧Tab between cells (Tab in the last cell adds a row). They render as a table when you're not editing them.
- Images: **Insert Image…** or drag one onto the page. Typr links to the file where it is (a relative link inside your library, absolute elsewhere); nothing is copied.
- Comments for proofreading: select text, ⇧⌘M, type a note. They're stored in the file as [CriticMarkup](https://fletcher.github.io/MultiMarkdown-6/syntax/critic.html) (`{==text==}{>>note<<}`), shown as highlighted text; hover to read, edit or resolve. **Go to Comment…** lists them all.
- Settings (⌘,): appearance, text size and library folder. They apply to the whole app.
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

End-to-end tests launch the app once, invisibly and without a Dock icon, and reset it with a throwaway library and settings before each test, so they never touch your documents, settings, clipboard or Recent Documents. The run stops after 5 minutes or 10 failures.

Icons: `resources/icon-light.png` and `resources/icon-dark.png` are the Dock icons, swapped while Typr runs to match the appearance. `build/icon.icns` (made from the light one) is what Finder and Launchpad show. Packaged builds register `.md`, `.markdown` and `.txt`, so **Open With → Typr** works in Finder.

## Keys

Everything is in the command palette (⇧⌘P), so you never need the mouse.

|              |                                                                 |
| ------------ | --------------------------------------------------------------- |
| ⇧⌘P          | Command palette                                                 |
| ⌘P           | Go to file, or type a new name to create one                    |
| ⌘N           | New document                                                    |
| ⌘O           | Open any file                                                   |
| ⇧⌘R          | Rename (or click the title)                                     |
| ⌘\\          | Show / hide library                                             |
| ⌘D           | Focus: Off → Paragraph → Sentence                               |
| ⌘E           | Show Markdown / formatted view                                  |
| ⌘,           | Settings                                                        |
| ⌃⌘F          | Full screen                                                     |
| ⌘F           | Find (↩ next, ⇧↩ previous, Esc close)                           |
| ⇧⌘F          | Find and replace (↩ replace, ⌘↩ replace all)                    |
| ⌘↩ / ⌘-click | Follow link under cursor                                        |
| ⌘[ / ⌘]      | Back / forward                                                  |
| ⌘B / ⌘I      | Bold / italic                                                   |
| ⌘K           | Insert link. Pasting a URL onto selected text also makes a link |
| ⇧⌘M          | Add a comment (or edit the one under the cursor)                |

Font: [IBM Plex Mono](https://github.com/IBM/plex) (SIL OFL) for the Markdown view and code; the formatted view uses the Mac's system font.

## Code layout

- `src/main/` — the Electron main process: `settings`, `library` (listing and safe file names), `watcher` (the open file), `ipc` (file access for the window), `menu`, `window`, `dock`.
- `src/preload/` — the bridge to the window. Every message is typed in `src/shared/ipc.ts`.
- `src/renderer/src/app/` — the app: documents and saving (`session`), links, images, comments, library, commands.
- `src/renderer/src/editor/` — the CodeMirror editor and its features (formatted view, focus, find, tables, comments).
- `src/renderer/src/ui/` — the palette, settings and about panels, and the library sidebar.
- `tests/unit/` (Vitest) and `tests/e2e/` (Playwright).
