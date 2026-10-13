import { describe, expect, it } from 'vitest'
import { nearestScale, normalizeSettings, stepScale, TEXT_SCALES } from '../../src/shared/settings'

const LIB = '/Users/me/Documents/Typr'

describe('text size steps', () => {
  it('steps up and down within the range, and snaps odd values to a step', () => {
    expect(stepScale(1, 1)).toBe(1.1)
    expect(stepScale(1, -1)).toBe(0.9)
    expect(stepScale(TEXT_SCALES[TEXT_SCALES.length - 1], 1)).toBe(TEXT_SCALES[TEXT_SCALES.length - 1])
    expect(stepScale(TEXT_SCALES[0], -1)).toBe(TEXT_SCALES[0])
    expect(nearestScale(1.04)).toBe(1)
    expect(normalizeSettings({ textSize: 'large' }).textScale).toBe(1.1)
  })
})

describe('settings from disk', () => {
  it('turns an old single library into the first open folder', () => {
    expect(normalizeSettings({ library: LIB, librarySet: true }).folders).toEqual([LIB])
    expect(normalizeSettings({ library: LIB, librarySet: false }).folders).toEqual([])
    expect(normalizeSettings({ folders: [LIB, LIB, 'relative', 3] }).folders).toEqual([LIB])
  })

  it('fills in defaults on first launch', () => {
    expect(normalizeSettings({})).toEqual({
      folders: [],
      files: [],
      sidebar: false,
      focus: 'paragraph',
      textScale: 1,
      showMarkdown: false,
      theme: 'system',
      fullscreen: false,
      window: { maximized: true, bounds: undefined }
    })
  })

  it('upgrades older formats', () => {
    const s = normalizeSettings({ focus: true, focusScope: 'sentence', textScale: 1.2, font: 'serif', typewriter: true })
    expect(s.focus).toBe('sentence')
    expect(s.textScale).toBe(1.2)
    expect('typewriter' in s).toBe(false)
  })

  it('ignores nonsense rather than crashing', () => {
    const s = normalizeSettings({
      library: 42,
      theme: 'neon',
      window: { maximized: 'yes', bounds: { x: 'a' } },
      fullscreen: true
    })
    expect(s.folders).toEqual([])
    expect(s.theme).toBe('system')
    expect(s.window).toEqual({ maximized: true, bounds: undefined })
    expect(s.fullscreen).toBe(false)
  })
})
