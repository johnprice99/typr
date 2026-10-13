import { app, nativeTheme } from 'electron'
import { join } from 'path'

// The installed app's icon (build/Typr.icon) is switched by macOS itself for
// light, dark and tinted icon styles. Only when running from source (npm run
// dev), where Electron's own icon would show, does Typr set the Dock icon,
// following the appearance.

const devIcon = (dark: boolean): string => join(__dirname, '../../resources', dark ? 'icon-dark.png' : 'icon-light.png')

export function followAppearanceInDock(): void {
  if (app.isPackaged) return
  const update = (): void => app.dock?.setIcon(devIcon(nativeTheme.shouldUseDarkColors))
  update()
  nativeTheme.on('updated', update)
}
