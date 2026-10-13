import { EditorView, Panel, ViewUpdate } from '@codemirror/view'
import { EditorSelection } from '@codemirror/state'
import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  replaceAll,
  replaceNext,
  search,
  searchPanelOpen,
  SearchQuery,
  setSearchQuery
} from '@codemirror/search'

// One plain text field, a match count, and an optional replace field.
// No regex, case or whole-word toggles: lower-case searches ignore case,
// and typing a capital letter makes the search match case.

interface FindState {
  wantReplace: boolean
  panel: { setReplace(on: boolean): void } | null
}
const states = new WeakMap<EditorView, FindState>()
const stateOf = (view: EditorView): FindState => {
  let s = states.get(view)
  if (!s) states.set(view, (s = { wantReplace: false, panel: null }))
  return s
}

export function openFind(view: EditorView, replace: boolean): void {
  const s = stateOf(view)
  s.wantReplace = replace
  if (searchPanelOpen(view.state) && s.panel) s.panel.setReplace(replace)
  else openSearchPanel(view)
}

function field(placeholder: string): HTMLInputElement {
  const input = document.createElement('input')
  input.placeholder = placeholder
  input.spellcheck = false
  input.setAttribute('main-field', 'true')
  return input
}

function createPanel(view: EditorView): Panel {
  const dom = document.createElement('div')
  dom.className = 'find'
  const find = field('Find')
  const count = document.createElement('span')
  count.className = 'find-count'
  const replace = field('Replace with')
  replace.removeAttribute('main-field')
  const hint = document.createElement('span')
  hint.className = 'find-count'
  hint.textContent = '↩ next  ⌘↩ all'
  const row = (...els: HTMLElement[]): HTMLDivElement => {
    const r = document.createElement('div')
    r.className = 'find-row'
    r.append(...els)
    return r
  }
  const replaceRow = row(replace, hint)
  replaceRow.classList.add('find-replace')
  dom.append(row(find, count), replaceRow)

  const initial = getSearchQuery(view.state)
  find.value = initial.search
  replace.value = initial.replace
  // Where the cursor was when searching started, so typing finds the next match from there.
  let anchor = view.state.selection.main.from

  const query = (): SearchQuery =>
    new SearchQuery({
      search: find.value,
      replace: replace.value,
      caseSensitive: /\p{Lu}/u.test(find.value),
      literal: true
    })

  const commit = (): void => {
    const q = query()
    if (!q.eq(getSearchQuery(view.state))) view.dispatch({ effects: setSearchQuery.of(q) })
  }

  // Counting walks the whole document, so it's capped and waits for a pause in edits/cursor moves.
  const LIMIT = 1000
  let countTimer = 0
  const scheduleCount = (): void => {
    clearTimeout(countTimer)
    countTimer = window.setTimeout(updateCount, 120)
  }
  const updateCount = (): void => {
    clearTimeout(countTimer)
    if (!dom.isConnected) return
    const q = getSearchQuery(view.state)
    if (!q.search) {
      count.textContent = ''
      dom.classList.remove('none')
      return
    }
    const sel = view.state.selection.main
    const cursor = q.getCursor(view.state)
    let total = 0
    let at = 0
    for (let r = cursor.next(); !r.done; r = cursor.next()) {
      total++
      if (r.value.from === sel.from && r.value.to === sel.to) at = total
      if (total >= LIMIT) break
    }
    const shown = total >= LIMIT ? `${LIMIT}+` : `${total}`
    count.textContent = total ? (at ? `${at} of ${shown}` : shown) : 'No results'
    dom.classList.toggle('none', total === 0)
  }

  const setReplace = (on: boolean): void => {
    dom.classList.toggle('with-replace', on)
    const target = on && find.value ? replace : find
    target.focus()
    target.select()
  }

  // CodeMirror re-selects the search text after each jump; keep the caret at the end instead.
  const jump = (back: boolean): void => {
    const { selectionStart, selectionEnd } = find
    ;(back ? findPrevious : findNext)(view)
    if (document.activeElement === find) find.setSelectionRange(selectionStart, selectionEnd)
  }

  find.addEventListener('input', () => {
    commit()
    view.dispatch({ selection: EditorSelection.cursor(Math.min(anchor, view.state.doc.length)) })
    if (find.value) jump(false)
    updateCount()
  })
  replace.addEventListener('input', commit)

  const close = (): void => {
    closeSearchPanel(view)
    view.focus()
  }

  find.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      jump(e.shiftKey)
      anchor = view.state.selection.main.from
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  })
  replace.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
      ;(e.metaKey ? replaceAll : replaceNext)(view)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  })

  // Like a browser's find bar, it goes away once you click or move elsewhere.
  dom.addEventListener('focusout', () => {
    setTimeout(() => {
      if (dom.isConnected && !dom.contains(document.activeElement)) closeSearchPanel(view)
    })
  })

  return {
    dom,
    top: true,
    mount() {
      commit()
      updateCount()
      const s = stateOf(view)
      s.panel = { setReplace }
      setReplace(s.wantReplace)
    },
    update(u: ViewUpdate) {
      // Keep the starting point in step with edits (e.g. after Replace All shrinks the text).
      if (u.docChanged) anchor = u.changes.mapPos(anchor)
      if (u.transactions.some((tr) => tr.effects.some((e) => e.is(setSearchQuery)))) updateCount()
      else if (u.docChanged || u.selectionSet) scheduleCount()
    },
    destroy() {
      stateOf(view).panel = null
    }
  }
}

export const findBar = search({ top: true, createPanel })
