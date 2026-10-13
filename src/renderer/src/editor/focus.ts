import { EditorState, Extension } from '@codemirror/state'
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'

const dim = Decoration.mark({ class: 'cm-dim' })

type Range = { from: number; to: number }

// The smallest Markdown blocks: a heading, a paragraph (including one inside a
// list item or quote), a code block, a table. Each is focused on its own.
const BLOCK = /^(Paragraph|ATXHeading\d|SetextHeading\d|FencedCode|CodeBlock|Table|HTMLBlock|HorizontalRule|Frontmatter)$/

function byBlankLines(state: EditorState, pos: number): Range {
  const doc = state.doc
  let first = doc.lineAt(pos)
  let last = first
  while (first.number > 1 && doc.line(first.number - 1).text.trim()) first = doc.line(first.number - 1)
  while (last.number < doc.lines && doc.line(last.number + 1).text.trim()) last = doc.line(last.number + 1)
  return { from: first.from, to: last.to }
}

/** The block under the cursor, widened to whole lines so list and quote markers are included. */
export function paragraphAt(state: EditorState, pos: number): Range {
  const { doc } = state
  const line = doc.lineAt(pos)
  if (!line.text.trim()) return { from: line.from, to: line.to }
  let found: Range | null = null
  syntaxTree(state).iterate({
    from: line.from,
    to: line.to,
    enter(node) {
      if (found) return false
      if (!BLOCK.test(node.name)) return
      const first = doc.lineAt(node.from)
      const last = doc.lineAt(node.to)
      if (first.number <= line.number && line.number <= last.number) found = { from: first.from, to: last.to }
      return false
    }
  })
  return found ?? byBlankLines(state, pos)
}

// A sentence ends at . ! ? or … (plus any closing quotes/brackets) followed by whitespace.
const SENTENCE_END = /[.!?…]+["'”’)\]]*\s+/g

export function sentenceAt(state: EditorState, pos: number): { from: number; to: number } {
  const para = paragraphAt(state, pos)
  const text = state.sliceDoc(para.from, para.to)
  const offset = pos - para.from
  let start = 0
  SENTENCE_END.lastIndex = 0
  for (let m; (m = SENTENCE_END.exec(text));) {
    const end = m.index + m[0].length
    if (offset < end) return { from: para.from + start, to: para.from + end }
    start = end
  }
  return { from: para.from + start, to: para.to }
}

export function focusMode(scope: 'paragraph' | 'sentence'): Extension {
  const find = scope === 'sentence' ? sentenceAt : paragraphAt
  const build = (state: EditorState): DecorationSet => {
    const { from, to } = find(state, state.selection.main.head)
    const ranges = []
    if (from > 0) ranges.push(dim.range(0, from))
    if (to < state.doc.length) ranges.push(dim.range(to, state.doc.length))
    return Decoration.set(ranges)
  }
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = build(view.state)
      }
      update(u: ViewUpdate): void {
        if (u.docChanged || u.selectionSet) this.decorations = build(u.state)
      }
    },
    { decorations: (v) => v.decorations }
  )
}
