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
    ['* only\n\nafter', '* only\n\nafter'],
    ['```\n- \n', '```\n- \n']
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

  it('leaves spaces at the edges of a selection outside the markers', () => {
    const e = editor('a word here', 1, 7) // " word "
    toggleWrap('*')(e.view as never)
    expect(e.text()).toBe('a *word* here')
  })

  it('across lines, wraps each line on its own, after list and quote markers', () => {
    const e = editor('- one\n- two\n\n> three', 0, '- one\n- two\n\n> three'.length)
    toggleWrap('**')(e.view as never)
    expect(e.text()).toBe('- **one**\n- **two**\n\n> **three**')
    toggleWrap('**')(e.view as never)
    expect(e.text()).toBe('- one\n- two\n\n> three')
  })

  it('unwraps when the markers are selected too, rather than doubling them', () => {
    const bold = editor('a **word** here', 2, 10)
    toggleWrap('**')(bold.view as never)
    expect(bold.text()).toBe('a word here')
    const u = editor('a <u>word</u> here', 2, 13)
    toggleWrap('<u>', '</u>')(u.view as never)
    expect(u.text()).toBe('a word here')
    // ⌘I on selected bold adds italic; it doesn't strip a star from each side.
    const it = editor('**bold**', 0, 8)
    toggleWrap('*')(it.view as never)
    expect(it.text()).toBe('***bold***')
  })

  it('two formatted spans selected together are not taken for one', () => {
    const e = editor('*a* and *b*', 0, 11)
    toggleWrap('*')(e.view as never)
    expect(e.text()).not.toBe('a* and *b')
  })

  it('with just a cursor, puts the cursor between the new markers', () => {
    const e = editor('a  b', 2)
    toggleWrap('**')(e.view as never)
    expect(e.text()).toBe('a **** b')
    expect(e.state().selection.main.head).toBe(4)
  })

  it('tells italic from bold: ⌘I inside bold gives bold italic, and back', () => {
    const e = editor('**bold**', 2, 6)
    toggleWrap('*')(e.view as never)
    expect(e.text()).toBe('***bold***')
    toggleWrap('**')(e.view as never)
    expect(e.text()).toBe('*bold*')
    toggleWrap('*')(e.view as never)
    expect(e.text()).toBe('bold')
  })

  it.each([
    ['<u>', '</u>', '<u>word</u>'],
    ['~~', '~~', '~~word~~'],
    ['`', '`', '`word`']
  ])('wraps and unwraps %s', (open, close, wrapped) => {
    const e = editor('word', 0, 4)
    toggleWrap(open, close)(e.view as never)
    expect(e.text()).toBe(wrapped)
    toggleWrap(open, close)(e.view as never)
    expect(e.text()).toBe('word')
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
