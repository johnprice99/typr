import { Extension, Range } from '@codemirror/state'
import { Decoration, DecorationSet, EditorView } from '@codemirror/view'
import { decorations, inCode, touched } from './syntax'

// Markdown has no underline, so the usual way is HTML: <u>text</u>. It's shown
// underlined in both views; in the formatted view the tags are hidden except
// where you're editing.

const UNDERLINE = /<u>([^<\n]+?)<\/u>/g
const underline = Decoration.mark({ class: 'md-underline' })
const tag = Decoration.mark({ class: 'md-mark' })
const hidden = Decoration.replace({})

function build(view: EditorView, live: boolean): DecorationSet {
  const { state } = view
  const out: Range<Decoration>[] = []
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = state.doc.lineAt(pos)
      for (const m of line.text.matchAll(UNDERLINE)) {
        const start = line.from + m.index!
        const end = start + m[0].length
        if (inCode(state, start)) continue
        const marks = live && !touched(state, start, end) ? hidden : tag
        out.push(marks.range(start, start + 3), underline.range(start + 3, end - 4), marks.range(end - 4, end))
      }
      pos = line.to + 1
    }
  }
  return Decoration.set(out, true)
}

export const underlines = (live: boolean): Extension => decorations((view) => build(view, live))
