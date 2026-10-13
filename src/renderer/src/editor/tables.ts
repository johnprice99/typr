import { EditorSelection, EditorState, Extension, Prec, Range, StateField } from '@codemirror/state'
import { Decoration, DecorationSet, EditorView, KeyBinding, keymap, WidgetType } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'

// Tables: rendered as a real table in the formatted view, and edited as
// Markdown when the cursor is in them, with Tab / ⇧Tab moving between cells.

const escape = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** Just enough inline Markdown for table cells. */
function inline(md: string): string {
  return escape(md)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_m, a, b) => `<strong>${a ?? b}</strong>`)
    .replace(/\*([^*]+)\*|_([^_]+)_/g, (_m, a, b) => `<em>${a ?? b}</em>`)
    .replace(/~~([^~]+)~~/g, '<s>$1</s>')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '<span class="md-link">$1</span>')
}

export function splitRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  return s.split(/(?<!\\)\|/).map((c) => c.trim())
}

class TableWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly from: number
  ) {
    super()
  }
  eq(other: TableWidget): boolean {
    return other.source === this.source && other.from === this.from
  }
  toDOM(view: EditorView): HTMLElement {
    const [head, rule, ...body] = this.source.split('\n')
    const align = splitRow(rule ?? '').map((c) => (/^:-+:$/.test(c) ? 'center' : /-+:$/.test(c) ? 'right' : 'left'))
    const cell = (tag: string, text: string, i: number): string =>
      `<${tag} style="text-align:${align[i] ?? 'left'}">${inline(text)}</${tag}>`
    const wrap = document.createElement('div')
    wrap.className = 'md-table-widget'
    wrap.innerHTML =
      `<table><thead><tr>${splitRow(head)
        .map((c, i) => cell('th', c, i))
        .join('')}</tr></thead>` +
      `<tbody>${body
        .map(
          (r) =>
            `<tr>${splitRow(r)
              .map((c, i) => cell('td', c, i))
              .join('')}</tr>`
        )
        .join('')}</tbody></table>`
    // Clicking the table starts editing it.
    wrap.addEventListener('mousedown', (e) => {
      e.preventDefault()
      const start = this.from + (this.source.startsWith('|') ? 2 : 0)
      view.dispatch({ selection: { anchor: start } })
      view.focus()
    })
    return wrap
  }
  ignoreEvent(): boolean {
    return true
  }
}

interface TableSpan {
  from: number
  to: number
}

/** Where the tables are. Only recomputed when the text or its parse changes, not on every cursor move. */
function findTables(state: EditorState): TableSpan[] {
  const out: TableSpan[] = []
  // Only top-level tables are rendered (not ones inside a quote or list), so
  // only the top-level blocks need looking at, not every node in the document.
  const cursor = syntaxTree(state).topNode.cursor()
  if (!cursor.firstChild()) return out
  do {
    if (cursor.name !== 'Table') continue
    const from = state.doc.lineAt(cursor.from).from
    if (from === cursor.from) out.push({ from, to: state.doc.lineAt(cursor.to).to })
  } while (cursor.nextSibling())
  return out
}

function render(state: EditorState, tables: TableSpan[]): DecorationSet {
  const ranges = state.selection.ranges
  const out: Range<Decoration>[] = []
  for (const { from, to } of tables) {
    if (ranges.some((r) => r.from <= to && r.to >= from)) continue // being edited: show the Markdown
    out.push(Decoration.replace({ widget: new TableWidget(state.sliceDoc(from, to), from), block: true }).range(from, to))
  }
  return Decoration.set(out)
}

interface TablesState {
  tables: TableSpan[]
  deco: DecorationSet
}

/** Rendered tables. Block widgets have to come from a state field. */
const tablesField = StateField.define<TablesState>({
  create(state) {
    const tables = findTables(state)
    return { tables, deco: render(state, tables) }
  },
  update(value, tr) {
    const reparsed = tr.docChanged || syntaxTree(tr.startState) !== syntaxTree(tr.state)
    if (!reparsed && !tr.selection) return value
    const tables = reparsed ? findTables(tr.state) : value.tables
    return { tables, deco: render(tr.state, tables) }
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco)
})

