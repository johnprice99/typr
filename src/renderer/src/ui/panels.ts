import iconLight from '../../../../resources/icon-light.png'
import iconDark from '../../../../resources/icon-dark.png'
import type { Settings, Theme } from '../../../shared/types'

// Settings and About: small centred panels in the same style as the palette.
// Everything works from the keyboard: Tab between rows, arrows to choose, Esc to close.

export const THEMES: { id: Theme; name: string }[] = [
  { id: 'system', name: 'System' },
  { id: 'light', name: 'Light' },
  { id: 'dark', name: 'Dark' }
]

let open: { el: HTMLElement; refresh?: (s: Settings) => void } | null = null
const closeListeners: (() => void)[] = []

export const isPanelOpen = (): boolean => open !== null
/** Adds a listener for when a panel closes. */
export const onPanelClose = (cb: () => void): void => {
  closeListeners.push(cb)
}
export const refreshPanel = (s: Settings): void => open?.refresh?.(s)

function closePanel(): void {
  if (!open) return
  open.el.remove()
  open = null
  for (const cb of closeListeners) cb()
}

function shell(className: string): HTMLDivElement {
  closePanel()
  const overlay = document.createElement('div')
  overlay.className = 'palette-overlay'
  const box = document.createElement('div')
  box.className = `panel ${className}`
  overlay.append(box)
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) closePanel()
  })
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      closePanel()
    }
  })
  document.body.append(overlay)
  open = { el: overlay }
  return box
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag)
  if (className) e.className = className
  if (text) e.textContent = text
  return e
}

/** A row of options that behaves like a native radio group. */
function choice<T extends string>(options: { id: T; name: string }[], current: T, pick: (id: T) => void): HTMLDivElement {
  const group = el('div', 'segmented')
  group.setAttribute('role', 'radiogroup')
  const buttons = options.map((o) => {
    const b = el('button', undefined, o.name)
    b.setAttribute('role', 'radio')
    b.setAttribute('aria-checked', String(o.id === current))
    b.tabIndex = o.id === current ? 0 : -1
    b.addEventListener('click', () => pick(o.id))
    return b
  })
  group.addEventListener('keydown', (e) => {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!dir) return
    e.preventDefault()
    const i = options.findIndex((o) => o.id === current)
    pick(options[(i + dir + options.length) % options.length].id)
  })
  group.append(...buttons)
  return group
}

export interface SettingsHandlers {
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void
  /** Text size one step bigger (+1) or smaller (−1). */
  step: (by: 1 | -1) => void
}

/** "−  100%  +", also driven by the arrow keys (and ⌘+ / ⌘− anywhere). */
function sizeControl(scale: number, step: (by: 1 | -1) => void): HTMLDivElement {
  const group = el('div', 'stepper')
  const button = (label: string, by: 1 | -1, name: string): HTMLButtonElement => {
    const b = el('button', undefined, label)
    b.setAttribute('aria-label', name)
    b.addEventListener('click', () => step(by))
    return b
  }
  const value = el('span', 'stepper-value', `${Math.round(scale * 100)}%`)
  group.append(button('−', -1, 'Smaller text'), value, button('+', 1, 'Bigger text'))
  group.addEventListener('keydown', (e) => {
    const by = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0
    if (!by) return
    e.preventDefault()
    step(by)
  })
  return group
}

export function openSettings(settings: Settings, h: SettingsHandlers): void {
  const box = shell('settings')
  const render = (s: Settings): void => {
    // Keep keyboard focus on the same row across re-renders.
    const focusedRow = [...box.querySelectorAll('.setting')].findIndex((r) => r.contains(document.activeElement))
    const row = (label: string, control: HTMLElement): HTMLDivElement => {
      const r = el('div', 'setting')
      r.append(el('div', 'setting-label', label), control)
      return r
    }
    box.replaceChildren(
      el('h2', undefined, 'Settings'),
      row(
        'Appearance',
        choice(THEMES, s.theme, (v) => h.set('theme', v))
      ),
      row('Text size', sizeControl(s.textScale, h.step))
    )
    const rows = box.querySelectorAll<HTMLElement>('.setting')
    const target = rows[Math.max(0, focusedRow)]
    ;(target.querySelector<HTMLElement>('[tabindex="0"]') ?? target.querySelector<HTMLElement>('button') ?? target).focus()
  }
  open!.refresh = render
  render(settings)
}

export function openAbout(version: string): void {
  const box = shell('about')
  const img = el('img')
  img.src = matchMedia('(prefers-color-scheme: dark)').matches ? iconDark : iconLight
  img.alt = ''
  const ok = el('button', 'link', 'Close')
  ok.addEventListener('click', closePanel)
  box.append(
    img,
    el('h2', undefined, 'Typr'),
    el('p', 'faint', `Version ${version}`),
    el('p', undefined, 'A quiet Markdown editor.'),
    ok
  )
  ok.focus()
}
