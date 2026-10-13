import { stem } from '../paths'

interface Node {
  name: string
  rel: string
  dir: boolean
  children: Node[]
}

export interface SidebarHandlers {
  open: (rel: string) => void
  menu: (rel: string, isDir: boolean) => void
}

const STORE = 'typr.collapsed'
const collapsed = new Set<string>(JSON.parse(localStorage.getItem(STORE) ?? '[]'))
const persist = (): void => localStorage.setItem(STORE, JSON.stringify([...collapsed]))

const byName = (a: Node, b: Node): number =>
  a.dir !== b.dir ? (a.dir ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })

function tree(files: string[]): Node[] {
  const root: Node = { name: '', rel: '', dir: true, children: [] }
  const dirs = new Map<string, Node>([['', root]])
  const ensure = (rel: string): Node => {
    let node = dirs.get(rel)
    if (node) return node
    const i = rel.lastIndexOf('/')
    const parent = ensure(i < 0 ? '' : rel.slice(0, i))
    node = { name: rel.slice(i + 1), rel, dir: true, children: [] }
    parent.children.push(node)
    dirs.set(rel, node)
    return node
  }
  for (const f of files) {
    if (f.endsWith('/')) {
      ensure(f.slice(0, -1))
    } else {
      const i = f.lastIndexOf('/')
      ensure(i < 0 ? '' : f.slice(0, i)).children.push({ name: f.slice(i + 1), rel: f, dir: false, children: [] })
    }
  }
  const sort = (n: Node): void => {
    n.children.sort(byName)
    n.children.forEach(sort)
  }
  sort(root)
  return root.children
}

export function renderSidebar(
  el: HTMLElement,
  files: string[],
  libraryName: string,
  current: string | null,
  h: SidebarHandlers
): void {
  // Always show the way to the open file.
  if (current) {
    const parts = current.split('/')
    for (let i = 1; i < parts.length; i++) collapsed.delete(parts.slice(0, i).join('/'))
  }

  const draw = (nodes: Node[], depth: number): HTMLElement => {
    const ul = document.createElement('ul')
    for (const n of nodes) {
      const li = document.createElement('li')
      const row = document.createElement('div')
      row.className = `row ${n.dir ? 'folder' : 'file'}${n.rel === current ? ' current' : ''}`
      row.style.paddingLeft = `${12 + depth * 14}px`
      row.textContent = n.dir ? n.name : stem(n.name)
      row.title = n.rel
      if (n.dir && collapsed.has(n.rel)) row.classList.add('collapsed')
      row.addEventListener('click', () => {
        if (!n.dir) return h.open(n.rel)
        if (collapsed.has(n.rel)) collapsed.delete(n.rel)
        else collapsed.add(n.rel)
        persist()
        row.classList.toggle('collapsed')
        row.nextElementSibling?.classList.toggle('hidden')
      })
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        h.menu(n.rel, n.dir)
      })
      li.append(row)
      if (n.dir) {
        const sub = draw(n.children, depth + 1)
        if (collapsed.has(n.rel)) sub.classList.add('hidden')
        li.append(sub)
      }
      ul.append(li)
    }
    return ul
  }

  const header = document.createElement('div')
  header.className = 'sidebar-header'
  header.textContent = libraryName
  header.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    h.menu('', true)
  })
  const nodes = tree(files)
  const body = nodes.length
    ? draw(nodes, 0)
    : Object.assign(document.createElement('p'), {
        className: 'sidebar-empty',
        textContent: 'Nothing here yet. ⌘N to start writing.'
      })
  el.replaceChildren(header, body)
}
