import './setup'
import { app } from 'electron'
import { mkdirSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import type { Settings } from '../shared/types'
import { normalizeSettings } from '../shared/settings'
import { writeAtomicSync } from './library'

// Settings live in one JSON file in the app's user-data folder.

const settingsPath = (): string => join(app.getPath('userData'), 'settings.json')

function load(): Settings {
  let saved: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(readFileSync(settingsPath(), 'utf8'))
    if (parsed && typeof parsed === 'object') saved = parsed
  } catch {
    // First launch, or an unreadable file: start from defaults.
  }
  return normalizeSettings(saved)
}

export const settings: Settings = load()

const listeners: ((key: keyof Settings) => void)[] = []
export const onSettingChange = (cb: (key: keyof Settings) => void): void => {
  listeners.push(cb)
}

export function saveSettings(): void {
  mkdirSync(dirname(settingsPath()), { recursive: true })
  writeAtomicSync(settingsPath(), JSON.stringify(settings, null, 2))
}

export function updateSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  if (settings[key] === value) return
  settings[key] = value
  saveSettings()
  for (const cb of listeners) cb(key)
}
