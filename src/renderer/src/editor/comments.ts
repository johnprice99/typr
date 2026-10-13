import { EditorState, Extension, Range, StateField } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { decorations, inCode } from './syntax'
import { Decoration, DecorationSet, EditorView, hoverTooltip } from '@codemirror/view'

// Comments use CriticMarkup, so they live in the file itself and travel with it:
//   {==the text you're commenting on==}{>>your note<<}
// A comment always sits on some text.
// In the formatted view only the highlight shows; hover it to read the note.

export interface Comment {
  from: number
  to: number
  /** The highlighted text. */
  textFrom: number
  textTo: number
  noteFrom: number
  noteTo: number
  note: string
  text: string
}

// The text and the note may not contain another comment's markers or a blank
// line, so a stray "{==" can never swallow (or hide) the comments after it, and
// matching never has to scan ahead to the end of the document.
const RE = /\{==((?:(?!==\}|\{==|\n[ \t]*\n)[\s\S])*?)==\}[ \t]?\{>>((?:(?!<<\}|\{>>|\n[ \t]*\n)[\s\S])*?)<<\}/g

export function findComments(src: string): Comment[] {
  const out: Comment[] = []
  RE.lastIndex = 0
  for (let m; (m = RE.exec(src));) {
    const from = m.index
    const to = from + m[0].length
    const textFrom = from + 3
    const textTo = textFrom + m[1].length
    const noteFrom = to - 3 - m[2].length
    out.push({ from, to, textFrom, textTo, noteFrom, noteTo: to - 3, note: m[2], text: m[1] })
  }
  return out
}

/** The document text with comment markup and notes removed, for word counts and names. */
export const stripComments = (src: string): string => src.replace(RE, (_m, text) => text)

/** Comment markup inside code (a code block or `inline code`) is code, not a comment. */
const outsideCode = (state: EditorState, list: Comment[]): Comment[] => list.filter((c) => !inCode(state, c.from))

/** Characters that can start, end or break a comment. */
const MARKUP = /[{}=<>]/
/** …and deleting a line break can join a comment's two halves. */
const DELETED_MARKUP = /[{}=<>\n]/

interface Comments {
  /** Everything that looks like a comment. */
  found: Comment[]
  /** …minus anything inside code: the real comments. */
  visible: Comment[]
}

function scan(state: EditorState): Comments {
  const found = findComments(state.doc.toString())
  return { found, visible: outsideCode(state, found) }
}

/** The comments in the document, kept up to date cheaply as you type. */
export const commentsField = StateField.define<Comments>({
  create: scan,
  update(value, tr) {
    const reparsed = syntaxTree(tr.startState) !== syntaxTree(tr.state)
    if (!tr.docChanged) {
      // The parse can finish later; only the cheap code check needs redoing.
      return reparsed ? { found: value.found, visible: outsideCode(tr.state, value.found) } : value
    }
    // Most keystrokes can't create or break a comment: shift the known ones instead of rescanning.
    let rescan = false
    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      if (rescan) return
      if (MARKUP.test(inserted.toString()) || DELETED_MARKUP.test(tr.startState.sliceDoc(fromA, toA))) rescan = true
      else if (value.found.some((c) => fromA <= c.to && toA >= c.from)) rescan = true
    })
    if (rescan) return scan(tr.state)
    const map = (pos: number, assoc: -1 | 1): number => tr.changes.mapPos(pos, assoc)
    const found = value.found.map((c) => ({
      ...c,
      from: map(c.from, 1),
      to: map(c.to, -1),
      textFrom: map(c.textFrom, 1),
      textTo: map(c.textTo, -1),
      noteFrom: map(c.noteFrom, 1),
      noteTo: map(c.noteTo, -1)
    }))
    return { found, visible: outsideCode(tr.state, found) }
  }
})

/** The real comments in the document, in order. */
export const listComments = (state: EditorState): Comment[] => state.field(commentsField, false)?.visible ?? []

