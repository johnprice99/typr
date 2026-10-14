import { Compartment, EditorState, Extension, Prec } from '@codemirror/state'
import { EditorView, KeyBinding, drawSelection, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { deleteMarkupBackward, markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { enter, insertLink, toggleWrap, URL_RE } from './commands'
import { syntaxHighlighting } from '@codemirror/language'
import { searchKeymap } from '@codemirror/search'
import { markdownHighlight, refreshMarks } from './markdown'
import { layout } from './layout'
import { frontmatterLines, frontmatterRange, frontmatterSyntax } from './frontmatter'
import { typewriter } from './typewriter'
import { Comment, commentsField } from './comments'
import { insertTable, tableKeys } from './tables'
import { focusMode } from './focus'
import { findBar } from './find'
import { links } from './links'
import type { FocusMode } from '../../../shared/types'

// Keys the app uses itself (CodeMirror would otherwise swallow them), plus
// built-ins that are surprising in prose: delete line (⇧⌘K) and HTML comment (⌘/).
const RESERVED = new Set([
  'Mod-d',
  'Mod-f',
  'Mod-Alt-g',
  'Mod-[',
  'Mod-]',
  'Mod-Enter',
  'Mod-i',
  'Mod-u',
  'Mod-k',
  'Shift-Mod-k',
  'Mod-/'
])

/** The text styles, as the Markdown (or HTML, for underline) that wraps them. */
export const FORMATS = {
  bold: ['**', '**'],
  italic: ['*', '*'],
  underline: ['<u>', '</u>'],
  strike: ['~~', '~~'],
  code: ['`', '`']
} as const
export type Format = keyof typeof FORMATS
const wrap = (f: Format): ReturnType<typeof toggleWrap> => toggleWrap(FORMATS[f][0], FORMATS[f][1])
const free = (bindings: readonly KeyBinding[]): KeyBinding[] => bindings.filter((b) => !b.key || !RESERVED.has(b.key))

// Pasting a URL over selected text turns the text into a link.
const pasteLinks = EditorView.domEventHandlers({
  paste(e, view) {
    const url = e.clipboardData?.getData('text/plain').trim() ?? ''
    const sel = view.state.selection.main
    const text = view.state.sliceDoc(sel.from, sel.to)
    if (!URL_RE.test(url) || sel.empty || /\n/.test(text) || URL_RE.test(text)) return false
    e.preventDefault()
    return insertLink(view, url)
  }
})

export interface EditorOptions {
  onChange: () => void
  onSelection: () => void
  /** ⌘-click or ⌘↩ on a link. */
  follow: (url: string) => void
  imageUrl: (href: string) => string
  editComment: (c: Comment) => void
  /** Files dropped or pasted onto the page. Return true if handled. */
  insertFiles: (files: File[], pos: number) => boolean
}

export interface Editor {
  view: EditorView
  setDoc(text: string): void
  getDoc(): string
  replaceDoc(text: string): void
  /** Dim all but the paragraph or sentence, or (typewriter) keep the line being typed in the middle. */
  setFocusMode(mode: FocusMode): void
  /** Formatted (live preview) or raw Markdown. */
  setLive(on: boolean): void
  /** Call after the font or text size changes. */
  refreshLayout(): void
  /** Toggles a text style on the selection. */
  format(f: Format): void
  link(url?: string): void
  insertTable(): void
  /** Inserts text as its own paragraph at (or just after the line of) pos. */
  insertBlock(pos: number, text: string): void
}

export function createEditor(parent: HTMLElement, opts: EditorOptions): Editor {
  const focusC = new Compartment()
  const layoutC = new Compartment()
  const commentActions = { edit: opts.editComment }
  let layoutExt: Extension = layout(null, commentActions)
  let focusExt: Extension = []

  const extensions = (): Extension[] => [
    history(),
    drawSelection(),
    EditorView.lineWrapping,
    EditorState.tabSize.of(4),
    EditorView.contentAttributes.of({ spellcheck: 'true', autocorrect: 'on', autocapitalize: 'on' }),
    markdown({ base: markdownLanguage, addKeymap: false, extensions: [frontmatterSyntax] }),
    frontmatterLines,
    Prec.high(
      keymap.of([
        { key: 'Enter', run: enter },
        { key: 'Backspace', run: deleteMarkupBackward }
      ])
    ),
    syntaxHighlighting(markdownHighlight),
    commentsField,
    layoutC.of(layoutExt),
    findBar,
    links(opts.follow),
    pasteLinks,
    EditorView.domEventHandlers({
      drop(e, view) {
        const files = [...(e.dataTransfer?.files ?? [])]
        if (!files.length) return false
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.state.selection.main.head
        if (!opts.insertFiles(files, pos)) return false
        e.preventDefault()
        return true
      },
      paste(e, view) {
        const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'))
        if (!files.length) return false
        e.preventDefault()
        return opts.insertFiles(files, view.state.selection.main.head)
      }
    }),
    keymap.of([
      { key: 'Mod-b', run: wrap('bold') },
      { key: 'Mod-i', run: wrap('italic') },
      { key: 'Mod-u', run: wrap('underline') },
      { key: 'Shift-Mod-x', run: wrap('strike') },
      { key: 'Shift-Mod-c', run: wrap('code') },
      ...tableKeys,
      ...free(searchKeymap),
      ...free(defaultKeymap),
      ...historyKeymap,
      indentWithTab
    ]),
    focusC.of(focusExt),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) opts.onChange()
      if (u.docChanged || u.selectionSet) opts.onSelection()
    })
  ]

  const view = new EditorView({ parent, state: EditorState.create({ extensions: extensions() }) })

  return {
    view,
    setDoc(text) {
      // The cursor starts below any front matter, so it opens as the Properties box.
      const state = EditorState.create({ doc: text, extensions: extensions() })
      const front = frontmatterRange(state)
      view.setState(front ? state.update({ selection: { anchor: Math.min(front.to + 1, text.length) } }).state : state)
      view.scrollDOM.scrollTop = 0
      view.focus()
    },
    getDoc: () => view.state.doc.toString(),
    replaceDoc(text) {
      const head = Math.min(view.state.selection.main.head, text.length)
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: head } })
    },
    setFocusMode(mode) {
      focusExt = mode === 'off' ? [] : mode === 'typewriter' ? typewriter : focusMode(mode)
      view.dispatch({
        effects: [
          focusC.reconfigure(focusExt),
          // Typewriter brings the cursor to the middle straight away.
          ...(mode === 'typewriter' ? [EditorView.scrollIntoView(view.state.selection.main.head, { y: 'center' })] : [])
        ]
      })
    },
    setLive(on) {
      layoutExt = layout(on ? { imageUrl: opts.imageUrl } : null, commentActions)
      view.dispatch({ effects: layoutC.reconfigure(layoutExt) })
    },
    refreshLayout: () => refreshMarks(view),
    format: (f) => void wrap(f)(view),
    link: (url) => void insertLink(view, url),
    insertTable: () => insertTable(view),
    insertBlock(pos, text) {
      const line = view.state.doc.lineAt(Math.min(pos, view.state.doc.length))
      const busy = line.text.trim() !== ''
      const at = busy ? line.to : line.from
      const insert = (busy ? '\n\n' : '') + text
      view.dispatch({
        changes: { from: at, to: busy ? at : line.to, insert },
        selection: { anchor: at + insert.length },
        userEvent: 'input'
      })
      view.focus()
    }
  }
}
