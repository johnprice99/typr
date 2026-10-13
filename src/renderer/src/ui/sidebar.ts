import type { FolderListing } from '../../../shared/types'
import { basename, isInside, join, stem } from '../paths'

// The sidebar: each open folder as a section you can collapse, with its
// subfolders and documents inside.

interface Node {
  name: string
  /** Absolute path. */
  path: string
  dir: boolean
  children: Node[]
}

export interface SidebarHandlers {
  open: (path: string) => void
  menu: (path: string, isDir: boolean) => void
  openFolder: () => void
  /** The open folders, in the order you dragged them into. */
  reorder: (order: string[]) => void
}

/** Lets each folder's header be dragged above or below the others. */
function makeReorderable(sections: HTMLElement[], paths: string[], reorder: (order: string[]) => void): void {
  let dragging: string | null = null
  const clear = (): void => sections.forEach((s) => s.classList.remove('drop-before', 'drop-after'))
  sections.forEach((section, i) => {
    const header = section.firstElementChild as HTMLElement
    header.draggable = true
    header.addEventListener('dragstart', (e) => {
      dragging = paths[i]
      e.dataTransfer!.effectAllowed = 'move'
      e.dataTransfer!.setData('text/plain', paths[i])
      section.classList.add('dragging')
    })
    header.addEventListener('dragend', () => {
      dragging = null
      section.classList.remove('dragging')
      clear()
    })
    section.addEventListener('dragover', (e) => {
      if (!dragging) return
      e.preventDefault()
      e.dataTransfer!.dropEffect = 'move'
      const box = section.getBoundingClientRect()
      const after = e.clientY > box.top + box.height / 2
      clear()
      if (paths[i] !== dragging) section.classList.add(after ? 'drop-after' : 'drop-before')
    })
    section.addEventListener('drop', (e) => {
      if (!dragging) return
      e.preventDefault()
      const after = section.classList.contains('drop-after')
      clear()
      if (paths[i] === dragging) return
      const order = paths.filter((p) => p !== dragging)
      order.splice(order.indexOf(paths[i]) + (after ? 1 : 0), 0, dragging)
      reorder(order)
    })
  })
}

// Subfolders start collapsed and are remembered when you open them; the open
// folders themselves (the sections) start open and are remembered when collapsed.
const load = (key: string): Set<string> => new Set<string>(JSON.parse(localStorage.getItem(key) ?? '[]'))
const expanded = load('typr.expanded')
const collapsedRoots = load('typr.collapsedRoots')
const persist = (): void => {
  localStorage.setItem('typr.expanded', JSON.stringify([...expanded]))
  localStorage.setItem('typr.collapsedRoots', JSON.stringify([...collapsedRoots]))
}
let roots = new Set<string>()
const isCollapsed = (path: string): boolean => (roots.has(path) ? collapsedRoots.has(path) : !expanded.has(path))
function toggle(path: string): void {
  if (roots.has(path)) {
    if (!collapsedRoots.delete(path)) collapsedRoots.add(path)
  } else if (!expanded.delete(path)) {
    expanded.add(path)
  }
  persist()
}

const byName = (a: Node, b: Node): number =>
  a.dir !== b.dir ? (a.dir ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })

function tree({ path: root, entries }: FolderListing): Node {
  const top: Node = { name: basename(root), path: root, dir: true, children: [] }
  const dirs = new Map<string, Node>([['', top]])
  const ensure = (rel: string): Node => {
    let node = dirs.get(rel)
    if (node) return node
    const i = rel.lastIndexOf('/')
    const parent = ensure(i < 0 ? '' : rel.slice(0, i))
    node = { name: rel.slice(i + 1), path: join(root, rel), dir: true, children: [] }
    parent.children.push(node)
    dirs.set(rel, node)
    return node
  }
  for (const f of entries) {
    if (f.endsWith('/')) {
      ensure(f.slice(0, -1))
    } else {
      const i = f.lastIndexOf('/')
      ensure(i < 0 ? '' : f.slice(0, i)).children.push({ name: f.slice(i + 1), path: join(root, f), dir: false, children: [] })
    }
  }
  const sort = (n: Node): void => {
    n.children.sort(byName)
    n.children.forEach(sort)
  }
  sort(top)
  return top
}

