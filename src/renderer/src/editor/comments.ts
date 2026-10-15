import {
  ChangeSet,
  ChangeSpec,
  EditorSelection,
  EditorState,
  Extension,
  findClusterBreak,
  Prec,
  Range,
  StateEffect,
  StateField,
  Transaction
} from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import type { InlineContext, MarkdownConfig } from '@lezer/markdown'
import { inCode } from './syntax'
import {
  Decoration,
  DecorationSet,
  EditorView,
  keymap,
  showTooltip,
  Tooltip,
  ViewPlugin,
  ViewUpdate,
  WidgetType
} from '@codemirror/view'

// Comments and suggestions use CriticMarkup, so they live in the file itself and travel with it:
//   {==the text you're commenting on==}{>>your note<<}
//   {~~old~>new~~}  {++added++}  {--cut--}   (each optionally followed by {>>a note<<})
// A comment always sits on some text. A suggestion is accepted or rejected, and
// its note goes either way.
// In the formatted view the markup and notes stay hidden; rest the cursor in
// one to see its note and buttons.

export type Kind = 'comment' | 'replace' | 'add' | 'cut'

export interface Comment {
  kind: Kind
  from: number
  to: number
  /** The highlighted, old, added or cut text. */
  textFrom: number
  textTo: number
  text: string
  /** The replacement, for a 'replace' suggestion (otherwise empty, at textTo). */
  newFrom: number
  newTo: number
  newText: string
  /** The note (empty, at `to`, for a suggestion without one). */
  noteFrom: number
  noteTo: number
  note: string
}

export const isSuggestion = (c: Comment): boolean => c.kind !== 'comment'

// No part may contain another opener or a blank line, so a stray "{==" can
// never swallow (or hide) the markup after it, and matching never has to scan
// ahead to the end of the document.
const part = (close: string): string => String.raw`((?:(?!${close}|\{==|\{~~|\{\+\+|\{--|\{>>|\n[ \t]*\n)[\s\S])*?)`
const NOTE = String.raw`[ \t]?\{>>${part(String.raw`<<\}`)}<<\}`
const RE = new RegExp(
  [
    String.raw`\{==${part(String.raw`==\}`)}==\}${NOTE}`,
    // (An empty suggestion would show nothing at all, so it isn't one.)
    String.raw`(?:\{~~(?!~>~~\})${part(String.raw`~>|~~\}`)}~>${part(String.raw`~~\}`)}~~\}`,
    String.raw`\{\+\+(?!\+\+\})${part(String.raw`\+\+\}`)}\+\+\}`,
    String.raw`\{--(?!--\})${part(String.raw`--\}`)}--\})(?:${NOTE})?`
  ].join('|'),
  'g'
)

function parse(m: RegExpExecArray): Comment {
  const from = m.index
  const to = from + m[0].length
  const [, hlText, hlNote, oldText, newText, added, cut, sugNote] = m
  const kind: Kind = hlText !== undefined ? 'comment' : oldText !== undefined ? 'replace' : added !== undefined ? 'add' : 'cut'
  const text = hlText ?? oldText ?? added ?? cut
  const note = hlNote ?? sugNote
  const textFrom = from + 3
  const textTo = textFrom + text.length
  const newFrom = kind === 'replace' ? textTo + 2 : textTo
  const newTo = newFrom + (kind === 'replace' ? newText.length : 0)
  const noteTo = note === undefined ? to : to - 3
  const noteFrom = note === undefined ? to : noteTo - note.length
  return { kind, from, to, textFrom, textTo, text, newFrom, newTo, newText: newText ?? '', noteFrom, noteTo, note: note ?? '' }
}

export function findComments(src: string): Comment[] {
  const out: Comment[] = []
  RE.lastIndex = 0
  for (let m; (m = RE.exec(src));) out.push(parse(m))
  return out
}

/** What a comment or suggestion leaves behind when it's resolved, accepted or rejected. */
export function outcome(c: Comment, accept: boolean): string {
  if (c.kind === 'replace') return accept ? c.newText : c.text
  if (c.kind === 'add') return accept ? c.text : ''
  if (c.kind === 'cut') return accept ? '' : c.text
  return c.text
}

/** The document text as it stands, without markup, notes or suggested changes: for word counts and names. */
export function stripComments(src: string): string {
  let out = ''
  let last = 0
  for (const c of findComments(src)) {
    out += src.slice(last, c.from) + outcome(c, false)
    last = c.to
  }
  return out + src.slice(last)
}

