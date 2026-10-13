import { listComments, stripComments } from '../editor/comments'
import { frontmatterRange } from '../editor/frontmatter'
import { $, app } from './context'
import { needsAPlace } from './session'

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
  // Count the writing, not the front matter or comment notes.
  const front = frontmatterRange(state)
  const start = sel.empty ? (front ? front.to : 0) : sel.from
  const text = stripComments(state.sliceDoc(start, sel.empty ? state.doc.length : sel.to))
  // A word has at least one letter or digit (so "---" and " - " don't count).
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0
  const mins = Math.max(1, Math.round(words / 230))
  const notes = listComments(state).length
  const parts = [
    words ? `${words.toLocaleString()} ${sel.empty ? 'words' : 'selected'}` : '',
    words ? `${mins} min` : '',
    notes ? `${notes} comment${notes === 1 ? '' : 's'}` : ''
  ]
  // An empty page stays empty; the only hints live down here, out of the way.
  if (state.doc.length === 0) $('stats').textContent = '⇧⌘P for commands'
  else if (needsAPlace()) $('stats').textContent = [...parts, 'Not saved yet · ⌘S to choose where'].filter(Boolean).join(' · ')
  else $('stats').textContent = parts.filter(Boolean).join(' · ')
}
