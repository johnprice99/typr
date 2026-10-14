import { app, Menu, MenuItemConstructorOptions } from 'electron'
import type { Command, Settings } from '../shared/types'

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
        sep,
        { role: 'quit' }
      ]
    },
    {
      label: 'File',
      submenu: [
        cmd('New', 'new', 'CmdOrCtrl+N'),
        cmd('Open…', 'open', 'CmdOrCtrl+O'),
        cmd('Open Folder…', 'open-folder', 'CmdOrCtrl+Shift+O'),
        { role: 'recentDocuments', submenu: [{ role: 'clearRecentDocuments' }] },
        sep,
        cmd('Save', 'save', 'CmdOrCtrl+S'),
        cmd('Rename…', 'rename', 'CmdOrCtrl+Shift+R'),
        cmd('Show in Finder', 'reveal'),
        cmd('Move to Trash', 'trash'),
        sep,
        cmd('Close Document', 'close-doc', 'CmdOrCtrl+W'),
        { role: 'close', label: 'Close Window', accelerator: 'CmdOrCtrl+Shift+W' }
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
        cmd('Insert Image…', 'image'),
        cmd('Insert Table', 'table'),
        sep,
        cmd('Add Comment', 'comment', 'CmdOrCtrl+Shift+M'),
        cmd('Go to Comment…', 'comments')
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
        cmd('Link', 'link', 'CmdOrCtrl+K')
      ]
    },
    {
      label: 'View',
      submenu: [
        cmd('Command Palette…', 'palette', 'CmdOrCtrl+Shift+P'),
        check('Show Markdown', 'toggle-markdown', settings.showMarkdown, 'CmdOrCtrl+E'),
        sep,
        cmd('Bigger Text', 'text-bigger', 'CmdOrCtrl+='),
        { ...cmd('Bigger Text', 'text-bigger', 'CmdOrCtrl+Plus'), visible: false, acceleratorWorksWhenHidden: true },
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
        check('Library', 'toggle-sidebar', settings.sidebar, 'CmdOrCtrl+\\'),
        {
          label: 'Focus',
          submenu: [
            radio('Off', 'focus-off', settings.focus === 'off'),
            radio('Paragraph', 'focus-paragraph', settings.focus === 'paragraph'),
            radio('Sentence', 'focus-sentence', settings.focus === 'sentence'),
            sep,
            cmd('Next Focus Mode', 'focus-cycle', 'CmdOrCtrl+D')
          ]
        },
        check('Typewriter Scrolling', 'toggle-typewriter', settings.typewriter),
        // macOS adds "Enter Full Screen" here by itself.
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
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
