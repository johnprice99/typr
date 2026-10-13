import type { Api, Command, Settings } from './types'

// Every message between the main process and the window is defined here, typed
// against the Api interface, so a misspelt channel or a wrong argument is a
// compile error rather than a silent failure.

/** Requests from the window that get a reply. Each channel is named after its Api method. */
export const INVOKE_CHANNELS = [
  'init',
  'read',
  'write',
  'create',
  'rename',
  'mkdir',
  'trash',
  'reveal',
  'exists',
  'openDialog',
  'pickImage',
  'libraryOptions',
  'setLibrary',
  'chooseLibrary',
  'setCurrent',
  'addRecent',
  'setSetting',
  'itemMenu',
  'openExternal'
] as const satisfies readonly (keyof Api)[]

export type InvokeChannel = (typeof INVOKE_CHANNELS)[number]
export type Invoke = Pick<Api, InvokeChannel>

/** Messages from the main process to the window, with their arguments. */
export interface Events {
  files: [files: string[]]
  settings: [settings: Settings]
  command: [cmd: Command]
  open: [path: string]
  'file-changed': [path: string]
  'file-moved': [from: string, to: string]
  'file-gone': [path: string]
  /** The window is closing: save, then reply on FLUSHED. */
  flush: []
}

/** The window's reply to `flush`: whether everything was saved, and the document's title. */
export const FLUSHED = 'flushed'
export type FlushedArgs = [saved: boolean, title: string]
