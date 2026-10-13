import { app } from 'electron'

// Imported first by everything else in the main process: the app's name decides
// where its settings live, so it must be set before anything reads that path.
app.setName('Typr')

// The end-to-end tests run Typr against a throwaway settings folder.
if (process.env.TYPR_USER_DATA) app.setPath('userData', process.env.TYPR_USER_DATA)

export const testing = process.env.TYPR_TEST === '1'

// Test copies run as background apps: no Dock icon, no menu-bar takeover, no focus stealing.
if (testing) app.setActivationPolicy('accessory')
