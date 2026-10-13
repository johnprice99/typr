import { describe, expect, it } from 'vitest'
import { normalizeSettings } from '../../src/shared/settings'

const LIB = '/Users/me/Documents/Typr'

describe('settings from disk', () => {
  it('fills in defaults on first launch', () => {
    expect(normalizeSettings({}, LIB)).toEqual({
      library: LIB,
      librarySet: false,
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
    const s = normalizeSettings({ focus: true, focusScope: 'sentence', textScale: 1.2, font: 'serif', typewriter: true }, LIB)
    expect(s.focus).toBe('sentence')
    expect(s.textSize).toBe('large')
    expect('typewriter' in s).toBe(false)
  })

  it('ignores nonsense rather than crashing', () => {
    const s = normalizeSettings(
      { library: 42, theme: 'neon', window: { maximized: 'yes', bounds: { x: 'a' } }, fullscreen: true },
      LIB
    )
    expect(s.library).toBe(LIB)
    expect(s.theme).toBe('system')
    expect(s.window).toEqual({ maximized: true, bounds: undefined })
    expect(s.fullscreen).toBe(false)
  })
})
