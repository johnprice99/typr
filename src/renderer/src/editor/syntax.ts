import { EditorState, Extension } from '@codemirror/state'
import { DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'

// Small questions about the Markdown structure, and helpers shared by the editor features.

/** Whether any selection range (or the cursor) touches from…to: there, the formatted view shows the Markdown. */
export const touched = (state: EditorState, from: number, to: number): boolean =>
  state.selection.ranges.some((r) => r.from <= to && r.to >= from)

/**
 * Decorations from a view plugin, rebuilt when the text, the visible part, the
 * selection or the parse changes (the parse can finish after a keystroke).
 */
export const decorations = (build: (view: EditorView) => DecorationSet): Extension =>
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = build(view)
      }
      update(u: ViewUpdate): void {
        if (u.docChanged || u.viewportChanged || u.selectionSet || syntaxTree(u.startState) !== syntaxTree(u.state)) {
          this.decorations = build(u.view)
        }
      }
    },
    { decorations: (v) => v.decorations }
  )

const CODE = new Set(['InlineCode', 'FencedCode', 'CodeBlock'])

/** Whether `pos` is inside code (a fenced or indented block, or `inline code`). */
export function inCode(state: EditorState, pos: number, side: -1 | 1 = 1): boolean {
  for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, side); n; n = n.parent) {
    if (CODE.has(n.name)) return true
  }
  return false
}
