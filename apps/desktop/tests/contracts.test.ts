import { describe, expect, it } from 'vitest'
import { editorForPath, paneBounds } from '../src/shared/contracts'

describe('document routing', () => {
  it('routes only HWP and HWPX documents', () => {
    expect(editorForPath('문서.hwpx')).toBe('hwp')
    expect(editorForPath('문서.HWP')).toBe('hwp')
    for (const file of ['draft.docx', 'legacy.doc', 'sheet.xlsx', 'slides.pptx', 'book.odt', 'file.pdf', 'bad.hwpx.exe']) expect(editorForPath(file)).toBeUndefined()
  })
})
describe('document viewport bounds', () => {
  it('reserves the tab strip and uses disjoint panes', () => {
    const { primary, secondary } = paneBounds(1361, 940, true)
    expect(primary.y).toBe(36)
    expect(primary.height).toBe(904)
    expect(primary.x + primary.width + 6).toBe(secondary.x)
    expect(secondary.x + secondary.width).toBe(1361)
  })
  it('uses the full width for a single document and never returns negative sizes', () => {
    expect(paneBounds(1200, 800, false).primary).toEqual({ x: 0, y: 36, width: 1200, height: 764 })
    expect(paneBounds(0, 0, true).primary.height).toBe(0)
  })
})
