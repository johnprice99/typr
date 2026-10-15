import {
  addComment,
  Comment,
  commentAt,
  editComment,
  goToComment as goTo,
  isSuggestion,
  listComments,
  same
} from '../editor/comments'
import { inCode } from '../editor/syntax'
import { openPrompt } from '../ui/palette'
import { app, notify } from './context'

// Comments and suggestions for proofreading: adding and editing comments, and
// moving from one to the next. (Resolving, accepting and rejecting are on the card.)

const snippet = (s: string, n = 40): string => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s)
const quote = (s: string, n?: number): string => `“${snippet(s.replace(/\s+/g, ' '), n)}”`

/** Add a comment on the selection (or the word at the cursor), or edit the one you're in. */
export function promptComment(existing?: Comment): void {
  const view = app.editor.view
  const { state } = view
  const sel = state.selection.main
  const comment = existing ? commentAt(state, existing.from) : commentAt(state, sel.head)
  if (comment && isSuggestion(comment)) return notify('Accept or reject the suggestion first')
  if (comment) {
    openPrompt({
      placeholder: 'Comment…',
      value: comment.note,
      submit: (note) => {
        // The document may have changed while the prompt was open; find the comment again.
        const fresh = commentAt(view.state, comment.from)
        if (same(fresh, comment)) editComment(view, fresh, note)
        else notify('The comment moved; try again')
      }
    })
    return
  }
  if (inCode(state, sel.from)) return notify('Comments can’t go in code')
  let { from, to } = sel
  if (sel.empty) {
    const word = state.wordAt(sel.head)
    if (word) ({ from, to } = word)
  }
  const text = state.sliceDoc(from, to)
  if (!text.trim()) return notify('Select some text to comment on')
  // Wrapping text that overlaps another comment would produce broken markup.
  if (listComments(state).some((c) => c.from < to && c.to > from))
    return notify('That overlaps an existing comment or suggestion')
  if (/\n[ \t]*\n/.test(text)) return notify('A comment can only cover one paragraph')
  openPrompt({
    placeholder: `Comment on ${quote(text, 30)}…`,
    submit: (note) => {
      if (view.state.sliceDoc(from, to) === text) addComment(view, from, to, note)
      else notify('The text changed; try again')
    }
  })
}

/** Next (or previous) comment or suggestion, where its card shows. */
export function goToComment(forward: boolean): void {
  const moved = goTo(app.editor.view, forward)
  if (moved === 'none') notify('No comments in this document')
  else if (moved === 'only') notify('That’s the only comment')
  else if (moved === 'wrapped') notify(forward ? 'Back to the first comment' : 'Back to the last comment')
}
