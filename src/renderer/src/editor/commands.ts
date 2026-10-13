import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { insertNewlineContinueMarkupCommand } from '@codemirror/lang-markdown'
import { inCode } from './syntax'

// Editing commands. They only use view.state and view.dispatch, so they can be
// tested without a browser.

type Target = Pick<EditorView, 'state' | 'dispatch'>

const stars = (text: string, from: number, dir: 1 | -1): number => {
  let n = 0
  for (let i = dir === 1 ? from : from - 1; i >= 0 && i < text.length && text[i] === '*'; i += dir) n++
  return n
}

/**
 * Wraps the selection in `open`…`close` (e.g. "**", or "<u>" and "</u>"), or
 * unwraps it if it's already wrapped. Spaces at the edges of the selection are
 * left outside, since "*word *" wouldn't be italic. "*" (italic) and "**" (bold)
 * are told apart, so ⌘I in bold text gives bold italic rather than breaking it.
 */
export function toggleWrap(open: string, close = open) {
  return (view: Target): boolean => {
    const { state } = view
    const o = open.length
    const c = close.length
    view.dispatch(
      state.changeByRange((range) => {
        let { from, to } = range
        while (from < to && /\s/.test(state.sliceDoc(from, from + 1))) from++
        while (to > from && /\s/.test(state.sliceDoc(to - 1, to))) to--
        const doc = state.doc
        // Is it already wrapped just outside the selection?
        let wrapped: boolean
        if (/^\*+$/.test(open)) {
          const line = doc.lineAt(from)
          const text = line.text
          const n = Math.min(stars(text, from - line.from, -1), stars(text, to - line.from, 1))
          wrapped = o === 1 ? n === 1 || n === 3 : n >= 2
        } else {
          wrapped = state.sliceDoc(from - o, from) === open && state.sliceDoc(to, to + c) === close
        }
        if (wrapped) {
          return {
            changes: [
              { from: from - o, to: from },
              { from: to, to: to + c }
            ],
            range: EditorSelection.range(from - o, to - o)
          }
        }
        return {
          changes: [
            { from, insert: open },
            { from: to, insert: close }
          ],
          range: EditorSelection.range(from + o, to + o)
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
  // Inside code, "- " or "> " is just text: Enter is a plain new line.
  if (inCode(state, sel.head, -1)) return false
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
