import { EditorState, Extension, Transaction } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

// Typewriter scrolling: the line you're typing stays near the middle of the
// window instead of drifting down to the bottom edge. Only typing and moving
// with the keyboard scroll the page; clicking never moves it under the mouse.
// Room below the last line (see style.css) lets the end of a document reach
// the middle too.

const fromKeyboard = (tr: Transaction): boolean =>
  tr.isUserEvent('input') ||
  tr.isUserEvent('delete') ||
  tr.isUserEvent('undo') ||
  tr.isUserEvent('redo') ||
  (tr.isUserEvent('select') && !tr.isUserEvent('select.pointer'))

export const typewriter: Extension = [
  EditorView.editorAttributes.of({ class: 'cm-typewriter' }),
  EditorState.transactionExtender.of((tr) =>
    (tr.docChanged || tr.selection) && fromKeyboard(tr)
      ? { effects: EditorView.scrollIntoView(tr.newSelection.main.head, { y: 'center' }) }
      : null
  )
]