export function commentAt(state: EditorState, pos: number): Comment | null {
  return listComments(state).find((c) => pos >= c.from && pos <= c.to) ?? null
}

const cleanNote = (note: string): string =>
  note
    .replace(/<<\}|\{>>/g, '')
    .replace(/\s+/g, ' ')
    .trim()

export function addComment(view: EditorView, from: number, to: number, note: string): void {
  const n = cleanNote(note)
  if (!n || from === to) return
  const tail = `{>>${n}<<}`
  const changes = [
    { from, insert: '{==' },
    { from: to, insert: `==}${tail}` }
  ]
  view.dispatch({ changes, selection: { anchor: to + 3 + 3 + tail.length }, userEvent: 'input' })
}

export function editComment(view: EditorView, c: Comment, note: string): void {
  const n = cleanNote(note)
  if (!n) return resolveComment(view, c)
  view.dispatch({ changes: { from: c.noteFrom, to: c.noteTo, insert: n }, userEvent: 'input' })
}

/** Removes the comment and keeps the text it was on. */
export function resolveComment(view: EditorView, c: Comment): void {
  view.dispatch({ changes: { from: c.from, to: c.to, insert: c.text }, userEvent: 'delete' })
}

// ---------- display ----------

const highlight = Decoration.mark({ class: 'md-comment' })
const mark = Decoration.mark({ class: 'md-mark' })
const noteMark = Decoration.mark({ class: 'md-comment-note' })
const hidden = Decoration.replace({})

function build(view: EditorView, live: boolean): DecorationSet {
  const { state } = view
  const sel = state.selection.ranges
  // Strict, so the markup stays hidden when the cursor sits just after a comment.
  const inside = (c: Comment): boolean => sel.some((r) => r.from < c.to && r.to > c.from)
  const out: Range<Decoration>[] = []
  for (const c of listComments(state)) {
    if (c.textTo > c.textFrom) out.push(highlight.range(c.textFrom, c.textTo))
    // A comment whose markup spans lines stays visible as Markdown: CodeMirror
    // can't hide a line break from a view plugin.
    const oneLine = state.doc.lineAt(c.from).number === state.doc.lineAt(c.to).number
    if (live && !inside(c) && oneLine) {
      out.push(hidden.range(c.from, c.textFrom), hidden.range(c.textTo, c.to))
    } else {
      out.push(mark.range(c.from, c.textFrom), mark.range(c.textTo, c.noteFrom))
      if (c.noteTo > c.noteFrom) out.push(noteMark.range(c.noteFrom, c.noteTo))
      out.push(mark.range(c.noteTo, c.to))
    }
  }
  return Decoration.set(out, true)
}

export interface CommentActions {
  edit: (c: Comment) => void
}

export function comments(live: boolean, actions: CommentActions): Extension {
  const tip = hoverTooltip(
    (view, pos) => {
      const c = commentAt(view.state, pos)
      if (!c) return null
      return {
        pos: c.textFrom,
        end: c.to,
        above: true,
        create() {
          const dom = document.createElement('div')
          dom.className = 'comment-tip'
          const note = document.createElement('p')
          note.textContent = c.note
          const row = document.createElement('div')
          row.className = 'comment-tip-actions'
          const button = (label: string, run: () => void): HTMLButtonElement => {
            const b = document.createElement('button')
            b.textContent = label
            b.addEventListener('mousedown', (e) => {
              e.preventDefault()
              run()
            })
            return b
          }
          // The document may have changed since the card opened; act on the comment as it is now.
          const fresh = (): Comment | null => {
            const now = commentAt(view.state, c.from)
            return now && now.note === c.note && now.text === c.text ? now : null
          }
          row.append(
            button('Edit', () => {
              const now = fresh()
              if (now) actions.edit(now)
            }),
            button('Resolve', () => {
              const now = fresh()
              if (now) resolveComment(view, now)
            })
          )
          dom.append(note, row)
          return { dom }
        }
      }
    },
    { hoverTime: 250, hideOnChange: true }
  )

  return [decorations((view) => build(view, live)), tip]
}