/** A rendered table counts as one block, so ↑/↓ would jump over it; step into it instead. */
function arrowInto(view: EditorView, dir: 1 | -1): boolean {
  const { state } = view
  const tables = state.field(tablesField, false)?.deco
  const sel = state.selection.main
  if (!tables || !sel.empty) return false
  const line = state.doc.lineAt(sel.head)
  const n = line.number + dir
  if (n < 1 || n > state.doc.lines) return false
  const next = state.doc.line(n)
  let target: number | null = null
  tables.between(next.from, next.to, (from, to) => {
    // Moving down lands on the table's first line; moving up, on its last.
    const row = state.doc.lineAt(dir === 1 ? from : to)
    if ((dir === 1 && from === next.from) || (dir === -1 && to === next.to)) {
      target = row.from + Math.min(sel.head - line.from, row.length)
      return false
    }
  })
  if (target === null) return false
  view.dispatch({ selection: { anchor: target }, scrollIntoView: true, userEvent: 'select' })
  return true
}

export const renderedTables: Extension = [
  tablesField,
  Prec.high(
    keymap.of([
      { key: 'ArrowDown', run: (v) => arrowInto(v, 1) },
      { key: 'ArrowUp', run: (v) => arrowInto(v, -1) }
    ])
  )
]

// ---------- editing ----------

function tableAt(state: EditorState, pos: number): SyntaxNode | null {
  for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1); n; n = n.parent) if (n.name === 'Table') return n
  for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) if (n.name === 'Table') return n
  return null
}

/** Start of each cell's text on a table line (after the pipe and any spaces). */
export function cellStarts(text: string): number[] {
  const starts: number[] = []
  const lead = text.startsWith('|') ? 1 : 0
  let i = lead
  starts.push(i)
  for (; i < text.length; i++) {
    if (text[i] === '|' && text[i - 1] !== '\\' && i < text.length - 1) starts.push(i + 1)
  }
  return starts.map((s) => {
    let p = s
    while (text[p] === ' ') p++
    // An empty cell: land one space in, so typing gives "| text |".
    if (p >= text.length || text[p] === '|') return Math.min(s + 1, p)
    return p
  })
}

const isRule = (text: string): boolean => /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(text)

function moveCell(view: EditorView, dir: 1 | -1): boolean {
  const { state } = view
  const pos = state.selection.main.head
  const table = tableAt(state, pos)
  if (!table) return false
  const { doc } = state
  // Only tables that start their own line; in a quote or indented, cell 0 would be the marker.
  if (doc.lineAt(table.from).from !== table.from) return false
  const first = doc.lineAt(table.from).number
  const last = doc.lineAt(table.to).number
  let line = doc.lineAt(pos)
  const target = (l: typeof line, i: number): void => {
    const starts = cellStarts(l.text)
    const at = l.from + starts[Math.max(0, Math.min(i, starts.length - 1))]
    // Select the cell's text so typing replaces it.
    let end = at
    while (end < l.to && doc.sliceString(end, end + 1) !== '|') end++
    while (end > at && doc.sliceString(end - 1, end) === ' ') end--
    view.dispatch({ selection: EditorSelection.range(at, end), scrollIntoView: true })
  }
  const starts = cellStarts(line.text)
  const col = starts.filter((s) => line.from + s <= pos).length - 1
  const next = col + dir
  if (next >= 0 && next < starts.length && !isRule(line.text)) return (target(line, next), true)
  // Move to the neighbouring row, skipping the |---| line.
  let n = line.number + dir
  if (n >= first && n <= last && isRule(doc.line(n).text)) n += dir
  if (n < first) return true
  if (n > last) {
    // Tab past the last cell adds a row.
    const cols = Math.max(1, splitRow(doc.line(first).text).length)
    const row = '\n|' + '  |'.repeat(cols)
    const end = doc.line(last).to
    view.dispatch({ changes: { from: end, insert: row }, selection: { anchor: end + 3 }, scrollIntoView: true })
    return true
  }
  line = doc.line(n)
  target(line, dir === 1 ? 0 : cellStarts(line.text).length - 1)
  return true
}

export const tableKeys: KeyBinding[] = [
  { key: 'Tab', run: (v) => moveCell(v, 1) },
  { key: 'Shift-Tab', run: (v) => moveCell(v, -1) }
]

export function insertTable(view: EditorView): void {
  const { state } = view
  const line = state.doc.lineAt(state.selection.main.head)
  const table = '| Column 1 | Column 2 |\n| --- | --- |\n|  |  |'
  // A table needs a line to itself, with a blank line before it.
  const at = line.text.trim() ? line.to : line.from
  const before = line.text.trim() ? '\n\n' : at > 0 && state.doc.lineAt(at - 1).text.trim() ? '\n' : ''
  const insert = before + table + '\n'
  const start = at + before.length + 2
  view.dispatch({
    changes: { from: at, to: line.text.trim() ? at : line.to, insert },
    selection: EditorSelection.range(start, start + 'Column 1'.length),
    scrollIntoView: true,
    userEvent: 'input'
  })
  view.focus()
}
