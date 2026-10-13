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

export function renderSidebar(el: HTMLElement, folders: FolderListing[], current: string | null, h: SidebarHandlers): void {
  roots = new Set(folders.map((f) => f.path))
  // Always show the way to the open file.
  if (current) {
    for (const r of roots) if (isInside(current, r)) collapsedRoots.delete(r)
    for (
      let d = current.slice(0, current.lastIndexOf('/'));
      d.includes('/') && !roots.has(d);
      d = d.slice(0, d.lastIndexOf('/'))
    ) {
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
      h.menu(n.path, n.dir)
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

  if (!folders.length) {
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

  el.replaceChildren(
    ...folders.map((f) => {
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
  )
}
