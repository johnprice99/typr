export interface PaletteItem {
  label: string
  detail?: string
  hint?: string
  run: () => void
}

interface ListOptions {
  placeholder: string
  items: PaletteItem[]
  /** Offered at the bottom when the query is non-empty, e.g. "Create “query”". */
  fallback?: (query: string) => PaletteItem | null
  /** Called when closed without picking anything. */
  onCancel?: () => void
}

interface PromptOptions {
  placeholder: string
  value?: string
  submit: (value: string) => void
}

/** Subsequence match with bonuses for runs and word starts. Higher is better. */
function score(query: string, text: string): number | null {
  const q = query.toLowerCase()
  const s = text.toLowerCase()
  let at = 0
  let prev = -2
  let total = 0
  for (const ch of q) {
    if (ch === ' ') continue
    const i = s.indexOf(ch, at)
    if (i < 0) return null
    total += i === prev + 1 ? 3 : 1
    if (i === 0 || /[\s/_\-.]/.test(s[i - 1])) total += 2
    prev = i
    at = i + 1
  }
  return total - s.length * 0.01
}

let active: { close: () => void } | null = null
let onDone: () => void = () => {}

export function onPaletteClose(cb: () => void): void {
  onDone = cb
}

export function isPaletteOpen(): boolean {
  return active !== null
}

function shell(
  placeholder: string,
  onCancel?: () => void
): { input: HTMLInputElement; list: HTMLDivElement; close: (picked?: boolean) => void } {
  active?.close()
  const overlay = document.createElement('div')
  overlay.className = 'palette-overlay'
  const box = document.createElement('div')
  box.className = 'palette'
  const input = document.createElement('input')
  input.placeholder = placeholder
  input.spellcheck = false
  const list = document.createElement('div')
  list.className = 'palette-list'
  box.append(input, list)
  overlay.append(box)
  document.body.append(overlay)

  const close = (picked = false): void => {
    if (!overlay.isConnected) return
    overlay.remove()
    active = null
    onDone()
    if (!picked) onCancel?.()
  }
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) close()
  })
  input.addEventListener('blur', () => setTimeout(() => document.activeElement !== input && close(), 0))
  active = { close: () => close() }
  setTimeout(() => input.focus())
  return { input, list, close }
}

export function openList(opts: ListOptions): void {
  const { input, list, close } = shell(opts.placeholder, opts.onCancel)
  let shown: PaletteItem[] = []
  let selected = 0

  const render = (): void => {
    const q = input.value.trim()
    if (q) {
      shown = opts.items
        .map((item) => ({ item, s: score(q, `${item.label} ${item.detail ?? ''}`) }))
        .filter((x): x is { item: PaletteItem; s: number } => x.s !== null)
        .sort((a, b) => b.s - a.s)
        .map((x) => x.item)
      const extra = opts.fallback?.(q)
      if (extra) shown.push(extra)
    } else {
      shown = opts.items
    }
    shown = shown.slice(0, 60)
    selected = Math.min(selected, Math.max(0, shown.length - 1))
    list.replaceChildren(
      ...shown.map((item, i) => {
        const row = document.createElement('div')
        row.className = 'palette-item' + (i === selected ? ' selected' : '')
        const label = document.createElement('span')
        label.className = 'label'
        label.textContent = item.label
        row.append(label)
        if (item.detail) {
          const d = document.createElement('span')
          d.className = 'detail'
          d.textContent = item.detail
          row.append(d)
        }
        if (item.hint) {
          const h = document.createElement('span')
          h.className = 'hint'
          h.textContent = item.hint
          row.append(h)
        }
        row.addEventListener('mousedown', (e) => {
          e.preventDefault()
          pick(i)
        })
        return row
      })
    )
    list.children[selected]?.scrollIntoView({ block: 'nearest' })
  }

  const pick = (i: number): void => {
    const item = shown[i]
    close(Boolean(item))
    item?.run()
  }

  input.addEventListener('input', () => {
    selected = 0
    render()
  })
  input.addEventListener('keydown', (e) => {
    const down = e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')
    const up = e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')
    if (down || up) {
      e.preventDefault()
      if (shown.length) selected = (selected + (down ? 1 : -1) + shown.length) % shown.length
      render()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      pick(selected)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  })
  render()
}

export function openPrompt(opts: PromptOptions): void {
  const { input, list, close } = shell(opts.placeholder)
  list.remove()
  input.value = opts.value ?? ''
  setTimeout(() => input.select())
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      const value = input.value.trim()
      close(true)
      if (value) opts.submit(value)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  })
}