// GFM would read the tildes in {~~old~>new~~} as strikethrough (and "~>new~" as
// subscript), so the parser treats them as markup of their own.
export const criticSyntax: MarkdownConfig = {
  defineNodes: [{ name: 'CriticMark' }],
  parseInline: [
    {
      name: 'CriticMark',
      before: 'Strikethrough',
      parse(cx: InlineContext, next: number, pos: number): number {
        if (next === 123 && cx.slice(pos, pos + 3) === '{~~') return cx.addElement(cx.elt('CriticMark', pos, pos + 3))
        if (next !== 126) return -1
        const len = cx.slice(pos, pos + 3) === '~~}' ? 3 : cx.char(pos + 1) === 62 ? 2 : 0
        // "~>" and "~~}" only mean this inside an open "{~~"; elsewhere they're ordinary Markdown.
        const before = len ? cx.slice(cx.offset, pos) : ''
        const open = before.lastIndexOf('{~~')
        if (!len || open < 0 || before.includes('~~}', open)) return -1
        return cx.addElement(cx.elt('CriticMark', pos, pos + len))
      }
    }
  ]
}

/** Markup inside code (a code block or `inline code`) is code, not a comment. */
const outsideCode = (state: EditorState, list: Comment[]): Comment[] => list.filter((c) => !inCode(state, c.from))

/** Characters that can start, end or break a comment or suggestion. */
const MARKUP = /[{}=<>~+-]/
/** …and deleting a line break can join a comment's two halves. */
const DELETED_MARKUP = /[{}=<>~+\n-]/

interface Comments {
  /** Everything that looks like a comment or suggestion. */
  found: Comment[]
  /** …minus anything inside code: the real ones. */
  visible: Comment[]
}

function scan(state: EditorState): Comments {
  const found = findComments(state.doc.toString())
  return { found, visible: outsideCode(state, found) }
}

/** The comments and suggestions in the document, kept up to date cheaply as you type. */
export const commentsField = StateField.define<Comments>({
  create: scan,
  update(value, tr) {
    const reparsed = syntaxTree(tr.startState) !== syntaxTree(tr.state)
    if (!tr.docChanged) {
      // The parse can finish later; only the cheap code check needs redoing.
      return reparsed ? { found: value.found, visible: outsideCode(tr.state, value.found) } : value
    }
    // Most keystrokes can't create or break a comment: shift the known ones instead of rescanning.
    let rescan = false
    const doc = tr.startState.doc
    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      if (rescan) return
      if (MARKUP.test(inserted.toString()) || DELETED_MARKUP.test(doc.sliceString(fromA, toA))) rescan = true
      else if (value.found.some((c) => fromA <= c.to && toA >= c.from)) rescan = true
      // Deleting next to a brace can join markup to its note ("…++} {>>"),
      // and typing on a blank line can join two paragraphs' halves.
      else if (toA > fromA && /[{}]/.test(doc.sliceString(Math.max(0, fromA - 1), fromA) + doc.sliceString(toA, toA + 1)))
        rescan = true
      else if (/^[ \t]*$/.test(doc.lineAt(fromA).text)) rescan = true
    })
    if (rescan) return scan(tr.state)
    const map = (pos: number, assoc: -1 | 1): number => tr.changes.mapPos(pos, assoc)
    const found = value.found.map((c) => ({
      ...c,
      from: map(c.from, 1),
      to: map(c.to, -1),
      textFrom: map(c.textFrom, 1),
      textTo: map(c.textTo, -1),
      newFrom: map(c.newFrom, 1),
      newTo: map(c.newTo, -1),
      noteFrom: map(c.noteFrom, 1),
      noteTo: map(c.noteTo, -1)
    }))
    return { found, visible: outsideCode(tr.state, found) }
  }
})

/** The real comments and suggestions in the document, in order. */
export const listComments = (state: EditorState): Comment[] => state.field(commentsField, false)?.visible ?? []

/** The comment or suggestion at `pos`. */
export function commentAt(state: EditorState, pos: number): Comment | null {
  return listComments(state).find((c) => pos >= c.from && pos <= c.to) ?? null
}

/** Whether `now` is still the comment or suggestion `then` (the document may have changed since). */
export const same = (now: Comment | null, then: Comment): now is Comment =>
  !!now && now.kind === then.kind && now.note === then.note && now.text === then.text && now.newText === then.newText

const cleanNote = (note: string): string =>
  note
    .replace(/<<\}|\{>>/g, '')
    .replace(/\s+/g, ' ')
    .trim()

