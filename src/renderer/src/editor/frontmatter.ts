import { EditorState, Extension, Prec, StateField } from '@codemirror/state'
import { Decoration, DecorationSet, EditorView, keymap, WidgetType } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import type { BlockContext, Line, MarkdownConfig } from '@lezer/markdown'
import { decorations, touched } from './syntax'

// Front matter: the "---" block of properties (title, summary…) at the top of
// many Markdown files. Markdown itself doesn't know about it, and would read it
// as a rule plus a giant heading. This teaches the parser what it is, and the
// formatted view shows it as a small Properties box you can click to edit.

type Input = { length: number; read(from: number, to: number): string }

export const frontmatterSyntax: MarkdownConfig = {
  defineNodes: [
    { name: 'Frontmatter', block: true },
    { name: 'FrontmatterMark', style: t.processingInstruction },
    { name: 'FrontmatterContent', style: t.meta }
  ],
  parseBlock: [
    {
      name: 'Frontmatter',
      before: 'HorizontalRule',
      parse(cx: BlockContext, line: Line): boolean {
        if (cx.lineStart !== 0 || !/^---[ \t]*$/.test(line.text)) return false
        // Only front matter if it's closed, which means looking ahead. The parser
        // has no public look-ahead beyond one line, so read its input directly
        // (covered by tests; without it, the block is simply left as Markdown).
        const input = (cx as unknown as { input?: Input }).input
        if (!input || typeof input.read !== 'function') return false
        const head = input.read(0, Math.min(input.length, 64 * 1024))
        // (The end of the text counts as a line end, but not where the 64 KB read was cut.)
        const close = (head.length === input.length ? /\n((?:---|\.\.\.)[ \t]*)(?=\n|$)/ : /\n((?:---|\.\.\.)[ \t]*)(?=\n)/).exec(
          head
        )
        if (!close) return false
        const closeFrom = close.index + 1
        const closeTo = closeFrom + close[1].length
        const children = [cx.elt('FrontmatterMark', 0, line.text.length)]
        if (closeFrom - 1 > line.text.length + 1) children.push(cx.elt('FrontmatterContent', line.text.length + 1, closeFrom - 1))
        children.push(cx.elt('FrontmatterMark', closeFrom, closeTo))
        while (cx.lineStart < closeFrom && cx.nextLine()) {
          // skip to the closing fence
        }
        cx.nextLine()
        cx.addElement(cx.elt('Frontmatter', 0, closeTo, children))
        return true
      }
    }
  ]
}

/** The front matter's range, if the document has any. */
export function frontmatterRange(state: EditorState): { from: number; to: number } | null {
  const first = syntaxTree(state).topNode.firstChild
  return first?.name === 'Frontmatter' ? { from: first.from, to: first.to } : null
}

export interface Property {
  key: string
  value: string
}

/**
 * Reads simple "key: value" front matter for display. Indented lines and list
 * items continue the previous value. Returns null for anything more complex,
 * which is then shown as plain text.
 */
export function readProperties(yaml: string): Property[] | null {
  const out: Property[] = []
  for (const raw of yaml.split('\n')) {
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue
    const m = /^([A-Za-z0-9_][\w .-]*?)\s*:\s?(.*)$/.exec(raw)
    if (m && !/^\s/.test(raw)) {
      out.push({ key: m[1], value: unquote(m[2].trim()) })
    } else if (out.length && /^\s/.test(raw)) {
      const last = out[out.length - 1]
      const item = raw.trim().replace(/^-\s+/, '')
      last.value = last.value && !/^[|>][-+]?$/.test(last.value) ? `${last.value}, ${unquote(item)}` : unquote(item)
    } else {
      return null
    }
  }
  return out
}

const unquote = (v: string): string => (/^(["']).*\1$/.test(v) ? v.slice(1, -1) : v)

class PropertiesWidget extends WidgetType {
  constructor(
    readonly yaml: string,
    readonly contentFrom: number
  ) {
    super()
  }
  eq(other: PropertiesWidget): boolean {
    return other.yaml === this.yaml && other.contentFrom === this.contentFrom
  }
  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('div')
    box.className = 'md-properties'
    box.title = 'Click to edit'
    const props = readProperties(this.yaml)
    if (props && props.length) {
      for (const p of props) {
        const key = document.createElement('div')
        key.className = 'md-prop-key'
        key.textContent = p.key
        const value = document.createElement('div')
        value.className = 'md-prop-value'
        value.textContent = p.value
        box.append(key, value)
      }
    } else {
      const raw = document.createElement('pre')
      raw.className = 'md-prop-raw'
      raw.textContent = this.yaml || 'Properties'
      box.append(raw)
    }
    // Clicking edits the front matter as text.
    box.addEventListener('mousedown', (e) => {
      e.preventDefault()
      view.dispatch({ selection: { anchor: this.contentFrom }, scrollIntoView: true })
      view.focus()
    })
    return box
  }
  ignoreEvent(): boolean {
    return true
  }
}

function build(state: EditorState): DecorationSet {
  const range = frontmatterRange(state)
  if (!range) return Decoration.none
  if (touched(state, range.from, range.to)) return Decoration.none
  const firstLineEnd = state.doc.lineAt(range.from).to
  const lastLineStart = state.doc.lineAt(range.to).from
  const yaml = lastLineStart - 1 > firstLineEnd ? state.sliceDoc(firstLineEnd + 1, lastLineStart - 1) : ''
  return Decoration.set(
    Decoration.replace({ widget: new PropertiesWidget(yaml, Math.min(firstLineEnd + 1, range.to)), block: true }).range(
      range.from,
      range.to
    )
  )
}

/** Front matter lines, whenever they show as text, are small and quiet. */
const lineStyle = Decoration.line({ class: 'md-frontmatter' })
function styleLines(state: EditorState): DecorationSet {
  const range = frontmatterRange(state)
  if (!range) return Decoration.none
  const out = []
  for (let n = state.doc.lineAt(range.from).number, last = state.doc.lineAt(range.to).number; n <= last; n++) {
    out.push(lineStyle.range(state.doc.line(n).from))
  }
  return Decoration.set(out)
}

export const frontmatterLines: Extension = decorations((view) => styleLines(view.state))

/** ↑ from the line below the Properties box steps into it (a box is otherwise skipped). */
function arrowUpInto(view: EditorView): boolean {
  const { state } = view
  const range = frontmatterRange(state)
  const sel = state.selection.main
  if (!range || !sel.empty) return false
  const line = state.doc.lineAt(sel.head)
  if (line.number < 2 || state.doc.line(line.number - 1).to !== range.to) return false
  const lastContent = state.doc.lineAt(range.to).number - 1
  const target = state.doc.line(Math.max(1, lastContent))
  view.dispatch({ selection: { anchor: target.from + Math.min(sel.head - line.from, target.length) }, scrollIntoView: true })
  return true
}

/** The Properties box. Block widgets have to come from a state field. */
export const propertiesBox: Extension = [
  StateField.define<DecorationSet>({
    create: build,
    update: (deco, tr) =>
      tr.docChanged || tr.selection || syntaxTree(tr.startState) !== syntaxTree(tr.state) ? build(tr.state) : deco,
    provide: (f) => EditorView.decorations.from(f)
  }),
  Prec.high(keymap.of([{ key: 'ArrowUp', run: arrowUpInto }]))
]
