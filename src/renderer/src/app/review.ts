import { EditorView } from '@codemirror/view'
import { addComment, Comment, commentAt, commentsField, editComment, resolveComment } from '../editor/comments'
import { openList, openPrompt } from '../ui/palette'
import { app, notify } from './context'

// Comments for proofreading: adding, editing, resolving and jumping between them.

const snippet = (s: string, n = 40): string => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s)

/** Add a comment on the selection (or the word at the cursor), or edit the one you're in. */
export function promptComment(existing?: Comment): void {
  const view = app.editor.view
  const { state } = view
  const sel = state.selection.main
  const comment = existing ? commentAt(state, existing.from) : commentAt(state, sel.head)
  if (comment) {
    openPrompt({
      placeholder: 'Comment…',
      value: comment.note,
      submit: (note) => {
        // The document may have changed while the prompt was open; find the comment again.
        const fresh = commentAt(view.state, comment.from)
        if (fresh && fresh.note === comment.note && fresh.text === comment.text) editComment(view, fresh, note)
        else notify('The comment moved; try again')
      }
    })
    return
  }
  let { from, to } = sel
  if (sel.empty) {
    const word = state.wordAt(sel.head)
    if (word) ({ from, to } = word)
  }
  const text = state.sliceDoc(from, to)
  if (!text.trim()) return notify('Select some text to comment on')
  if (/\n[ \t]*\n/.test(text)) return notify('A comment can only cover one paragraph')
  openPrompt({
    placeholder: `Comment on “${snippet(text.replace(/\s+/g, ' '), 30)}”…`,
    submit: (note) => {
      if (view.state.sliceDoc(from, to) === text) addComment(view, from, to, note)
      else notify('The text changed; try again')
    }
  })
}

export function resolveAtCursor(): void {
  const view = app.editor.view
  const c = commentAt(view.state, view.state.selection.main.head)
  if (c) resolveComment(view, c)
  else notify('No comment here')
}

export function goToComment(): void {
  const view = app.editor.view
  const list = view.state.field(commentsField)
  if (!list.length) return notify('No comments in this document')
  openList({
    placeholder: 'Go to comment…',
    items: list.map((c) => ({
      label: c.note || '(empty comment)',
      detail: `“${snippet(c.text.replace(/\s+/g, ' '))}”`,
      run: () => {
        view.dispatch({
          selection: { anchor: c.textFrom, head: c.textTo },
          effects: EditorView.scrollIntoView(c.textFrom, { y: 'center' })
        })
        view.focus()
      }
    }))
  })
}