export function addComment(view: EditorView, from: number, to: number, note: string): void {
  const n = cleanNote(note)
  if (!n || from === to) return
  const tail = `{>>${n}<<}`
  const changes = [
    { from, insert: '{==' },
    { from: to, insert: `==}${tail}` }
  ]
  view.dispatch({ changes, selection: { anchor: to + 3 + 3 + tail.length }, userEvent: 'input' })
}

export function editComment(view: EditorView, c: Comment, note: string): void {
  const n = cleanNote(note)
  if (!n) return resolveComment(view, c)
  view.dispatch({ changes: { from: c.noteFrom, to: c.noteTo, insert: n }, userEvent: 'input' })
}

/** Removes the comment and keeps the text it was on. */
export function resolveComment(view: EditorView, c: Comment): void {
  view.dispatch({ changes: { from: c.from, to: c.to, insert: c.text }, userEvent: 'delete' })
}

/** Accepts or rejects a suggestion; its note goes either way. */
export function settleSuggestion(view: EditorView, c: Comment, accept: boolean): void {
  view.dispatch({ changes: { from: c.from, to: c.to, insert: outcome(c, accept) }, userEvent: 'delete' })
}

/** CriticMarkup in some text, which would break the comment or suggestion it went into. */
const MARKUP_IN_TEXT = /\{(==|~~|\+\+|--|>>)|(==|~~|\+\+|--|<<)\}|~>/

// ---------- display ----------

const highlight = Decoration.mark({ class: 'md-comment' })
const oldMark = Decoration.mark({ class: 'md-sugg-old' })
const newMark = Decoration.mark({ class: 'md-sugg-new' })
const mark = Decoration.mark({ class: 'md-mark' })
const noteMark = Decoration.mark({ class: 'md-comment-note' })
const hidden = Decoration.replace({})

/** Where the hidden "~>" was: a space between the old text and the new. */
class Gap extends WidgetType {
  eq(): boolean {
    return true
  }
  toDOM(): HTMLElement {
    const s = document.createElement('span')
    s.textContent = ' '
    return s
  }
}
const gap = Decoration.replace({ widget: new Gap() })

/** A stretch of hidden markup. The "~>" between old and new text is a `gap`: it shows as a space. */
interface Part {
  from: number
  to: number
  gap: boolean
}

/**
 * The parts of a comment or suggestion the formatted view hides: its markup
 * and note. None if it spans lines: CodeMirror can't hide a line break from a
 * view plugin, so that one stays visible as Markdown.
 */
function hiddenParts(state: EditorState, c: Comment): Part[] {
  if (state.doc.lineAt(c.from).number !== state.doc.lineAt(c.to).number) return []
  const parts: Part[] = [{ from: c.from, to: c.textFrom, gap: false }]
  if (c.kind === 'replace') parts.push({ from: c.textTo, to: c.newFrom, gap: c.textTo > c.textFrom && c.newTo > c.newFrom })
  parts.push({ from: c.newTo, to: c.to, gap: false })
  return parts.filter((p) => p.to > p.from)
}

const allHidden = (state: EditorState): Part[] => listComments(state).flatMap((c) => hiddenParts(state, c))

/** `pos`, moved to the nearer edge if it's inside hidden markup. */
export function outsideMarkup(state: EditorState, pos: number): number {
  const p = allHidden(state).find((p) => p.from < pos && pos < p.to)
  return !p ? pos : pos - p.from <= p.to - pos ? p.from : p.to
}

function build(view: EditorView, live: boolean): { decorations: DecorationSet; atomic: DecorationSet } {
  const { state } = view
  const out: Range<Decoration>[] = []
  const atoms: Range<Decoration>[] = []
  const add = (deco: Decoration, from: number, to: number): void => {
    if (to > from) out.push(deco.range(from, to))
  }
  for (const c of listComments(state)) {
    const textMark = c.kind === 'comment' ? highlight : c.kind === 'add' ? newMark : oldMark
    add(textMark, c.textFrom, c.textTo)
    add(newMark, c.newFrom, c.newTo)
    const parts = live ? hiddenParts(state, c) : []
    if (parts.length) {
      for (const p of parts) {
        add(p.gap ? gap : hidden, p.from, p.to)
        atoms.push(hidden.range(p.from, p.to))
      }
    } else {
      add(mark, c.from, c.textFrom)
      add(mark, c.textTo, c.newFrom)
      add(mark, c.newTo, c.noteFrom)
      add(noteMark, c.noteFrom, c.noteTo)
      add(mark, c.noteTo, c.to)
    }
  }
  return { decorations: Decoration.set(out, true), atomic: Decoration.set(atoms, true) }
}

