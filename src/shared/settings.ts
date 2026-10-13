import type { FocusMode, Settings, TextSize, Theme } from './types'

// Settings read from disk are checked here, so a hand-edited or old file can't break startup.

const SIZES: TextSize[] = ['small', 'medium', 'large']
const THEMES: Theme[] = ['system', 'light', 'dark']
export const FOCUS_MODES: FocusMode[] = ['off', 'paragraph', 'sentence']

const oneOf = <T>(value: unknown, allowed: T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback)
const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback)

/** Turns whatever is on disk (including older formats) into valid settings. */
export function normalizeSettings(saved: Record<string, unknown>): Settings {
  // Older versions: focus was on/off plus a scope, and text size was a number.
  let focus = saved.focus
  if (typeof focus === 'boolean') focus = focus ? (saved.focusScope ?? 'paragraph') : 'paragraph'
  let textSize = saved.textSize
  if (typeof saved.textScale === 'number') {
    textSize = saved.textScale < 0.95 ? 'small' : saved.textScale > 1.05 ? 'large' : 'medium'
  }
  const win = (saved.window ?? {}) as Record<string, unknown>
  const b = win.bounds as Record<string, unknown> | undefined
  const bounds =
    b && ['x', 'y', 'width', 'height'].every((k) => typeof b[k] === 'number')
      ? { x: b.x as number, y: b.y as number, width: b.width as number, height: b.height as number }
      : undefined
  // Older versions had a single "library"; it becomes the first open folder.
  const listed = Array.isArray(saved.folders) ? saved.folders : saved.librarySet && saved.library ? [saved.library] : []
  const folders = [...new Set(listed.filter((f): f is string => typeof f === 'string' && f.startsWith('/')))]
  return {
    folders,
    sidebar: bool(saved.sidebar, false),
    focus: oneOf(focus, FOCUS_MODES, 'paragraph'),
    textSize: oneOf(textSize, SIZES, 'medium'),
    showMarkdown: bool(saved.showMarkdown, false),
    theme: oneOf(saved.theme, THEMES, 'system'),
    // Full screen is never restored at launch; the window starts maximised instead.
    fullscreen: false,
    window: { maximized: bool(win.maximized, true), bounds }
  }
}
