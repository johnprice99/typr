import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { Events, FLUSHED, INVOKE_CHANNELS, Invoke } from '../shared/ipc'
import type { Api } from '../shared/types'

// The bridge between the window and the main process. Requests are generated
// from the shared channel list; events are subscribed by name.

const invoke = Object.fromEntries(
  INVOKE_CHANNELS.map((channel) => [channel, (...args: unknown[]) => ipcRenderer.invoke(channel, ...args)])
) as unknown as Invoke

const on =
  <K extends keyof Events>(channel: K) =>
  (cb: (...args: Events[K]) => void): void => {
    ipcRenderer.on(channel, (_e, ...args) => cb(...(args as Events[K])))
  }

const api: Api = {
  ...invoke,
  testing: process.argv.includes('--typr-test'),
  pathForFile: (file) => webUtils.getPathForFile(file),
  flushed: (saved, title) => ipcRenderer.send(FLUSHED, saved, title),
  onFolders: on('folders'),
  onSettings: on('settings'),
  onCommand: on('command'),
  onOpen: on('open'),
  onFileChanged: on('file-changed'),
  onFileMoved: on('file-moved'),
  onFileGone: on('file-gone'),
  onFlush: on('flush')
}

contextBridge.exposeInMainWorld('api', api)