const display = (live: boolean) =>
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      atomic: DecorationSet
      constructor(view: EditorView) {
        ;({ decorations: this.decorations, atomic: this.atomic } = build(view, live))
      }
      update(u: ViewUpdate): void {
        if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) {
          ;({ decorations: this.decorations, atomic: this.atomic } = build(u.view, live))
        }
      }
    },
    {
      decorations: (v) => v.decorations,
      // The cursor steps over hidden markup rather than stopping inside it.
      provide: (plugin) => EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomic ?? Decoration.none)
    }
  )

// ---------- editing around hidden markup (formatted view) ----------

const overlap = (a: number, b: number, c: number, d: number): number => Math.max(0, Math.min(b, d) - Math.max(a, c))

/** Edits made by hand. (Our own commands, and find and replace, work on the raw text.) */
const BY_HAND = ['input.type', 'input.paste', 'input.drop', 'move.drop', 'delete']

/**
 * Typing, pasting, dragging and deleting never take out part of the hidden
 * markup, which would break it and spill the raw Markdown onto the page, and
 * never put text inside it. Deleting all the text a comment or suggestion
 * shows removes the whole thing; deleting across the whole of one is fine.
 */
export const protectMarkup = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !BY_HAND.some((e) => tr.isUserEvent(e))) return tr
  const state = tr.startState
  const list = listComments(state)
  if (!list.length) return tr
  let changed = false
  let count = 0
  /** Where the cursor goes after a change we rewrote (in the old document). */
  let cursorAt = -1
  const specs: ChangeSpec[] = []
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    count++
    const text = inserted.toString()
    // A cursor can be left inside hidden markup (by Find, or by switching
    // views): edit from its edge instead.
    let from = outsideMarkup(state, fromA)
    let to = Math.max(from, outsideMarkup(state, toA))
    const original = from === fromA && to === toA
    const keep: Part[] = []
    for (const c of from < to ? list : []) {
      if (to <= c.from || from >= c.to || (from <= c.from && to >= c.to)) continue
      const parts = hiddenParts(state, c)
      if (!parts.length) continue
      const shown = c.textTo - c.textFrom + (c.newTo - c.newFrom)
      const cut = overlap(from, to, c.textFrom, c.textTo) + overlap(from, to, c.newFrom, c.newTo)
      if (!text && cut >= shown) {
        from = Math.min(from, c.from)
        to = Math.max(to, c.to)
      } else keep.push(...parts)
    }
    const pieces: [number, number][] = []
    let at = from
    for (const p of keep.sort((x, y) => x.from - y.from)) {
      if (p.to <= at || p.from >= to) continue
      if (p.from > at) pieces.push([at, p.from])
      at = Math.max(at, p.to)
    }
    if (at < to) pieces.push([at, to])
    if (original && pieces.length === 1 && pieces[0][0] === fromA && pieces[0][1] === toA) {
      specs.push({ from: fromA, to: toA, insert: text })
      return
    }
    changed = true
    if (!pieces.length) pieces.push([from, from])
    pieces.forEach(([a, b], i) => specs.push({ from: a, to: b, insert: i ? '' : text }))
    cursorAt = pieces[0][1]
  })
  if (!changed) return tr
  const changes = ChangeSet.of(specs, state.doc.length)
  // A single cursor goes after what was typed; anything else keeps its place.
  const one = count === 1 && !!tr.selection && tr.selection.ranges.length === 1 && tr.selection.main.empty
  const selection = one
    ? EditorSelection.cursor(changes.mapPos(cursorAt, 1))
    : tr.selection?.map(tr.changes.invert(state.doc)).map(changes)
  return {
    changes,
    selection,
    effects: tr.effects,
    scrollIntoView: tr.scrollIntoView,
    userEvent: tr.annotation(Transaction.userEvent),
    annotations: tr.annotation(Transaction.addToHistory) === false ? Transaction.addToHistory.of(false) : []
  }
})

/** The text from…to, leaving out the hidden markup of anything it only partly covers. */
function visibleSlice(state: EditorState, from: number, to: number): string {
  const skip = listComments(state)
    .filter((c) => c.from < to && c.to > from && !(from <= c.from && to >= c.to))
    .flatMap((c) => hiddenParts(state, c))
    .sort((a, b) => a.from - b.from)
  let out = ''
  let at = from
  for (const p of skip) {
    if (p.to <= at || p.from >= to) continue
    out += state.sliceDoc(at, Math.max(at, p.from))
    at = Math.max(at, p.to)
  }
  return out + state.sliceDoc(at, Math.max(at, to))
}

