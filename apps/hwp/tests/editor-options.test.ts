import { describe, expect, it } from 'vitest'
import { DEFAULT_EDITOR_OPTIONS, normalizeEditorOptions } from '../src/shared/editor-options'

describe('editor options', () => {
  it("default to the editor's own values", () => {
    expect(normalizeEditorOptions(undefined)).toEqual(DEFAULT_EDITOR_OPTIONS)
    expect(normalizeEditorOptions('x')).toEqual(DEFAULT_EDITOR_OPTIONS)
  })

  it('clamp numbers to the ranges the editor accepts', () => {
    const options = normalizeEditorOptions({ recentFontCount: 9, recoveryIntervalMinutes: 0, idleDelaySeconds: '1000' })
    expect(options.recentFontCount).toBe(5)
    expect(options.recoveryIntervalMinutes).toBe(1)
    expect(options.idleDelaySeconds).toBe(600)
  })

  it('keep the base for missing or bad fields', () => {
    const base = { ...DEFAULT_EDITOR_OPTIONS, recoveryEnabled: false, recentFontCount: 2 }
    const options = normalizeEditorOptions({ recoveryEnabled: 'yes', recentFontCount: Number.NaN, showRecentFonts: false }, base)
    expect(options.recoveryEnabled).toBe(false)
    expect(options.recentFontCount).toBe(2)
    expect(options.showRecentFonts).toBe(false)
  })
})
