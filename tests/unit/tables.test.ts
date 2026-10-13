import { describe, expect, it } from 'vitest'
import { cellStarts, splitRow } from '../../src/renderer/src/editor/tables'

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
