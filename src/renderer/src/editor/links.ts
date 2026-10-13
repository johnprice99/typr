import { EditorState, Extension } from '@codemirror/state'
import { Decoration, EditorView, MatchDecorator, ViewPlugin, ViewUpdate, DecorationSet } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { autocompletion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import type { SyntaxNode } from '@lezer/common'
import { WIKILINK } from './syntax'

export type Link = { kind: 'wiki'; target: string } | { kind: 'url'; url: string }

const WIKI = WIKILINK

const bracket = Decoration.mark({ class: 'md-mark' })
const wiki = Decoration.mark({ class: 'md-wikilink' })

const decorator = new MatchDecorator({
  regexp: WIKI,
  decorate(add, from, to) {
    add(from, from + 2, bracket)
    add(from + 2, to - 2, wiki)
    add(to - 2, to, bracket)
  }
})

const wikiDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = decorator.createDeco(view)
    }
    update(u: ViewUpdate): void {
      this.decorations = decorator.updateDeco(u, this.decorations)
    }
  },
  { decorations: (v) => v.decorations }
)

/** The link under `pos`, if any: a [[wikilink]], a [markdown](link) or a bare URL. */
export function linkAt(state: EditorState, pos: number): Link | null {
  const line = state.doc.lineAt(pos)
  for (const m of line.text.matchAll(WIKI)) {
    const from = line.from + m.index!
    if (pos >= from && pos <= from + m[0].length) return { kind: 'wiki', target: m[1] }
  }
  for (const side of [-1, 1] as const) {
    for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, side); n; n = n.parent) {
      if (n.name === 'URL') return { kind: 'url', url: state.sliceDoc(n.from, n.to).replace(/^<|>$/g, '') }
      if (n.name === 'Link' || n.name === 'Image' || n.name === 'Autolink') {
        const u = n.getChild('URL')
        if (u) return { kind: 'url', url: state.sliceDoc(u.from, u.to).replace(/^<|>$/g, '') }
        break
      }
    }
  }
  return null
}

export function links(opts: { follow: (link: Link) => void; names: () => string[] }): Extension {
  const complete = (ctx: CompletionContext): CompletionResult | null => {
    const m = ctx.matchBefore(/\[\[[^[\]\n]*/)
    if (!m) return null
    const closed = ctx.state.sliceDoc(ctx.pos, ctx.pos + 2) === ']]'
    return {
      from: m.from + 2,
      options: opts.names().map((label) => ({ label, apply: closed ? label : `${label}]]` })),
      validFor: /^[^[\]\n]*$/
    }
  }
  return [
    wikiDecorations,
    autocompletion({ override: [complete], icons: false }),
    EditorView.domEventHandlers({
      mousedown(e, view) {
        if (!e.metaKey) return false
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
        const link = pos == null ? null : linkAt(view.state, pos)
        if (!link) return false
        e.preventDefault()
        opts.follow(link)
        return true
      }
    })
  ]
}
