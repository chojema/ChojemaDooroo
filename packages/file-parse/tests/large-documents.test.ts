import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  ATTACHABLE_MAX_BYTES,
  attachableMaxBytes,
  parseFileToText,
  readZipTextParts,
} from '../src/index'
import { isTextPart } from '../src/zip-text-parts'

const work = mkdtempSync(join(tmpdir(), 'large-documents-'))
afterAll(() => rmSync(work, { recursive: true, force: true }))

const FIXTURE = join(__dirname, '../../../apps/hwp/tests/fixtures/page-number-pages.hwpx')

describe('a zip-based document past the whole-read size', () => {
  it('has no size cap for HWPX, and the usual cap for the old binary format', () => {
    expect(attachableMaxBytes('.hwpx')).toBe(Number.POSITIVE_INFINITY)
    expect(attachableMaxBytes('hwp')).toBe(ATTACHABLE_MAX_BYTES)
  })

  it('reads an HWPX for the same text from its text parts alone', async () => {
    const whole = await parseFileToText(FIXTURE)
    const parts = await parseFileToText(FIXTURE, { wholeZipMaxBytes: 1 })
    expect(whole.ok).toBe(true)
    expect(parts).toEqual(whole)
  })

  it('keeps the text parts and empties the rest', async () => {
    const small = await readZipTextParts(FIXTURE)
    expect(small.subarray(0, 2).toString('latin1')).toBe('PK')
    expect(small.length).toBeLessThanOrEqual(readFileSync(FIXTURE).length + 1024)
    expect(isTextPart('Contents/section0.xml')).toBe(true)
    expect(isTextPart('BinData/image1.png')).toBe(false)
  })
})
