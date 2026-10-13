export type FocusMode = 'off' | 'paragraph' | 'sentence'
export type TextSize = 'small' | 'medium' | 'large'
export type Theme = 'system' | 'light' | 'dark'

export interface Settings {
  library: string
  /** False until the first-run library choice has been made (or skipped). */
  librarySet: boolean
  sidebar: boolean
  focus: FocusMode
  textSize: TextSize
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

export interface InitialState {
  settings: Settings
  /** Library-relative paths, forward slashes. Folders end with "/". */
  files: string[]
  /** Absolute paths the OS asked us to open before the window was ready. */
  pendingOpen: string[]
  version: string
}

export interface LibraryOptions {
  documents: string
  icloud: string | null
}

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
   * "(changed elsewhere)" copy, whose path is returned. Fails with ENOENT if the file has gone.
   */
  write(path: string, content: string, expected: string): Promise<string | null>
  /** Creates a new, uniquely named file. Returns its absolute path. */
  create(dir: string, baseName: string, content: string): Promise<string>
  /** Renames, keeping the file in its folder. Returns the new absolute path. */
  rename(path: string, baseName: string): Promise<string>
  mkdir(dir: string, name: string): Promise<string>
  trash(path: string): Promise<void>
  reveal(path: string): Promise<void>
  exists(path: string): Promise<boolean>
  openDialog(): Promise<string | null>
  libraryOptions(): Promise<LibraryOptions>
  setLibrary(path: string): Promise<void>
  /** Shows a folder picker. Resolves true if a folder was chosen. */
  chooseLibrary(): Promise<boolean>
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
  onFiles(cb: (files: string[]) => void): void
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
