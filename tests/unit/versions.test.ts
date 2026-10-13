import { describe, expect, it } from 'vitest'
import { isNewer } from '../../src/shared/versions'

describe('comparing versions', () => {
  it.each([
    ['v1.0.1', '1.0.0', true],
    ['1.10.0', '1.9.9', true],
    ['v2.0.0', '1.99.0', true],
    ['v1.0.0', '1.0.0', false],
    ['0.9.0', '1.0.0', false],
    ['v1.0', '1.0.0', false]
  ])('%s newer than %s: %s', (candidate, current, newer) => {
    expect(isNewer(candidate, current)).toBe(newer)
  })
})
