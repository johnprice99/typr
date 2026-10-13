import { commentsField, stripComments } from '../editor/comments'
import { $, app } from './context'

// The quiet line at the bottom right: words, reading time and comments.
// Counting reads the whole document, so it waits for a pause in typing.

let timer = 0
let idle = 0

export function scheduleStats(): void {
  clearTimeout(timer)
  cancelIdleCallback(idle)
  timer = window.setTimeout(() => {
    idle = requestIdleCallback(updateStats, { timeout: 1000 })
  }, 250)
}

export function updateStats(): void {
  const { state } = app.editor.view
  const sel = state.selection.main
  const text = stripComments(sel.empty ? state.doc.toString() : state.sliceDoc(sel.from, sel.to))
  const words = text.match(/[\p{L}\p{N}'’-]+/gu)?.length ?? 0
  const mins = Math.max(1, Math.round(words / 230))
  const notes = state.field(commentsField).length
  const parts = [
    words ? `${words.toLocaleString()} ${sel.empty ? 'words' : 'selected'}` : '',
    words ? `${mins} min` : '',
    notes ? `${notes} comment${notes === 1 ? '' : 's'}` : ''
  ]
  // An empty page stays empty; the only hint lives down here, out of the way.
  $('stats').textContent = state.doc.length === 0 ? '⇧⌘P for commands' : parts.filter(Boolean).join(' · ')
}
