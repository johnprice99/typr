import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState, Transaction, TransactionSpec } from '@codemirror/state'
import { ensureSyntaxTree } from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { enter, insertLink, toggleWrap } from '../../src/renderer/src/editor/commands'
import { paragraphAt, sentenceAt } from '../../src/renderer/src/editor/focus'

// A minimal stand-in for an EditorView: the commands only need state and dispatch.
function editor(doc: string, cursor = doc.length, head = cursor) {
  let state = EditorState.create({
    doc,
    selection: EditorSelection.range(cursor, head),
    extensions: [markdown({ base: markdownLanguage })]
  })
  const view = {
    get state() {
      return state
    },
    dispatch(spec: Transaction | TransactionSpec) {
      state = spec instanceof Transaction ? spec.state : state.update(spec).state
    }
  }
  const type = (text: string): void => {
    for (const ch of text) {
      if (ch === '\n') {
        ensureSyntaxTree(state, state.doc.length, 1000)
        if (!enter(view as never)) view.dispatch(state.replaceSelection('\n'))
      } else {
        view.dispatch(state.replaceSelection(ch))
      }
    }
  }
  return { view, type, text: () => state.doc.toString(), state: () => state }
}

describe('Enter in lists and quotes', () => {
  it.each([
    ['* one\ntwo\n\nafter', '* one\n* two\n\nafter'],
    ['- [ ] task\nnext\n\np', '- [ ] task\n- [ ] next\n\np'],
    ['1. a\nb\n\np', '1. a\n2. b\n\np'],
    ['> quote\n\nafter', '> quote\n\nafter'],
    ['* only\n\nafter', '* only\n\nafter']
  ])('typing %j gives %j', (keys, result) => {
    const e = editor('')
    e.type(keys)
    expect(e.text()).toBe(result)
  })
})

describe('formatting commands', () => {
  it('wraps and unwraps bold', () => {
    const e = editor('a word here', 2, 6)
    toggleWrap('**')(e.view as never)
    expect(e.text()).toBe('a **word** here')
    toggleWrap('**')(e.view as never)
    expect(e.text()).toBe('a word here')
  })

  it('makes a link with the address left empty', () => {
    const e = editor('See the map.', 4, 11)
    insertLink(e.view as never)
    expect(e.text()).toBe('See [the map]().')
    expect(e.text().slice(0, e.state().selection.main.head)).toBe('See [the map](') // cursor inside the ()
  })
})

describe('focus blocks', () => {
  const doc = '# Title\n## Sub\nThe paragraph\nwraps here.\n- one\n- two\n\nOne sentence. Two sentence.'
  const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] })
  ensureSyntaxTree(state, doc.length, 1000)
  const at = (needle: string): number => doc.indexOf(needle) + 1
  const text = (r: { from: number; to: number }): string => doc.slice(r.from, r.to)

  it('treats a heading, a paragraph and a list item as separate blocks', () => {
    expect(text(paragraphAt(state, at('Title')))).toBe('# Title')
    expect(text(paragraphAt(state, at('Sub')))).toBe('## Sub')
    expect(text(paragraphAt(state, at('wraps')))).toBe('The paragraph\nwraps here.')
    expect(text(paragraphAt(state, at('two')))).toBe('- two')
  })

  it('finds the sentence under the cursor', () => {
    expect(text(sentenceAt(state, at('Two sentence')))).toBe('Two sentence.')
  })
})
