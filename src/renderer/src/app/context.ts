import type { Editor } from '../editor/editor'
import type { Settings } from '../../../shared/types'

// State shared across the app modules. `editor` and `settings` are set once at
// startup (main.ts) before anything else runs.

export const api = window.api

export const app = {
  editor: undefined as unknown as Editor,
  settings: undefined as unknown as Settings,
  /** Library-relative paths; folders end with "/". */
  files: [] as string[],
  version: ''
}

export const $ = (id: string): HTMLElement => document.getElementById(id)!

let toastTimer = 0

/** A short message at the bottom of the window. */
export function notify(message: string): void {
  const el = $('toast')
  el.textContent = message
  el.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 2400)
}

export const errorText = (e: unknown): string => String((e as Error)?.message ?? e)
