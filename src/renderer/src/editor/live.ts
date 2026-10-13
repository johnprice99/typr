import { Range } from '@codemirror/state'
import { Decoration, DecorationSet, EditorView, WidgetType } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import { measure, px } from './markdown'
import { touched } from './syntax'

// Formatted view: the file stays plain Markdown, but its syntax is hidden and
// rendered (headings, bold, links, bullets, checkboxes, images…). Wherever the
// cursor is, the raw Markdown comes back so editing never surprises you.

export interface LiveOptions {
  /** Turns an image path from the document into a URL the editor can load. */
  imageUrl: (href: string) => string
}

class BulletWidget extends WidgetType {
  eq(): boolean {
    return true
  }
  toDOM(): HTMLElement {
    const s = document.createElement('span')
    s.className = 'md-bullet'
    s.textContent = '•'
    return s
  }
}

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super()
  }
  // Not its position: typing above a checklist mustn't redraw it.
  eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked
  }
  toDOM(view: EditorView): HTMLElement {
    const s = document.createElement('span')
    s.className = 'md-check' + (this.checked ? ' checked' : '')
    s.setAttribute('role', 'checkbox')
    s.setAttribute('aria-checked', String(this.checked))
    s.addEventListener('mousedown', (e) => {
      e.preventDefault()
      // The "[ ]" after the list marker this widget covers.
      const line = view.state.doc.lineAt(view.posAtDOM(s))
      const at = line.text.indexOf('[', view.posAtDOM(s) - line.from)
      if (at < 0) return
      view.dispatch({ changes: { from: line.from + at, to: line.from + at + 3, insert: this.checked ? '[ ]' : '[x]' } })
    })
    return s
  }
  ignoreEvent(): boolean {
    return true
  }
}

// Images from the internet aren't fetched until you ask: loading one tells its
// website that (and when) the document was opened. Once clicked, that address
// stays loaded for the rest of the session.
const remoteAllowed = new Set<string>()
const isRemote = (src: string): boolean => /^https?:/i.test(src)

class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string
  ) {
    super()
  }
  eq(other: ImageWidget): boolean {
    return other.src === this.src && other.alt === this.alt
  }
  toDOM(view: EditorView): HTMLElement {
    // The image (or the placeholder) sits in a wrapper: CodeMirror keeps a
    // widget's outer element, so swapping must happen inside it.
    const wrap = document.createElement('span')
    wrap.className = 'md-img-wrap'
    if (isRemote(this.src) && !remoteAllowed.has(this.src)) {
      const ask = document.createElement('button')
      ask.className = 'md-remote-img'
      ask.textContent = `Remote image${this.alt ? ` “${this.alt}”` : ''} · Click to load`
      ask.title = this.src
      ask.addEventListener('mousedown', (e) => {
        e.preventDefault()
        remoteAllowed.add(this.src)
        ask.replaceWith(this.image(view))
        view.requestMeasure()
      })
      wrap.append(ask)
    } else {
      wrap.append(this.image(view))
    }
    return wrap
  }
  image(view: EditorView): HTMLImageElement {
    const img = document.createElement('img')
    img.className = 'md-img'
    // Images arrive after layout; re-measure so the cursor and clicks line up.
    img.addEventListener('load', () => view.requestMeasure())
    img.addEventListener('error', () => view.requestMeasure())
    img.src = this.src
    img.alt = this.alt
    return img
  }
  ignoreEvent(): boolean {
    return true
  }
}

class RuleWidget extends WidgetType {
  eq(): boolean {
    return true
  }
  toDOM(): HTMLElement {
    const s = document.createElement('span')
    s.className = 'md-rule'
    return s
  }
}

const hidden = Decoration.replace({})
const bullet = Decoration.replace({ widget: new BulletWidget() })
const rule = Decoration.replace({ widget: new RuleWidget() })

// Widths come from CSS (--md-bullet-w, --md-check-w) so they're defined once.
const LIST_INDENT = 1.75