// Copying part of a comment copies what you see, not half its markup; pasting
// into one leaves out any markup, which would break it.
const clipboard = [
  EditorView.clipboardOutputFilter.of((text, state) => {
    const ranges = state.selection.ranges
    if (ranges.some((r) => r.empty) || ranges.map((r) => state.sliceDoc(r.from, r.to)).join(state.lineBreak) !== text) return text
    return ranges.map((r) => visibleSlice(state, r.from, r.to)).join(state.lineBreak)
  }),
  EditorView.clipboardInputFilter.of((text, state) => {
    const { from, to } = state.selection.main
    const inside = listComments(state).some((c) => c.from < from && to < c.to)
    return inside ? text.replace(new RegExp(MARKUP_IN_TEXT.source, 'g'), '') : text
  })
]

/** From `pos`, past any hidden markup in that direction; `gap` if that was the space between old and new text. */
function pastMarkup(state: EditorState, pos: number, forward: boolean): { pos: number; gap: boolean } {
  const parts = allHidden(state)
  for (let moved = true; moved;) {
    moved = false
    for (const p of parts) {
      if (pos !== (forward ? p.from : p.to)) continue
      pos = forward ? p.to : p.from
      if (p.gap) return { pos, gap: true }
      moved = true
    }
  }
  return { pos, gap: false }
}

/** One character on from `pos`. */
function step(state: EditorState, pos: number, forward: boolean): number {
  const line = state.doc.lineAt(pos)
  if (pos === (forward ? line.to : line.from)) return forward ? Math.min(pos + 1, state.doc.length) : Math.max(pos - 1, 0)
  return line.from + findClusterBreak(line.text, pos - line.from, forward)
}

/**
 * The arrow keys next to hidden markup move past it and on by one visible
 * character (or onto the far side of the space between old and new text), so
 * a key press never seems to do nothing.
 */
const arrowPast =
  (forward: boolean) =>
  (view: EditorView): boolean => {
    const sel = view.state.selection
    if (sel.ranges.length > 1 || !sel.main.empty) return false
    const { pos, gap } = pastMarkup(view.state, sel.main.head, forward)
    if (pos === sel.main.head) return false
    const to = gap || pos === (forward ? view.state.doc.length : 0) ? pos : step(view.state, pos, forward)
    view.dispatch({ selection: { anchor: to }, userEvent: 'select', scrollIntoView: true })
    return true
  }

/**
 * Backspace and Delete next to hidden markup: move past it, then let the usual
 * commands delete (so Backspace at the start of a list item still removes the
 * bullet, as it would without the comment there).
 */
const deletePast =
  (forward: boolean) =>
  (view: EditorView): boolean => {
    const sel = view.state.selection
    if (sel.ranges.length > 1 || !sel.main.empty) return false
    const { pos } = pastMarkup(view.state, sel.main.head, forward)
    if (pos !== sel.main.head) view.dispatch({ selection: { anchor: pos } })
    return false
  }

const markupKeys = Prec.highest(
  keymap.of([
    { key: 'ArrowLeft', run: arrowPast(false) },
    { key: 'ArrowRight', run: arrowPast(true) },
    { key: 'Backspace', run: deletePast(false) },
    { key: 'Delete', run: deletePast(true) }
  ])
)

// ---------- the card, when the cursor rests in one ----------

export interface CommentActions {
  edit: (c: Comment) => void
  /** The card's ‹ and ›: on to the previous or next comment. */
  step: (forward: boolean) => void
}

const UNNOTED: Record<Kind, string> = {
  comment: '',
  replace: 'Suggested change',
  add: 'Suggested addition',
  cut: 'Suggested cut'
}

/** What the card calls it. */
const noteLabel = (c: Comment): string => c.note || UNNOTED[c.kind] || '(empty comment)'

