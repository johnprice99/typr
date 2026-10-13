import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { frontmatterRange, frontmatterSyntax, readProperties } from '../../src/renderer/src/editor/frontmatter'

const parse = (doc: string): EditorState => {
  const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage, extensions: [frontmatterSyntax] })] })
  ensureSyntaxTree(state, doc.length, 1000)
  return state
}
const topLevel = (state: EditorState): string[] => {
  const out: string[] = []
  const c = syntaxTree(state).topNode.cursor()
  if (c.firstChild())
    do out.push(c.name)
    while (c.nextSibling())
  return out
}

const STORY =
  '---\ntitle: The Beast of Briarfen\norder: 1\nsummary: Livestock are dying.\n---\n\n# Chapter 1\n\nThe village sat low.\n\n---\n\n# Chapter 2\n'

describe('front matter', () => {
  it('is recognised at the top, instead of a rule and a giant heading', () => {
    const state = parse(STORY)
    expect(topLevel(state)).toEqual(['Frontmatter', 'ATXHeading1', 'Paragraph', 'HorizontalRule', 'ATXHeading1'])
    const r = frontmatterRange(state)!
    expect(state.sliceDoc(r.from, r.to)).toBe('---\ntitle: The Beast of Briarfen\norder: 1\nsummary: Livestock are dying.\n---')
  })

  it('is recognised when the closing fence is typed later, in a long document', () => {
    const top = '---\ntitle: x\n'
    const body = Array.from({ length: 400 }, (_, i) => `Paragraph ${i}.\n`).join('\n')
    let state = parse(top + body)
    expect(topLevel(state)[0]).toBe('HorizontalRule')
    for (const [i, ch] of [...'---\n'].entries()) {
      state = state.update({ changes: { from: top.length + i, insert: ch } }).state
      ensureSyntaxTree(state, state.doc.length, 1000)
    }
    expect(topLevel(state)[0]).toBe('Frontmatter')
  })

  it('only counts at the very start, and only when closed', () => {
    expect(topLevel(parse('Intro\n\n---\ntitle: x\n---\n'))).not.toContain('Frontmatter')
    expect(topLevel(parse('---\ntitle: never closed\n\nText'))).not.toContain('Frontmatter')
    expect(topLevel(parse('---\n---\nText'))[0]).toBe('Frontmatter')
  })

  it('reads simple properties for display, and gives up on anything complex', () => {
    expect(readProperties('title: "The Beast"\norder: 1\ntags:\n  - moor\n  - quarry')).toEqual([
      { key: 'title', value: 'The Beast' },
      { key: 'order', value: '1' },
      { key: 'tags', value: 'moor, quarry' }
    ])
    expect(readProperties('just some words')).toBeNull()
  })
})
