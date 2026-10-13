import { describe, expect, it } from 'vitest'
import { normalizeSettings } from '../../src/shared/settings'

const LIB = '/Users/me/Documents/Typr'

describe('settings from disk', () => {
  it('turns an old single library into the first open folder', () => {
    expect(normalizeSettings({ library: LIB, librarySet: true }).folders).toEqual([LIB])
    expect(normalizeSettings({ library: LIB, librarySet: false }).folders).toEqual([])
    expect(normalizeSettings({ folders: [LIB, LIB, 'relative', 3] }).folders).toEqual([LIB])
  })

  it('fills in defaults on first launch', () => {
    expect(normalizeSettings({})).toEqual({
      folders: [],
      sidebar: false,
      focus: 'paragraph',
      textSize: 'medium',
      showMarkdown: false,
      theme: 'system',
      fullscreen: false,
      window: { maximized: true, bounds: undefined }
    })
  })

  it('upgrades older formats', () => {
    const s = normalizeSettings({ focus: true, focusScope: 'sentence', textScale: 1.2, font: 'serif', typewriter: true })
    expect(s.focus).toBe('sentence')
    expect(s.textSize).toBe('large')
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