export function buildLive(view: EditorView, opts: LiveOptions): DecorationSet {
  const { state } = view
  const { doc } = state
  const touches = (from: number, to: number): boolean => touched(state, from, to)
  const lineOf = (pos: number) => doc.lineAt(pos)
  const lineTouched = (pos: number): boolean => {
    const l = lineOf(pos)
    return touches(l.from, l.to)
  }
  /** End of any spaces/tabs after pos, staying on the same line. */
  const spacesAfter = (pos: number): number => {
    const end = lineOf(pos).to
    while (pos < end && /[ \t]/.test(doc.sliceString(pos, pos + 1))) pos++
    return pos
  }
  const spacesBefore = (pos: number): number => {
    const start = lineOf(pos).from
    while (pos > start && /[ \t]/.test(doc.sliceString(pos - 1, pos))) pos--
    return pos
  }

  const out: Range<Decoration>[] = []
  const seen = new Set<string>()
  const add = (key: string, r: Range<Decoration>): void => {
    if (seen.has(key)) return
    seen.add(key)
    out.push(r)
  }
  // CodeMirror can't hide a line break from a view plugin (it throws), so anything
  // that spans lines, like a link whose address wraps, simply stays as Markdown.
  const oneLine = (from: number, to: number): boolean => lineOf(from).number === lineOf(to).number
  const hide = (from: number, to: number): void => {
    if (to > from && oneLine(from, to)) add(`h${from}:${to}`, hidden.range(from, to))
  }
  const line = (pos: number, cls: string, style?: string): void => {
    const l = lineOf(pos)
    add(`l${l.from}:${cls}`, Decoration.line({ class: cls, attributes: style ? { style } : {} }).range(l.from))
  }
  const eachLine = (node: SyntaxNode, fn: (from: number) => void): void => {
    for (let n = lineOf(node.from).number, last = lineOf(node.to).number; n <= last; n++) fn(doc.line(n).from)
  }

  const heading = (node: SyntaxNode, level: number): void => {
    const l = lineOf(node.from)
    const cls = `md-h md-h${level}`
    const marks = node.getChildren('HeaderMark')
    if (touches(l.from, l.to)) {
      // Editing the heading: show the hashes, hanging in the margin so the text doesn't jump.
      const open = marks[0]
      const w = open && open.from === l.from ? measure(view, cls, doc.sliceString(l.from, spacesAfter(open.to))) : 0
      line(l.from, cls, w ? `text-indent:-${px(w)}` : undefined)
      return
    }
    line(l.from, cls)
    for (const m of marks) {
      if (m.from === l.from) hide(m.from, spacesAfter(m.to))
      else hide(spacesBefore(m.from), m.to)
    }
  }

  const listItem = (node: SyntaxNode): void => {
    const mark = node.getChild('ListMark')
    if (!mark) return
    const l = lineOf(mark.from)
    const lead = doc.sliceString(l.from, mark.from)
    if (/\S/.test(lead)) return // e.g. a list inside a quote; leave it plain
    // Lists sit inside an indent, one step per nesting level, with the marker
    // hanging just left of the text, like a rendered page.
    let depth = 0
    for (let p = node.parent; p; p = p.parent) if (p.name === 'ListItem') depth++
    const leadPx = lead ? measure(view, 'md-li', lead, '') : 0
    const taskMarker = node.getChild('Task')?.getChild('TaskMarker') ?? null
    const ordered = node.parent?.name === 'OrderedList'
    const end = spacesAfter((taskMarker ?? mark).to)
    const checked = taskMarker ? /x/i.test(doc.sliceString(taskMarker.from, taskMarker.to)) : false
    let indent: string
    if (!ordered && !touches(mark.from, end)) {
      if (taskMarker) {
        add(`w${mark.from}`, Decoration.replace({ widget: new CheckboxWidget(checked) }).range(mark.from, end))
      } else {
        add(`w${mark.from}`, bullet.range(mark.from, end))
      }
      indent = `calc(-${px(leadPx)} - var(${taskMarker ? '--md-check-w' : '--md-bullet-w'}))`
    } else {
      indent = `-${px(measure(view, 'md-li', doc.sliceString(l.from, end)))}`
    }
    line(l.from, `md-li${checked ? ' md-done' : ''}`, `padding-left:${(depth + 1) * LIST_INDENT}em;text-indent:${indent}`)
  }

  const tree = syntaxTree(state)
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter: (ref) => {
        const node = ref.node
        const name = ref.name
        const h = /^ATXHeading(\d)$/.exec(name)
        if (h) return heading(node, Number(h[1]))
        switch (name) {
          case 'ListItem':
            listItem(node)
            return
          case 'Blockquote':
            eachLine(node, (p) => line(p, 'md-quote-line'))
            return
          case 'QuoteMark': {
            const end = spacesAfter(ref.to)
            if (!touches(ref.from, end)) hide(ref.from, end)
            return
          }
          case 'FencedCode':
          case 'CodeBlock': {
            const first = lineOf(ref.from).number
            const last = lineOf(ref.to).number
            // The ``` lines fold away until you're editing the block.
            const fenced = name === 'FencedCode' && !touches(ref.from, ref.to)
            const marks = fenced ? node.getChildren('CodeMark') : []
            eachLine(node, (p) => {
              const l = lineOf(p)
              const fence = marks.some((m) => lineOf(m.from).number === l.number)
              if (fence) hide(l.from, l.to)
              line(
                p,
                `md-codeblock${l.number === first ? ' md-codeblock-first' : ''}${l.number === last ? ' md-codeblock-last' : ''}${fence ? ' md-fence' : ''}`
              )
            })
            return false
          }
          case 'Table':
            eachLine(node, (p) => line(p, 'md-table'))
            return false
          case 'HorizontalRule':
            if (!lineTouched(ref.from)) add(`r${ref.from}`, rule.range(ref.from, ref.to))
            return false
          case 'Image': {
            if (lineTouched(ref.from) || !oneLine(ref.from, ref.to)) return
            const url = node.getChild('URL')
            if (!url) return
            const alt = doc.sliceString(ref.from + 2, (node.getChildren('LinkMark')[1] ?? url).from)
            const src = opts.imageUrl(doc.sliceString(url.from, url.to).replace(/^<|>$/g, ''))
            add(`i${ref.from}`, Decoration.replace({ widget: new ImageWidget(src, alt) }).range(ref.from, ref.to))
            return false
          }
          case 'Link': {
            if (touches(ref.from, ref.to) || !oneLine(ref.from, ref.to)) return
            // "[text]" on its own is just text in brackets, not a link: leave it alone.
            if (!node.getChild('URL') && !node.getChild('LinkLabel')) return
            const marks = node.getChildren('LinkMark')
            if (marks.length >= 2) {
              hide(ref.from, marks[0].to)
              hide(marks[1].from, ref.to)
            }
            return
          }
          case 'Autolink':
            if (!touches(ref.from, ref.to)) for (const m of node.getChildren('LinkMark')) hide(m.from, m.to)
            return
          case 'Emphasis':
          case 'StrongEmphasis':
            if (!touches(ref.from, ref.to)) for (const m of node.getChildren('EmphasisMark')) hide(m.from, m.to)
            return
          case 'Strikethrough':
            if (!touches(ref.from, ref.to)) for (const m of node.getChildren('StrikethroughMark')) hide(m.from, m.to)
            return
          case 'InlineCode':
            if (!touches(ref.from, ref.to)) for (const m of node.getChildren('CodeMark')) hide(m.from, m.to)
            return false
          case 'Escape':
            if (!touches(ref.from, ref.to)) hide(ref.from, ref.from + 1)
            return
        }
      }
    })
  }
  return Decoration.set(out, true)
}
