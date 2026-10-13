import { describe, expect, it } from 'vitest'
import { cellStarts, inline, splitRow } from '../../src/renderer/src/editor/tables'

describe('table rows', () => {
  it('splits cells, with or without outer pipes', () => {
    expect(splitRow('| a | b |')).toEqual(['a', 'b'])
    expect(splitRow('a | b')).toEqual(['a', 'b'])
    expect(splitRow('| a \\| b | c |')).toEqual(['a \\| b', 'c'])
  })

  it('finds where to put the cursor in each cell', () => {
    const row = '| Name | Age |'
    expect(cellStarts(row).map((i) => row.slice(i, i + 3))).toEqual(['Nam', 'Age'])
  })

  it('lands one space into empty cells, so typing gives "| text |"', () => {
    const row = '|  |  |'
    expect(cellStarts(row)).toEqual([2, 5])
  })
})

describe('table cells', () => {
  it('render a little inline Markdown, escaped first', () => {
    expect(inline('**b** and *i* <script>')).toBe('<strong>b</strong> and <em>i</em> &lt;script&gt;')
    expect(inline('a <u>line</u>')).toBe('a <u>line</u>')
  })

  it('leave snake_case names, code and escaped pipes alone', () => {
    expect(inline('snake_case_name')).toBe('snake_case_name')
    expect(inline('`**not bold**`')).toBe('<code>**not bold**</code>')
    expect(inline('a \\| b')).toBe('a | b')
    expect(inline('_em_ word')).toBe('<em>em</em> word')
  })
})
