import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { ensureSyntaxTree } from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { commentsField, findComments, listComments, stripComments } from '../../src/renderer/src/editor/comments'

describe('comments (CriticMarkup)', () => {
  it('finds a comment and the positions of its parts', () => {
    const src = 'The {==harbour==}{>>check spelling<<} was quiet.'
    const [c] = findComments(src)
    expect(c.text).toBe('harbour')
    expect(c.note).toBe('check spelling')
    expect(src.slice(c.from, c.to)).toBe('{==harbour==}{>>check spelling<<}')
    expect(src.slice(c.textFrom, c.textTo)).toBe('harbour')
    expect(src.slice(c.noteFrom, c.noteTo)).toBe('check spelling')
  })

  it('allows a space between the highlight and the note', () => {
    expect(findComments('{==a==} {>>b<<}')).toHaveLength(1)
  })

  it('finds several comments', () => {
    expect(findComments('{==a==}{>>1<<} and {==b==}{>>2<<}').map((c) => c.note)).toEqual(['1', '2'])
  })

  it('never spans paragraphs', () => {
    expect(findComments('{==start\n\nend==}{>>note<<}')).toHaveLength(0)
  })

  it('a stray marker or plain highlight never hides a later comment', () => {
    expect(findComments('A plain {==highlight==} here.\n\nThe {==real==}{>>note<<} one.').map((c) => c.note)).toEqual(['note'])
    expect(findComments('Stray {== marker\n\nThen {==a==}{>>b<<}').map((c) => c.note)).toEqual(['b'])
  })

  it('treats a note with no text as ordinary text', () => {
    expect(findComments('a lone {>>note<<} here')).toHaveLength(0)
  })

  it('strips comments down to the text they were on', () => {
    expect(stripComments('The {==harbour==}{>>check<<} was quiet.')).toBe('The harbour was quiet.')
  })
})

describe('the live comment list', () => {
  const make = (doc: string) => EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage }), commentsField] })
  const parsed = (state: EditorState) => (ensureSyntaxTree(state, state.doc.length, 1000), state)

  it('follows the text as you type elsewhere, without rescanning', () => {
    let state = parsed(make('Intro. The {==harbour==}{>>check<<} was quiet.'))
    const before = listComments(state)[0]
    state = state.update({ changes: { from: 0, insert: 'New words. ' } }).state
    const after = listComments(state)[0]
    expect(after.from).toBe(before.from + 'New words. '.length)
    expect(state.sliceDoc(after.textFrom, after.textTo)).toBe('harbour')
    expect(after.note).toBe('check')
  })

  it('notices when a comment is typed or edited', () => {
    let state = parsed(make('The harbour was quiet.'))
    expect(listComments(state)).toHaveLength(0)
    state = state.update({ changes: { from: 4, insert: '{==' } }).state
    state = state.update({ changes: { from: 14, insert: '==}{>>note<<}' } }).state
    expect(listComments(state).map((c) => c.note)).toEqual(['note'])
  })

  it('notices a comment made by deleting a blank line', () => {
    let state = parsed(make('{==a\n\nb==}{>>note<<}'))
    expect(listComments(state)).toHaveLength(0)
    state = state.update({ changes: { from: 4, to: 5 } }).state
    expect(listComments(state).map((c) => c.note)).toEqual(['note'])
  })

  it('ignores comment markup inside code', () => {
    const state = parsed(make('Real {==one==}{>>yes<<}\n\n`{==code==}{>>no<<}`\n\n```\n{==block==}{>>no<<}\n```'))
    expect(listComments(state).map((c) => c.note)).toEqual(['yes'])
  })
})
