import iconLight from '../../../../resources/icon-light.png'
import iconDark from '../../../../resources/icon-dark.png'
import type { Theme } from '../../../shared/types'

// The About panel: small and centred, in the same style as the palette. Esc closes it.

export const THEMES: { id: Theme; name: string }[] = [
  { id: 'system', name: 'System' },
  { id: 'light', name: 'Light' },
  { id: 'dark', name: 'Dark' }
]

let open: { el: HTMLElement } | null = null
const closeListeners: (() => void)[] = []

export const isPanelOpen = (): boolean => open !== null
/** Adds a listener for when a panel closes. */
export const onPanelClose = (cb: () => void): void => {
  closeListeners.push(cb)
}

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