function card(view: EditorView, c: Comment, actions: CommentActions): { dom: HTMLElement } {
  const dom = document.createElement('div')
  dom.className = 'comment-tip'
  const note = document.createElement('p')
  note.textContent = noteLabel(c)
  const row = document.createElement('div')
  row.className = 'comment-tip-actions'
  // The document may have changed since the card opened; act on the comment as it is now.
  const button = (label: string, run: (now: Comment) => void): HTMLButtonElement => {
    const b = document.createElement('button')
    b.textContent = label
    b.addEventListener('mousedown', (e) => {
      e.preventDefault()
      const now = commentAt(view.state, c.from)
      if (same(now, c)) run(now)
    })
    return b
  }
  const nav = document.createElement('span')
  nav.className = 'comment-tip-nav'
  for (const [label, title, forward] of [
    ['‹', 'Previous comment', false],
    ['›', 'Next comment', true]
  ] as const) {
    const b = document.createElement('button')
    b.textContent = label
    b.title = title
    b.setAttribute('aria-label', title)
    b.addEventListener('mousedown', (e) => {
      e.preventDefault()
      actions.step(forward)
    })
    nav.append(b)
  }
  row.append(nav)
  if (isSuggestion(c)) {
    row.append(
      button('Accept', (now) => settleSuggestion(view, now, true)),
      button('Reject', (now) => settleSuggestion(view, now, false))
    )
  } else {
    row.append(
      button('Edit', actions.edit),
      button('Resolve', (now) => resolveComment(view, now))
    )
  }
  dom.append(note, row)
  return { dom }
}

/** The comment or suggestion the cursor (or a selection within one) is in. */
function atCursor(state: EditorState): Comment | null {
  const { from, to } = state.selection.main
  const c = commentAt(state, from)
  return c && to <= c.to ? c : null
}

const CURSOR_PAUSE = 500

/** Shows the card for the comment starting here (if the cursor is in it). */
const showCard = StateEffect.define<number>()

/**
 * Moves the cursor into the next (or previous) comment or suggestion, round to
 * the first (or last) after the end, and shows its card straight away.
 */
export function goToComment(view: EditorView, forward: boolean): 'moved' | 'wrapped' | 'only' | 'none' {
  const { state } = view
  const list = listComments(state)
  if (!list.length) return 'none'
  const head = state.selection.main.head
  // Strictly inside: a cursor just before or after one (as in the Markdown view) isn't in it.
  const here = list.find((c) => c.from < head && head < c.to) ?? null
  const next = forward
    ? list.find((c) => c !== here && c.from >= (here ? here.to : head))
    : [...list].reverse().find((c) => c !== here && c.to <= (here ? here.from : head))
  const c = next ?? (forward ? list[0] : list[list.length - 1])
  if (c === here) return 'only'
  view.dispatch({
    selection: { anchor: c.textFrom },
    effects: [EditorView.scrollIntoView(c.textFrom, { y: 'center' }), showCard.of(c.from)]
  })
  view.focus()
  return next ? 'moved' : 'wrapped'
}

/**
 * The card with the note and its buttons, shown while the cursor rests in a
 * comment or suggestion. It waits for a pause, so it doesn't flicker past as
 * you move through a paragraph, and stays away while you type.
 */
function cursorCard(actions: CommentActions): Extension {
  const field = StateField.define<{ from: number; tip: Tooltip } | null>({
    create: () => null,
    update(value, tr) {
      for (const e of tr.effects) {
        if (!e.is(showCard)) continue
        const c = atCursor(tr.state)
        if (c?.from !== e.value) break
        return { from: c.from, tip: { pos: c.textFrom, end: c.to, above: true, create: (view) => card(view, c, actions) } }
      }
      if (!value) return value
      if (tr.docChanged || atCursor(tr.state)?.from !== value.from) return null
      return value
    },
    provide: (f) => showTooltip.compute([f], (state) => state.field(f)?.tip ?? null)
  })
  const timer = ViewPlugin.fromClass(
    class {
      timer = 0
      constructor(readonly view: EditorView) {}
      update(u: ViewUpdate): void {
        if (!u.selectionSet && !u.docChanged) return
        clearTimeout(this.timer)
        if (u.docChanged) return
        const c = atCursor(u.state)
        if (!c || u.state.field(field)?.from === c.from) return
        this.timer = window.setTimeout(() => {
          if (this.view.dom.isConnected && atCursor(this.view.state)?.from === c.from)
            this.view.dispatch({ effects: showCard.of(c.from) })
        }, CURSOR_PAUSE)
      }
      destroy(): void {
        clearTimeout(this.timer)
      }
    }
  )
  return [field, timer]
}

/** Comments and suggestions: shown, with a card at the cursor, in both views; in the formatted one the markup hides. */
export function comments(live: boolean, actions: CommentActions): Extension {
  return [display(live), cursorCard(actions), live ? [protectMarkup, clipboard, markupKeys] : []]
}
