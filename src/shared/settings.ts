import type { FocusMode, Settings, Theme } from './types'

// Settings read from disk are checked here, so a hand-edited or old file can't break startup.

/** The steps ⌘+ and ⌘− move through; 1 is normal size. */
export const TEXT_SCALES = [0.8, 0.9, 1, 1.1, 1.2, 1.35, 1.5, 1.7]

/** The nearest step to any number (so old or hand-edited values still work). */
export const nearestScale = (n: number): number =>
  TEXT_SCALES.reduce((best, s) => (Math.abs(s - n) < Math.abs(best - n) ? s : best), 1)

/** One step bigger (+1) or smaller (−1), staying within the steps. */
export function stepScale(current: number, by: 1 | -1): number {
  const i = TEXT_SCALES.indexOf(nearestScale(current))
  return TEXT_SCALES[Math.max(0, Math.min(TEXT_SCALES.length - 1, i + by))]
}
export const THEMES: Theme[] = ['system', 'light', 'dark']
export const FOCUS_MODES: FocusMode[] = ['off', 'paragraph', 'sentence', 'typewriter']

const oneOf = <T>(value: unknown, allowed: T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback)
const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback)

/** Turns whatever is on disk (including older formats) into valid settings. */
export function normalizeSettings(saved: Record<string, unknown>): Settings {
  // Older versions: focus was on/off plus a scope, and text size was a number.
  let focus = saved.focus
  if (typeof focus === 'boolean') focus = focus ? (saved.focusScope ?? 'paragraph') : 'off'
  // …and briefly typewriter scrolling was its own switch: now it's a focus mode.
  if (saved.typewriter === true && (focus === 'off' || focus === undefined)) focus = 'typewriter'
  // …and briefly a choice of small / medium / large.
  const named: Record<string, number> = { small: 0.9, medium: 1, large: 1.1 }
  const textScale = typeof saved.textScale === 'number' ? saved.textScale : (named[saved.textSize as string] ?? 1)
  const win = (saved.window ?? {}) as Record<string, unknown>
  const b = win.bounds as Record<string, unknown> | undefined
  const bounds =
    b && ['x', 'y', 'width', 'height'].every((k) => typeof b[k] === 'number')
      ? { x: b.x as number, y: b.y as number, width: b.width as number, height: b.height as number }
      : undefined
  // Older versions had a single "library"; it becomes the first open folder.
  const listed = Array.isArray(saved.folders) ? saved.folders : saved.librarySet && saved.library ? [saved.library] : []
  const folders = [...new Set(listed.filter((f): f is string => typeof f === 'string' && f.startsWith('/')))]
  const files = Array.isArray(saved.files)
    ? [...new Set(saved.files.filter((f): f is string => typeof f === 'string' && f.startsWith('/')))]
    : []
  return {
    folders,
    files,
    sidebar: bool(saved.sidebar, false),
    focus: oneOf(focus, FOCUS_MODES, 'off'),
    textScale: nearestScale(textScale),
    showMarkdown: bool(saved.showMarkdown, false),
    theme: oneOf(saved.theme, THEMES, 'system'),
    // Full screen is never restored at launch; the window starts maximised instead.
    fullscreen: false,
    window: { maximized: bool(win.maximized, true), bounds }
  }
}
