import { app, Menu, MenuItemConstructorOptions, shell } from 'electron'
import type { Command, Settings } from '../shared/types'
import { ISSUES, WEBSITE } from '../shared/urls'

// Menus only send command ids; the renderer owns what they do, so the menu bar
// and the command palette can never disagree.
export function buildMenu(settings: Settings, send: (cmd: Command) => void): void {
  const sep: MenuItemConstructorOptions = { type: 'separator' }
  const cmd = (label: string, id: string, accelerator?: string): MenuItemConstructorOptions => ({
    label,
    accelerator,
    click: () => send({ id })
  })
  const radio = (label: string, id: string, checked: boolean): MenuItemConstructorOptions => ({
    label,
    type: 'radio',
    checked,
    click: () => send({ id })
  })
  const check = (label: string, id: string, checked: boolean, accelerator?: string): MenuItemConstructorOptions => ({
    label,
    type: 'checkbox',
    checked,
    accelerator,
    click: () => send({ id })
  })

  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        cmd(`About ${app.name}`, 'about'),
        cmd('Check for Updates…', 'check-updates'),
        sep,
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        sep,
        { role: 'quit' }
      ]
    },
    {
      label: 'File',
      submenu: [
        cmd('New', 'new', 'CmdOrCtrl+N'),
        cmd('Open…', 'open', 'CmdOrCtrl+O'),
        { role: 'recentDocuments', submenu: [{ role: 'clearRecentDocuments' }] },
        sep,
        cmd('Open Folder…', 'open-folder', 'CmdOrCtrl+Shift+O'),
        cmd('Close Folder…', 'close-folder'),
        sep,
        cmd('Save', 'save', 'CmdOrCtrl+S'),
        cmd('Rename…', 'rename', 'CmdOrCtrl+Shift+R'),
        cmd('Show in Finder', 'reveal'),
        cmd('Move to Trash', 'trash'),
        sep,
        cmd('Close Document', 'close-doc', 'CmdOrCtrl+W')
      ]
    },
    {
      // macOS adds Writing Tools, AutoFill, Dictation and Emoji & Symbols here itself.
      label: 'Edit',
      submenu: [
        cmd('Undo', 'undo', 'CmdOrCtrl+Z'),
        cmd('Redo', 'redo', 'CmdOrCtrl+Shift+Z'),
        sep,
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        sep,
        cmd('Find…', 'find', 'CmdOrCtrl+F'),
        cmd('Find and Replace…', 'replace', 'CmdOrCtrl+Shift+F'),
        sep,
        cmd('Add Comment', 'comment', 'CmdOrCtrl+Shift+M'),
        cmd('Go to Comment…', 'comments'),
        cmd('Resolve Comment', 'resolve-comment')
      ]
    },
    {
      label: 'Format',
      submenu: [
        cmd('Bold', 'bold', 'CmdOrCtrl+B'),
        cmd('Italic', 'italic', 'CmdOrCtrl+I'),
        cmd('Underline', 'underline', 'CmdOrCtrl+U'),
        cmd('Strikethrough', 'strike', 'CmdOrCtrl+Shift+X'),
        cmd('Inline Code', 'code', 'CmdOrCtrl+Shift+C'),
        sep,
        cmd('Link', 'link', 'CmdOrCtrl+K'),
        cmd('Image…', 'image'),
        cmd('Table', 'table')
      ]
    },
    {
      label: 'View',
      submenu: [
        check('Show Sidebar', 'toggle-sidebar', settings.sidebar, 'CmdOrCtrl+\\'),
        check('Show Markdown', 'toggle-markdown', settings.showMarkdown, 'CmdOrCtrl+E'),
        sep,
        {
          label: 'Focus',
          submenu: [
            radio('Off', 'focus-off', settings.focus === 'off'),
            radio('Paragraph', 'focus-paragraph', settings.focus === 'paragraph'),
            radio('Sentence', 'focus-sentence', settings.focus === 'sentence'),
            radio('Typewriter', 'focus-typewriter', settings.focus === 'typewriter'),
            sep,
            cmd('Next Focus Mode', 'focus-cycle', 'CmdOrCtrl+D')
          ]
        },
        sep,
        // Shown as ⌘+ like Apple's apps; ⌘= (no Shift) works too.
        cmd('Bigger Text', 'text-bigger', 'CmdOrCtrl+Plus'),
        { ...cmd('Bigger Text', 'text-bigger', 'CmdOrCtrl+='), visible: false, acceleratorWorksWhenHidden: true },
        cmd('Smaller Text', 'text-smaller', 'CmdOrCtrl+-'),
        cmd('Actual Size', 'text-reset', 'CmdOrCtrl+0'),
        {
          label: 'Appearance',
          submenu: [
            radio('System', 'theme-system', settings.theme === 'system'),
            radio('Light', 'theme-light', settings.theme === 'light'),
            radio('Dark', 'theme-dark', settings.theme === 'dark')
          ]
        },
        sep,
        cmd('Command Palette…', 'palette', 'CmdOrCtrl+Shift+P'),
        // macOS's own "Enter Full Screen" item is switched off (index.ts); full
        // screen is the green button, the Window menu, and ⌃⌘F, kept here hidden.
        { role: 'togglefullscreen', accelerator: 'Ctrl+Cmd+F', visible: false, acceleratorWorksWhenHidden: true },
        ...(app.isPackaged
          ? []
          : [{ role: 'toggleDevTools', visible: false, acceleratorWorksWhenHidden: true } as MenuItemConstructorOptions])
      ]
    },
    {
      label: 'Go',
      submenu: [
        cmd('Go to File…', 'quick-open', 'CmdOrCtrl+P'),
        cmd('Follow Link', 'follow-link', 'CmdOrCtrl+Enter'),
        sep,
        cmd('Back', 'back', 'CmdOrCtrl+['),
        cmd('Forward', 'forward', 'CmdOrCtrl+]')
      ]
    },
    { role: 'windowMenu' },
    // macOS gives the Help menu a search box that finds any menu item.
    // (Straight to the browser: these mustn't open a Typr window if it's closed.)
    {
      role: 'help',
      submenu: [
        { label: 'Typr Website', click: () => void shell.openExternal(WEBSITE) },
        { label: 'Report a Problem', click: () => void shell.openExternal(ISSUES) }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