/** The "Open Files" section's key in the collapsed list (not a real path). */
const OPEN_FILES = 'typr:open-files'

export function renderSidebar(
  el: HTMLElement,
  folders: FolderListing[],
  openFiles: string[],
  current: string | null,
  h: SidebarHandlers
): void {
  roots = new Set([...folders.map((f) => f.path), OPEN_FILES])
  // Always show the way to the open file (within its open folder).
  const root = current ? folders.find((f) => isInside(current, f.path))?.path : undefined
  if (current && root) {
    collapsedRoots.delete(root)
    for (let d = current.slice(0, current.lastIndexOf('/')); d.length > root.length; d = d.slice(0, d.lastIndexOf('/'))) {
      expanded.add(d)
    }
    persist()
  }

  const row = (n: Node, depth: number, cls: string, label: string): HTMLDivElement => {
    const r = document.createElement('div')
    r.className = `${cls}${n.path === current ? ' current' : ''}${n.dir && isCollapsed(n.path) ? ' collapsed' : ''}`
    r.style.paddingLeft = `${12 + depth * 14}px`
    r.textContent = label
    r.title = n.path.replace(/^\/Users\/[^/]+/, '~')
    r.addEventListener('click', () => {
      if (!n.dir) return h.open(n.path)
      toggle(n.path)
      r.classList.toggle('collapsed')
      r.nextElementSibling?.classList.toggle('hidden')
    })
    r.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      if (n.path !== OPEN_FILES) h.menu(n.path, n.dir)
    })
    return r
  }

  const draw = (nodes: Node[], depth: number): HTMLUListElement => {
    const ul = document.createElement('ul')
    for (const n of nodes) {
      const li = document.createElement('li')
      li.append(row(n, depth, `row ${n.dir ? 'folder' : 'file'}`, n.dir ? n.name : stem(n.name)))
      if (n.dir) {
        const sub = draw(n.children, depth + 1)
        if (isCollapsed(n.path)) sub.classList.add('hidden')
        li.append(sub)
      }
      ul.append(li)
    }
    return ul
  }

  if (!folders.length && !openFiles.length) {
    const empty = document.createElement('div')
    empty.className = 'sidebar-empty'
    const open = document.createElement('button')
    open.className = 'link'
    open.textContent = 'Open a folder…'
    open.addEventListener('click', h.openFolder)
    empty.append('No folders open.', document.createElement('br'), open, ' (⇧⌘O)')
    el.replaceChildren(empty)
    return
  }

  const sections = folders.map((f) => {
    const top = tree(f)
    const section = document.createElement('section')
    section.className = 'sidebar-folder'
    section.append(row(top, 0, 'sidebar-header', top.name))
    const body = top.children.length
      ? draw(top.children, 0)
      : Object.assign(document.createElement('p'), { className: 'sidebar-note', textContent: 'No documents yet' })
    if (isCollapsed(top.path)) body.classList.add('hidden')
    section.append(body)
    return section
  })
  if (folders.length > 1)
    makeReorderable(
      sections,
      folders.map((f) => f.path),
      h.reorder
    )

  // Files opened from outside the folders, at the top for quick reopening.
  const loose: HTMLElement[] = []
  if (openFiles.length) {
    const section = document.createElement('section')
    section.className = 'sidebar-folder sidebar-open-files'
    const header: Node = { name: 'Open Files', path: OPEN_FILES, dir: true, children: [] }
    const files = openFiles.map((path): Node => ({ name: basename(path), path, dir: false, children: [] })).sort(byName)
    section.append(row(header, 0, 'sidebar-header', 'Open Files'))
    const ul = document.createElement('ul')
    for (const f of files) {
      const li = document.createElement('li')
      li.append(row(f, 0, 'row file', stem(f.name)))
      ul.append(li)
    }
    if (isCollapsed(OPEN_FILES)) ul.classList.add('hidden')
    section.append(ul)
    loose.push(section)
  }
  el.replaceChildren(...loose, ...sections)
}
