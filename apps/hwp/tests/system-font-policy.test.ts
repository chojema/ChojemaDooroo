import { afterEach, describe, expect, it } from 'vitest'
import { allowedFontFamilies, allowCanvasFontAlias, setSystemFontFaces, systemFontFamily, systemFontSvg } from '../studio-plugin/pc-fonts.mjs'

afterEach(() => setSystemFontFaces([]))

describe('rendering font policy', () => {
  it('allows catalog aliases, rejects other app fonts and fails closed with an empty catalog', () => {
    expect(systemFontFamily('"Private App Font", serif')).toBe('serif')
    setSystemFontFaces([{ family: 'SystemFont', aliases: ['시스템 글꼴'] }])
    expect(allowedFontFamilies(['Private App Font', '시스템 글꼴', 'serif'])).toEqual(['시스템 글꼴', 'serif'])
    expect(systemFontFamily('"Private App Font"')).toBe('sans-serif')
    expect(systemFontFamily('"SystemFont", "Private App Font", serif')).toBe('"SystemFont", serif')
    setSystemFontFaces([])
    expect(systemFontFamily('SystemFont')).toBe('sans-serif')
  })
  it('accepts only explicitly registered internal canvas aliases', () => {
    expect(systemFontFamily('__rhwp_host_face_1_1')).toBe('sans-serif')
    allowCanvasFontAlias('__rhwp_host_face_1_1')
    expect(systemFontFamily('__rhwp_host_face_1_1')).toBe('"__rhwp_host_face_1_1"')
  })
  it('filters SVG attributes and styles without changing text or stored names', () => {
    setSystemFontFaces([{ family: 'SystemFont', aliases: [] }])
    const svg = '<svg><text font-family="&quot;Private&quot;, SystemFont, serif">Private</text><text style="font-family:&quot;Private&quot;;fill:red">원문</text></svg>'
    const rendered = systemFontSvg(svg)
    expect(rendered).toContain('font-family="&quot;SystemFont&quot;, serif"')
    expect(rendered).toContain('style="font-family:sans-serif;fill:red"')
    expect(rendered).toContain('>Private</text>')
    expect(svg).toContain('&quot;Private&quot;, SystemFont')
  })
})
