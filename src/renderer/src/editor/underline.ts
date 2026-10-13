import { Extension, Range } from '@codemirror/state'
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view'
import { inCode } from './syntax'

// Markdown has no underline, so the usual way is HTML: <u>text</u>. It's shown
// underlined in both views; in the formatted view the tags are hidden except
// where you're editing.

const UNDERLINE = /<u>([^<\n]+?)<\/u>/g
const underline = Decoration.mark({ class: 'md-underline' })
const tag = Decoration.mark({ class: 'md-mark' })
const hidden = Decoration.replace({})

function build(view: EditorView, live: boolean): DecorationSet {
  const { state } = view
  const ranges = state.selection.ranges
  const out: Range<Decoration>[] = []
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = state.doc.lineAt(pos)
      for (const m of line.text.matchAll(UNDERLINE)) {
        const start = line.from + m.index!
        const end = start + m[0].length
        if (inCode(state, start)) continue
        const touched = ranges.some((r) => r.from <= end && r.to >= start)
        const marks = live && !touched ? hidden : tag
        out.push(marks.range(start, start + 3), underline.range(start + 3, end - 4), marks.range(end - 4, end))
      }
      pos = line.to + 1
    }
  }
  return Decoration.set(out, true)
}

export const underlines = (live: boolean): Extension =>
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = build(view, live)
      }
      update(u: ViewUpdate): void {
        if (u.docChanged || u.viewportChanged || (live && u.selectionSet)) this.decorations = build(u.view, live)
      }
    },
    { decorations: (v) => v.decorations }
  )
