import { EditorState } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'

// Small questions about the Markdown structure, shared by the editor features.

const CODE = new Set(['InlineCode', 'FencedCode', 'CodeBlock'])

/** Whether `pos` is inside code (a fenced or indented block, or `inline code`). */
export function inCode(state: EditorState, pos: number, side: -1 | 1 = 1): boolean {
  for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, side); n; n = n.parent) {
    if (CODE.has(n.name)) return true
  }
  return false
}

/** [[wikilinks]], optionally [[target|label]]. Not part of the Markdown grammar, so found by pattern. */
export const WIKILINK = /\[\[([^[\]\n]+?)\]\]/g
