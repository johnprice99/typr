import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { insertNewlineContinueMarkupCommand } from '@codemirror/lang-markdown'

// Editing commands. They only use view.state and view.dispatch, so they can be
// tested without a browser.

type Target = Pick<EditorView, 'state' | 'dispatch'>

/** Wraps the selection in `mark`, or unwraps it if it's already wrapped. */
export function toggleWrap(mark: string) {
  return (view: Target): boolean => {
    const { state } = view
    const n = mark.length
    view.dispatch(
      state.changeByRange((range) => {
        const before = state.sliceDoc(range.from - n, range.from)
        const after = state.sliceDoc(range.to, range.to + n)
        if (before === mark && after === mark) {
          return {
            changes: [
              { from: range.from - n, to: range.from },
              { from: range.to, to: range.to + n }
            ],
            range: EditorSelection.range(range.from - n, range.to - n)
          }
        }
        return {
          changes: [
            { from: range.from, insert: mark },
            { from: range.to, insert: mark }
          ],
          range: EditorSelection.range(range.from + n, range.to + n)
        }
      })
    )
    return true
  }
}

export const URL_RE = /^(?:https?:\/\/|mailto:)\S+$/i

/** Wraps the selection as [text](url). The cursor lands where you still need to type. */
export function insertLink(view: Target, url = ''): boolean {
  const { state } = view
  view.dispatch(
    state.changeByRange((range) => {
      const text = state.sliceDoc(range.from, range.to)
      const insert = `[${text}](${url})`
      const anchor = !text ? range.from + 1 : !url ? range.from + text.length + 3 : range.from + insert.length
      return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.cursor(anchor) }
    })
  )
  return true
}

const continueList = insertNewlineContinueMarkupCommand({ nonTightLists: false })
const EMPTY_ITEM = /^(?:(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]*)?|(?:>[ \t]?)+)$/

/**
 * Enter continues a list or quote. On an empty top-level item (or an empty
 * "> ") it ends it with a blank line, so what you type next is a real
 * paragraph (in Markdown, a line straight after a list item or quote still
 * belongs to it).
 */
export function enter(view: Target): boolean {
  const { state } = view
  const sel = state.selection.main
  if (state.selection.ranges.length === 1 && sel.empty) {
    const line = state.doc.lineAt(sel.head)
    if (sel.head === line.to && EMPTY_ITEM.test(line.text)) {
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: '\n' },
        selection: { anchor: line.from + 1 },
        scrollIntoView: true,
        userEvent: 'input'
      })
      return true
    }
  }
  return continueList(view)
}
