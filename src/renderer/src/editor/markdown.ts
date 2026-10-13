import { RangeSetBuilder, StateEffect } from '@codemirror/state'
import { Decoration, DecorationSet, EditorView } from '@codemirror/view'
import { HighlightStyle } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import { inCode } from './syntax'
import { frontmatterRange } from './frontmatter'

// Colours live in CSS so light/dark mode is handled in one place.
export const markdownHighlight = HighlightStyle.define([
  { tag: t.heading, class: 'md-heading' },
  { tag: t.strong, class: 'md-strong' },
  { tag: t.emphasis, class: 'md-em' },
  { tag: t.strikethrough, class: 'md-strike' },
  { tag: t.processingInstruction, class: 'md-mark' },
  { tag: t.link, class: 'md-link' },
  { tag: t.url, class: 'md-url' },
  { tag: t.monospace, class: 'md-code' },
  { tag: t.quote, class: 'md-quote' },
  { tag: t.contentSeparator, class: 'md-hr' }
])

const HEADING = /^(#{1,6})[ \t]+/
const LIST = /^([ \t]*)(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/
const QUOTE = /^(?:>[ \t]?)+/

// ---------- measuring ----------

// Markers are measured in the real font, in a hidden line inside the editor, so
// the hanging indent is exact. Measuring reads the page layout, so it happens in
// CodeMirror's measure phase (never in the middle of an update): unknown widths
// are batched, measured on the next frame, and the layout is then redrawn.

interface Measurer {
  probe: HTMLDivElement | null
  widths: Map<string, number>
  /** Widths from before the last font change, used until they're re-measured. */
  stale: Map<string, number>
  pending: Map<string, { lineClass: string; text: string; markClass: string }>
  scheduled: boolean
}

const measurers = new WeakMap<EditorView, Measurer>()

function measurer(view: EditorView): Measurer {
  let m = measurers.get(view)
  if (!m) {
    m = { probe: null, widths: new Map(), stale: new Map(), pending: new Map(), scheduled: false }
    measurers.set(view, m)
  }
  return m
}

export const refresh = StateEffect.define<null>()

/** The rendered width of `text` in a line of `lineClass`, in px. */
export function measure(view: EditorView, lineClass: string, text: string, markClass = 'md-mark'): number {
  const m = measurer(view)
  const key = `${lineClass}|${markClass}|${text}`
  const known = m.widths.get(key)
  if (known !== undefined) return known
  m.pending.set(key, { lineClass, text, markClass })
  schedule(view, m)
  return m.stale.get(key) ?? 0
}

function schedule(view: EditorView, m: Measurer): void {
  if (m.scheduled) return
  m.scheduled = true
  view.requestMeasure({
    key: m,
    read: () => {
      if (!m.probe || !m.probe.isConnected) {
        m.probe = document.createElement('div')
        m.probe.setAttribute('aria-hidden', 'true')
        m.probe.style.cssText = 'position:absolute;visibility:hidden;left:-9999px;top:0;white-space:pre;tab-size:4;padding:0'
        view.scrollDOM.append(m.probe)
      }
      const out = new Map<string, number>()
      for (const [key, { lineClass, text, markClass }] of m.pending) {
        m.probe.className = `cm-line ${lineClass}`
        const span = document.createElement('span')
        span.className = markClass
        span.textContent = text
        m.probe.replaceChildren(span)
        out.set(key, span.getBoundingClientRect().width)
      }
      m.pending.clear()
      return out
    },
    write: (out) => {
      m.scheduled = false
      for (const [key, w] of out) m.widths.set(key, w)
      // Redraw with the real widths (outside the measure cycle).
      if (out.size) setTimeout(() => view.dom.isConnected && view.dispatch({ effects: refresh.of(null) }))
    }
  })
}

/** Forget measured widths (keeping them as a fallback) after the font or size changes. */
export function clearWidths(view: EditorView): void {
  const m = measurer(view)
  if (m.widths.size) m.stale = m.widths
  m.widths = new Map()
}

export const fontKey = (view: EditorView): string => {
  const s = getComputedStyle(view.scrollDOM)
  return `${s.fontFamily}|${s.fontSize}`
}

/** Re-measure markers, e.g. after the text size or loaded fonts change. */
export function refreshMarks(view: EditorView): void {
  clearWidths(view)
  view.dispatch({ effects: refresh.of(null) })
}

// ---------- layout ----------

export const px = (n: number): string => `${Math.round(n * 100) / 100}px`

/**
 * Markdown view: heading hashes, list markers and quote marks hang in the left
 * margin, so text always starts on the same edge and wrapped lines line up under it.
 */
export function buildRaw(view: EditorView): DecorationSet {
  const b = new RangeSetBuilder<Decoration>()
  const { state } = view
  const front = frontmatterRange(state)
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = state.doc.lineAt(pos)
      const text = line.text
      let m: RegExpMatchArray | null
      if (text && !inCode(state, line.from) && !(front && line.from <= front.to)) {
        if ((m = text.match(HEADING))) {
          const cls = `md-h md-h${m[1].length}`
          const w = measure(view, cls, m[0])
          b.add(line.from, line.from, Decoration.line({ class: cls, attributes: { style: `text-indent:-${px(w)}` } }))
        } else if ((m = text.match(LIST))) {
          // Nested items indent by their leading whitespace (in ch, so spaces in
          // proportional fonts still read as a clear step); the marker hangs left of the text.
          const cols = [...m[1]].reduce((n, c) => n + (c === '\t' ? 4 : 1), 0)
          const w = measure(view, 'md-li', m[0])
          b.add(
            line.from,
            line.from,
            Decoration.line({ class: 'md-li', attributes: { style: `padding-left:${cols}ch;text-indent:-${px(w)}` } })
          )
        } else if ((m = text.match(QUOTE))) {
          const w = measure(view, 'md-bq', m[0])
          b.add(line.from, line.from, Decoration.line({ class: 'md-bq', attributes: { style: `text-indent:-${px(w)}` } }))
        }
      }
      pos = line.to + 1
    }
  }
  return b.finish()
}
