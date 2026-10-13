import type { FocusMode, Settings } from '../../../shared/types'
import { refreshPanel } from '../ui/panels'
import { api, app, notify } from './context'

// Applying settings to the page, and the small helpers commands use to change them.

export const set = <K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> => api.setSetting(key, value)

export { FOCUS_MODES as FOCUS } from '../../../shared/settings'
export const label = (s: string): string => s[0].toUpperCase() + s.slice(1)

export function setFocus(mode: FocusMode, announce = false): void {
  void set('focus', mode)
  if (announce) notify(`Focus: ${label(mode)}`)
}

export function applySettings(next: Settings): void {
  const prev = app.settings as Settings | undefined
  app.settings = next
  const { editor } = app
  const body = document.body
  body.classList.toggle('sidebar-open', next.sidebar)
  body.classList.toggle('fullscreen', next.fullscreen)
  body.dataset.size = next.textSize
  body.classList.toggle('live', !next.showMarkdown)
  if (!prev || prev.showMarkdown !== next.showMarkdown) {
    editor.setLive(!next.showMarkdown)
    void document.fonts.ready.then(() => editor.refreshLayout())
  }
  if (!prev || prev.focus !== next.focus) editor.setFocusMode(next.focus)
  if (prev && prev.textSize !== next.textSize) void document.fonts.ready.then(() => editor.refreshLayout())
  refreshPanel(next)
}
