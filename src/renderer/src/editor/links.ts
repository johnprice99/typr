import { EditorState, Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'

// Ordinary Markdown links: [text](address), <address> and bare web addresses.
// ⌘-click (or ⌘↩ with the cursor in one) follows it.

/** The address of the link under `pos`, if any. */
export function linkAt(state: EditorState, pos: number): string | null {
  for (const side of [-1, 1] as const) {
    for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, side); n; n = n.parent) {
      if (n.name === 'URL') return state.sliceDoc(n.from, n.to).replace(/^<|>$/g, '')
      if (n.name === 'Link' || n.name === 'Image' || n.name === 'Autolink') {
        const u = n.getChild('URL')
        if (u) return state.sliceDoc(u.from, u.to).replace(/^<|>$/g, '')
        break
      }
    }
  }
  return null
}

export function links(follow: (url: string) => void): Extension {
  return EditorView.domEventHandlers({
    mousedown(e, view) {
      if (!e.metaKey) return false
      const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
      const url = pos == null ? null : linkAt(view.state, pos)
      if (!url) return false
      e.preventDefault()
      follow(url)
      return true
    }
  })
}
