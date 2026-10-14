export type FocusMode = 'off' | 'paragraph' | 'sentence'
export type Theme = 'system' | 'light' | 'dark'

export interface Settings {
  /** The folders open in the sidebar (absolute paths). */
  folders: string[]
  /** Files opened from outside those folders, kept in the sidebar's "Open Files". */
  files: string[]
  sidebar: boolean
  focus: FocusMode
  /** Text size, as a multiple of the normal size (one of TEXT_SCALES). */
  textScale: number
  /** Show raw Markdown instead of the formatted view. */
  showMarkdown: boolean
  theme: Theme
  /** Current full-screen state. Not restored on launch. */
  fullscreen: boolean
  window: WindowState
}

export interface WindowState {
  maximized: boolean
  bounds?: { x: number; y: number; width: number; height: number }
}

/** One open folder and what's in it. */
export interface FolderListing {
  path: string
  /** Paths relative to the folder, forward slashes. Subfolders end with "/". */
  entries: string[]
}

export interface InitialState {
  settings: Settings
  folders: FolderListing[]
  /** The "Open Files" that currently exist. */
  files: string[]
  /** Absolute paths the OS asked us to open before the window was ready. */
  pendingOpen: string[]
  /** Menu commands chosen while no window was open. */
  pendingCommands: Command[]
  version: string
}

export type WriteResult =
  | {
      /** Where it was written: the same path, or the file's new place if it was moved. */
      path: string
      /** A copy holding another app's changes, if there were any. */
      copy: string | null
    }
  /** The file was deleted (not moved), so nothing was written. */
  | { gone: true }

/** A command sent from the main process (menus) to the renderer. */
export interface Command {
  id: string
  path?: string
}

export interface Api {
  /** True when running under the end-to-end tests. */
  testing: boolean
  init(): Promise<InitialState>
  read(path: string): Promise<string>
  /**
   * Overwrites an existing file. `expected` is what Typr believes is on disk; if
   * another app has changed the file since, its version is first kept as a
   * "(changed elsewhere)" copy. If the file was renamed or moved, it's written in
   * its new place. Reports `gone` (writing nothing) if it was deleted.
   */
  write(path: string, content: string, expected: string): Promise<WriteResult>
  /** Creates a new, uniquely named file. Returns its absolute path. */
  create(dir: string, baseName: string, content: string): Promise<string>
  /** Renames, keeping the file in its folder. Returns the new absolute path. */
  rename(path: string, baseName: string): Promise<string>
  mkdir(dir: string, name: string): Promise<string>
  trash(path: string): Promise<void>
  reveal(path: string): Promise<void>
  exists(path: string): Promise<boolean>
  openDialog(): Promise<string | null>

  /** Shows the folder chooser and opens the chosen folder in the sidebar. Resolves its path, or null. */
  openFolder(): Promise<string | null>
  /** Removes a folder from the sidebar (nothing on disk changes). */
  closeFolder(path: string): Promise<void>
  /** Puts the open folders in a new order (it must be the same folders). */
  reorderFolders(order: string[]): Promise<void>
  /** Removes a file from "Open Files" (the file isn't touched). */
  forgetFile(path: string): Promise<void>
  /** Asks GitHub for a newer release and offers to download it. */
  checkForUpdates(): Promise<void>
  setCurrent(path: string | null, title: string): Promise<void>
  /** Adds to File › Open Recent. */
  addRecent(path: string): Promise<void>
  setSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void>
  itemMenu(path: string, isDir: boolean): Promise<void>
  openExternal(url: string): Promise<void>
  pickImage(): Promise<string | null>
  /** The file-system path of a dropped file. */
  pathForFile(file: File): string
  /** Reply to onFlush: whether everything was saved, and the document's title. */
  flushed(saved: boolean, title: string): void
  onFolders(cb: (folders: FolderListing[], files: string[]) => void): void
  onNotice(cb: (text: string) => void): void
  onSettings(cb: (settings: Settings) => void): void
  onCommand(cb: (cmd: Command) => void): void
  onOpen(cb: (path: string) => void): void
  onFileChanged(cb: (path: string) => void): void
  /** The open file was renamed or moved outside the app. */
  onFileMoved(cb: (from: string, to: string) => void): void
  /** The open file was deleted outside the app. */
  onFileGone(cb: (path: string) => void): void
  onFlush(cb: () => void): void
}
