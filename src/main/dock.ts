import { app, nativeTheme } from 'electron'
import { join } from 'path'

// The Dock icon follows the appearance: light or dark. It follows Typr's
// Appearance setting, which by default follows the system. (Finder and
// Launchpad show the static icon from build/icon.icns.)

const iconPath = (name: string): string =>
  app.isPackaged ? join(process.resourcesPath, 'icons', name) : join(__dirname, '../../resources', name)

export function updateDockIcon(): void {
  app.dock?.setIcon(iconPath(nativeTheme.shouldUseDarkColors ? 'icon-dark.png' : 'icon-light.png'))
}

export function followAppearanceInDock(): void {
  updateDockIcon()
  nativeTheme.on('updated', updateDockIcon)
}
