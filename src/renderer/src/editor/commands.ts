import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { insertNewlineContinueMarkupCommand } from '@codemirror/lang-markdown'
import { inCode } from './syntax'

// Editing commands. They only use view.state and view.dispatch, so they can be
// tested without a browser.

export type Target = Pick<EditorView, 'state' | 'dispatch'>

const stars = (text: string, from: number, dir: 1 | -1): number => {
  let n = 0
  for (let i = dir === 1 ? from : from - 1; i >= 0 && i < text.length && text[i] === '*'; i += dir) n++
  return n
}

/** A list item, quote or heading marker at the start of a line: formatting goes after it. */
const BLOCK_MARKER = /^[ \t]*(?:(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?|(?:>[ \t]?)+|#{1,6}[ \t]+)/

/**
 * The parts of from…to to format: one per line (emphasis can't span a blank
 * line), after any list, quote or heading marker, without spaces at the edges
 * ("*word *" wouldn't be italic). A cursor gives one empty part.
 */
function parts(state: EditorState, from: number, to: number): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = []
  const multiline = state.doc.lineAt(from).number !== state.doc.lineAt(to).number
  for (let pos = from; pos <= to;) {
    const line = state.doc.lineAt(pos)
    let a = Math.max(from, line.from)
    let b = Math.min(to, line.to)
    const marker = BLOCK_MARKER.exec(line.text)
    if (marker && a < line.from + marker[0].length && from !== to) a = Math.min(b, line.from + marker[0].length)
    while (a < b && /\s/.test(state.sliceDoc(a, a + 1))) a++
    while (b > a && /\s/.test(state.sliceDoc(b - 1, b))) b--
    // Across lines, code is left as it is.
    const code = multiline && inCode(state, a)
    if ((a < b && !code) || from === to) out.push({ from: a, to: b })
    pos = line.to + 1
  }
  return out
}

/**
 * Wraps the selection in `open`…`close` (e.g. "**", or "<u>" and "</u>"), or
 * unwraps it if it's already wrapped, whether the markers are just outside the
 * selection or selected with it. Across several lines, each line is wrapped on
 * its own. "*" (italic) and "**" (bold) are told apart, so ⌘I in bold text gives
 * bold italic rather than breaking it.
 */
export function toggleWrap(open: string, close = open) {
  const o = open.length
  const c = close.length
  const isStars = /^\*+$/.test(open)
  /** For "*" / "**": whether a run of n stars on both sides already makes this style. */
  const starsWrap = (n: number): boolean => (o === 1 ? n === 1 || n === 3 : n >= 2)

  /** Where this part's markers are, if it's already wrapped. */
  const wrapped = (state: EditorState, p: { from: number; to: number }): 'outside' | 'inside' | null => {
    const inner = state.sliceDoc(p.from, p.to)
    if (isStars) {
      const line = state.doc.lineAt(p.from)
      const at = p.from - line.from
      if (starsWrap(Math.min(stars(line.text, at, -1), stars(line.text, at + inner.length, 1)))) return 'outside'
      // Selected with its stars, and one span ("*a* and *b*" is two).
      const n = Math.min(stars(inner, 0, 1), stars(inner, inner.length, -1))
      return !/^\**$/.test(inner) && starsWrap(n) && !inner.slice(n, -n).includes('*') ? 'inside' : null
    }
    if (state.sliceDoc(p.from - o, p.from) === open && state.sliceDoc(p.to, p.to + c) === close) return 'outside'
    const middle = inner.slice(o, inner.length - c)
    return inner.length >= o + c &&
      inner.startsWith(open) &&
      inner.endsWith(close) &&
      !middle.includes(open) &&
      !middle.includes(close)
      ? 'inside'
      : null
  }

  return (view: Target): boolean => {
    const { state } = view
    view.dispatch(
      state.changeByRange((range) => {
        const list = parts(state, range.from, range.to)
        if (!list.length) return { range }
        const found = list.map((p) => wrapped(state, p))
        // All already wrapped: unwrap them all. Otherwise wrap the rest.
        const unwrap = found.every(Boolean)
        const changes = list.flatMap((p, i): { from: number; to?: number; insert?: string }[] => {
          if (unwrap) {
            return found[i] === 'outside'
              ? [
                  { from: p.from - o, to: p.from },
                  { from: p.to, to: p.to + c }
                ]
              : [
                  { from: p.from, to: p.from + o },
                  { from: p.to - c, to: p.to }
                ]
          }
          return found[i]
            ? []
            : [
                { from: p.from, insert: open },
                { from: p.to, insert: close }
              ]
        })
        const set = state.changes(changes)
        const first = list[0]
        const last = list[list.length - 1]
        // A cursor lands between the markers; a selection keeps covering the text
        // (across lines, the markers too, so pressing it again unwraps every line).
        if (first.from === last.to && !unwrap) return { changes: set, range: EditorSelection.cursor(first.from + o) }
        const side = list.length > 1 ? 1 : -1
        return { changes: set, range: EditorSelection.range(set.mapPos(first.from, -side), set.mapPos(last.to, side)) }
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
