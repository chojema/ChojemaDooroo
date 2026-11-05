import { describe, expect, it } from 'vitest'
import { fontKey, hostFontNames, missingFonts } from '../src/renderer/font-notice'

describe('standard-folder font notice', () => {
  it('recognizes Korean and English aliases of approved fonts only', () => {
    const names = hostFontNames({ revision: 'r', faces: [{ id: 'a', family: 'HCR Batang',
      fullName: 'HCR Batang', postscriptName: 'HCRBatang', style: 'Regular', aliases: ['함초롬바탕'],
      weight: 400, slant: 'normal' }] })
    expect(missingFonts(['HCR Batang', '함초롬바탕', 'HY견고딕'], names)).toEqual(['HY견고딕'])
    expect(hostFontNames(null).size).toBe(0)
  })
  it('retains all missing names in order without changing document data', () => {
    const fonts = ['Private1', 'Private2', 'Private3', 'Private4', ' Private1 ', '', 'serif']
    const before = [...fonts]
    expect(missingFonts(fonts, new Set())).toEqual(['Private1', 'Private2', 'Private3', 'Private4'])
    expect(fonts).toEqual(before)
    expect(fontKey('  HCR   Batang ')).toBe('hcr batang')
  })
})
