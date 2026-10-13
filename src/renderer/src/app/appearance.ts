import type { FocusMode, Settings } from '../../../shared/types'
import { api, app, notify } from './context'

// Applying settings to the page, and the small helpers commands use to change them.

export const set = <K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> => api.setSetting(key, value)

export { FOCUS_MODES as FOCUS } from '../../../shared/settings'
import { stepScale } from '../../../shared/settings'
export const label = (s: string): string => s[0].toUpperCase() + s.slice(1)

/** Text size one step bigger or smaller (⌘+ / ⌘−), or back to normal (⌘0). */
export function stepText(by: 1 | -1 | 0): void {
  const next = by === 0 ? 1 : stepScale(app.settings.textScale, by)
  void set('textScale', next)
  notify(`Text ${Math.round(next * 100)}%`)
}

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
  body.style.setProperty('--scale', String(next.textScale))
  body.classList.toggle('live', !next.showMarkdown)
  if (!prev || prev.showMarkdown !== next.showMarkdown) {
    editor.setLive(!next.showMarkdown)
    void document.fonts.ready.then(() => editor.refreshLayout())
  }
  if (!prev || prev.focus !== next.focus) editor.setFocusMode(next.focus)
  if (prev && prev.textScale !== next.textScale) void document.fonts.ready.then(() => editor.refreshLayout())
}
