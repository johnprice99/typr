import { Extension } from '@codemirror/state'
import { DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { buildRaw, fontKey, refresh, refreshMarks } from './markdown'
import { buildLive, LiveOptions } from './live'
import { CommentActions, comments } from './comments'
import { renderedTables } from './tables'
import { propertiesBox } from './frontmatter'

/** How the document is laid out: formatted (live preview) or as raw Markdown. */
export function layout(live: LiveOptions | null, commentActions: CommentActions): Extension {
  const build = (view: EditorView): DecorationSet => (live ? buildLive(view, live) : buildRaw(view))
  return [
    EditorView.editorAttributes.of({ class: live ? 'cm-live' : 'cm-raw' }),
    comments(live !== null, commentActions),
    live ? [renderedTables, propertiesBox] : [],
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet
        font = ''
        constructor(view: EditorView) {
          this.decorations = build(view)
          this.checkFont(view)
        }
        update(u: ViewUpdate): void {
          const rebuild =
            u.docChanged ||
            u.viewportChanged ||
            // In the formatted view, syntax shows and hides as the cursor moves.
            (live !== null && u.selectionSet) ||
            syntaxTree(u.startState) !== syntaxTree(u.state) ||
            u.transactions.some((tr) => tr.effects.some((e) => e.is(refresh)))
          if (rebuild) this.decorations = build(u.view)
          if (u.geometryChanged) this.checkFont(u.view)
        }
        /** The text size follows the window width, so a resize can change the font; check in the measure phase. */
        checkFont(view: EditorView): void {
          view.requestMeasure({
            key: this,
            read: () => fontKey(view),
            write: (font) => {
              if (font === this.font) return
              const first = this.font === ''
              this.font = font
              if (!first) setTimeout(() => view.dom.isConnected && refreshMarks(view))
            }
          })
        }
      },
      { decorations: (v) => v.decorations }
    )
  ]
}
