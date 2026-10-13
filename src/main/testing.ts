import { nativeTheme } from 'electron'
import { normalizeSettings } from '../shared/settings'
import { refreshFiles, resetSession } from './ipc'
import { watchFolders } from './library'
import { buildMenu } from './menu'
import { saveSettings, settings } from './settings'
import { watchCurrent } from './watcher'
import { getWindow, send } from './window'

// Only installed when TYPR_TEST=1. The end-to-end suite launches Typr once and
// calls this between tests to start each one fresh, instead of relaunching the app.

export function installTestHooks(): void {
  Object.assign(globalThis, {
    __typrReset: async (raw: Record<string, unknown>): Promise<void> => {
      Object.assign(settings, normalizeSettings(raw))
      saveSettings()
      resetSession()
      watchCurrent(null)
      watchFolders(settings.folders, refreshFiles)
      nativeTheme.themeSource = settings.theme
      buildMenu(settings, send)
      const win = getWindow()
      if (!win) throw new Error('No window to reset')
      if (settings.window.bounds) win.setBounds(settings.window.bounds)
      await win.webContents.session.clearStorageData({ storages: ['localstorage'] })
      const loaded = new Promise<void>((resolve) => win.webContents.once('did-finish-load', () => resolve()))
      win.webContents.reload()
      await loaded
    }
  })
}
