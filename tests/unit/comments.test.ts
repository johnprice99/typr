import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { ensureSyntaxTree } from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import type { MarkdownParser } from '@lezer/markdown'
import {
  commentsField,
  criticSyntax,
  findComments,
  listComments,
  outcome,
  protectMarkup,
  stripComments
} from '../../src/renderer/src/editor/comments'

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

describe('suggestions (CriticMarkup)', () => {
  it('finds a replacement with its note, and the positions of its parts', () => {
    const src = 'He ran. {~~Old habit.~>It was an old habit.~~}{>>R2.1: fragment.<<} The stone'
    const [c] = findComments(src)
    expect(c.kind).toBe('replace')
    expect(src.slice(c.from, c.to)).toBe('{~~Old habit.~>It was an old habit.~~}{>>R2.1: fragment.<<}')
    expect(src.slice(c.textFrom, c.textTo)).toBe('Old habit.')
    expect(src.slice(c.newFrom, c.newTo)).toBe('It was an old habit.')
    expect(src.slice(c.noteFrom, c.noteTo)).toBe('R2.1: fragment.')
    expect([c.text, c.newText, c.note]).toEqual(['Old habit.', 'It was an old habit.', 'R2.1: fragment.'])
  })

  it('finds additions and cuts', () => {
    const src = 'sound{--, like a drum--}{>>R2.3<<}. Then{++ a new line.++}{>>R2.12<<}'
    const [cut, add] = findComments(src)
    expect([cut.kind, cut.text, cut.note]).toEqual(['cut', ', like a drum', 'R2.3'])
    expect([add.kind, add.text, add.note]).toEqual(['add', ' a new line.', 'R2.12'])
    expect(src.slice(add.textFrom, add.textTo)).toBe(' a new line.')
  })

  it('allows a suggestion without a note', () => {
    const src = 'a {~~b~>c~~} d {++e++} f {--g--}'
    const list = findComments(src)
    expect(list.map((c) => c.kind)).toEqual(['replace', 'add', 'cut'])
    for (const c of list) {
      expect(c.note).toBe('')
      expect(c.noteFrom).toBe(c.to)
      expect(src.slice(c.to - 3, c.to)).toMatch(/^(~~|\+\+|--)\}$/)
    }
  })

  it('never spans paragraphs, and a stray marker never hides later markup', () => {
    expect(findComments('{~~a\n\nb~>c~~}')).toHaveLength(0)
    expect(findComments('Stray {~~ here\n\nThen {--x--}{>>n<<}').map((c) => c.kind)).toEqual(['cut'])
    expect(findComments('{~~a~~} and {++b++}').map((c) => c.kind)).toEqual(['add'])
  })

  it('an empty suggestion is not one', () => {
    expect(findComments('{++++} {----} {~~~>~~}')).toHaveLength(0)
    expect(findComments('{~~~>new~~} {~~old~>~~}').map((c) => c.kind)).toEqual(['replace', 'replace'])
  })

  it('accepting and rejecting leave the right text, without the note', () => {
    const [r, a, c, h] = findComments('{~~old~>new~~}{>>n<<} {++in++}{>>n<<} {--out--}{>>n<<} {==hl==}{>>n<<}')
    expect([outcome(r, true), outcome(r, false)]).toEqual(['new', 'old'])
    expect([outcome(a, true), outcome(a, false)]).toEqual(['in', ''])
    expect([outcome(c, true), outcome(c, false)]).toEqual(['', 'out'])
    expect(outcome(h, false)).toBe('hl')
  })

  it('counts the text as it stands: old text kept, additions and notes left out', () => {
    expect(stripComments('A {~~b~>c~~}{>>n<<} d{++ e++}{>>n<<} f{-- g--}.')).toBe('A b d f g.')
  })

  it('is not read as strikethrough or subscript', () => {
    const tree = (markdownLanguage.parser as MarkdownParser)
      .configure(criticSyntax)
      .parse('A {~~old~>new~~}{>>n<<} and {~~a~>b~~} ~~real~~.')
    const names: string[] = []
    tree.iterate({ enter: (n) => void names.push(n.name) })
    expect(names.filter((n) => n === 'Strikethrough')).toHaveLength(1)
    expect(names).not.toContain('Subscript')
  })

  it('leaves tildes outside a suggestion to Markdown', () => {
    const names: string[] = []
    const parser = (markdownLanguage.parser as MarkdownParser).configure(criticSyntax)
    parser.parse('~~real~~} and H~2~> and gem ~> 2').iterate({ enter: (n) => void names.push(n.name) })
    expect(names).toContain('Strikethrough')
    expect(names).toContain('Subscript')
    expect(names).not.toContain('CriticMark')
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

  it('notices a suggestion as it is typed, and follows its parts', () => {
    let state = parsed(make('The harbour was quiet.'))
    state = state.update({ changes: { from: 12, insert: '{--' } }).state
    state = state.update({ changes: { from: 19, insert: '--}' } }).state
    expect(listComments(state).map((c) => [c.kind, c.text])).toEqual([['cut', 'was ']])
    state = state.update({ changes: { from: 0, insert: 'So. ' } }).state
    const [c] = listComments(state)
    expect(state.sliceDoc(c.from, c.to)).toBe('{--was --}')
  })

  it('notices a note joined to its suggestion by deleting a space', () => {
    let state = parsed(make('{++a++}  {>>n<<}'))
    expect(listComments(state).map((c) => c.note)).toEqual([''])
    state = state.update({ changes: { from: 8, to: 9 } }).state
    expect(listComments(state).map((c) => c.note)).toEqual(['n'])
  })

  it('notices a suggestion made by typing on a blank line', () => {
    let state = parsed(make('{--a\n\nb--}'))
    expect(listComments(state)).toHaveLength(0)
    state = state.update({ changes: { from: 5, insert: 'x' } }).state
    expect(listComments(state).map((c) => c.text)).toEqual(['a\nx\nb'])
  })

  it('notices a comment made by deleting a blank line', () => {
    let state = parsed(make('{==a\n\nb==}{>>note<<}'))
    expect(listComments(state)).toHaveLength(0)
    state = state.update({ changes: { from: 4, to: 5 } }).state
    expect(listComments(state).map((c) => c.note)).toEqual(['note'])
  })

  describe('in the formatted view, typing and deleting keep the hidden markup whole', () => {
    const live = (doc: string) =>
      parsed(EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage }), commentsField, protectMarkup] }))
    const del = (doc: string, from: number, to: number, userEvent = 'delete.backward') =>
      live(doc).update({ changes: { from, to }, userEvent }).state.doc.toString()
    const doc = 'A {~~old~>new~~}{>>why<<} z'

    it('a deletion into the markup leaves the markup', () => {
      expect(del(doc, doc.indexOf('~~}'), doc.indexOf(' z'))).toBe(doc)
      // From before the suggestion into its new text: only the visible text goes.
      expect(del(doc, 1, doc.indexOf('ew'), 'delete.selection')).toBe('A{~~~>ew~~}{>>why<<} z')
    })

    it('deleting all the text it shows removes the whole thing', () => {
      const cut = 'A {--x--}{>>why<<} z'
      expect(del(cut, 5, 6)).toBe('A  z')
      expect(del(doc, 5, doc.indexOf('~~}'), 'delete.selection')).toBe('A  z')
    })

    it('deleting across the whole of one is fine, and so are our own edits', () => {
      expect(del(doc, 0, doc.length, 'delete.selection')).toBe('')
      expect(del(doc, doc.indexOf('{>>'), doc.indexOf(' z'), 'input')).toBe('A {~~old~>new~~} z')
    })

    it('typing over a selection that reaches into the markup keeps it', () => {
      const s = live(doc)
      const out = s.update({ changes: { from: 4, to: doc.indexOf('ew'), insert: 'X' }, userEvent: 'input.type' }).state
      expect(out.doc.toString()).toBe('A {~~X~>ew~~}{>>why<<} z')
    })

    it('typing never goes into hidden markup, and the cursor ends up after what was typed', () => {
      const c = 'a {==bc==}{>>note<<} de'
      // A cursor left inside the note (by Find, say) types at its nearer edge.
      const at = c.indexOf('ote')
      expect(
        live(c)
          .update({ changes: { from: at, insert: 'Q' }, userEvent: 'input.type' })
          .state.doc.toString()
      ).toBe('a {==bc==}{>>note<<}Q de')
      const typed = live(c).update({
        changes: { from: c.indexOf('c=='), to: c.indexOf('e', c.indexOf(' de')), insert: 'Z' },
        selection: { anchor: c.indexOf('c==') + 1 },
        userEvent: 'input.type'
      }).state
      expect(typed.doc.toString()).toBe('a {==bZ==}{>>note<<}e')
      expect(typed.selection.main.head).toBe(typed.doc.toString().indexOf('Z') + 1)
    })

    it('dragging part of one away leaves its markup', () => {
      const c = 'a {==bc==}{>>note<<} de'
      const out = live(c).update({
        changes: [
          { from: c.indexOf('c=='), to: c.indexOf(' de') },
          { from: c.length, insert: 'c==}{>>note<<}' }
        ],
        userEvent: 'move.drop'
      }).state
      expect(out.doc.toString()).toBe('a {==b==}{>>note<<} dec==}{>>note<<}')
    })

    it('markup that spans lines is left as it is: it shows', () => {
      const lines = 'A {--x\ny--} z'
      expect(del(lines, 6, 8)).toBe('A {--x--} z')
    })
  })

  it('ignores comment markup inside code', () => {
    const state = parsed(make('Real {==one==}{>>yes<<}\n\n`{==code==}{>>no<<}`\n\n```\n{==block==}{>>no<<}\n```'))
    expect(listComments(state).map((c) => c.note)).toEqual(['yes'])
  })
})
