import type { AgentBridge } from './ai/agent-bridge'
import type { PrintJob, PrintMode, PrintPage } from '../shared/ipc'

/**
 * Gathering the pages for a PDF or a print: the plugin draws them a few at a time (each
 * call must finish well within the bridge's ten seconds), and every picture the pages
 * carry is kept once. A logo on every page of a long document is otherwise sent and
 * written once per page.
 */

/** A picture in a page, as the editor writes it into the SVG. */
const PICTURE = /\bhref="(data:image\/[^"]*)"/g

/** The page with its pictures moved into `images`, each picture once across the job. */
export function sharePictures(svg: string, images: string[], known: Map<string, number>): string {
  return svg.replace(PICTURE, (_, dataUrl: string) => {
    let index = known.get(dataUrl)
    if (index === undefined) {
      index = images.length
      images.push(dataUrl)
      known.set(dataUrl, index)
    }
    return `href="ieum-image:${index}"`
  })
}

/** Calls of printPages one job makes at most: a plugin that stops moving must not hang it. */
const MAX_PRINT_CALLS = 10_000

/**
 * The page indexes (0-based, in order, each once) a range such as `1-3, 5, 8-` asks for, in
 * a document of `pageCount` pages.
 */
export function parsePageRange(
  text: string,
  pageCount: number,
): { pages: number[] } | { error: 'invalid' | 'outside' } {
  const pages = new Set<number>()
  const parts = text.split(/[,;，、]/).map((part) => part.trim()).filter(Boolean)
  if (parts.length === 0) return { error: 'invalid' }
  for (const part of parts) {
    const match = /^(\d+)(?:\s*([-–~])\s*(\d*))?$/.exec(part)
    if (!match) return { error: 'invalid' }
    const first = Number(match[1])
    const last = match[2] ? (match[3] ? Number(match[3]) : pageCount) : first
    if (first > last && match[3]) return { error: 'invalid' }
    if (first < 1 || first > pageCount || last > pageCount) return { error: 'outside' }
    for (let page = first; page <= last; page++) pages.add(page - 1)
  }
  return { pages: [...pages].sort((a, b) => a - b) }
}

/** `only` keeps the job to those page indexes (in order, each once); the job is every page without it. */
export async function gatherPrintJob(
  bridge: Pick<AgentBridge, 'printPages'>,
  mode: PrintMode,
  onProgress: (done: number, total: number) => void,
  only?: readonly number[],
): Promise<PrintJob> {
  if (only) return gatherPages(bridge, mode, onProgress, only)
  const pages: PrintPage[] = []
  const images: string[] = []
  const known = new Map<string, number>()
  let total = 0
  for (let calls = 0; calls < MAX_PRINT_CALLS; calls++) {
    const batch = await bridge.printPages(pages.length)
    // a page count that moved under the job (an edit while gathering) stops it: the pages
    // gathered so far no longer belong with the ones still to come
    if (calls > 0 && batch.pageCount !== total) {
      throw new Error('the document changed while printing')
    }
    total = batch.pageCount
    if (batch.from !== pages.length) throw new Error('pages came back out of order')
    for (const page of batch.pages) {
      pages.push({ ...page, svg: sharePictures(page.svg, images, known) })
    }
    onProgress(pages.length, total)
    if (pages.length >= total) return { mode, pages, images }
    if (batch.pages.length === 0) break
  }
  throw new Error('the pages could not be drawn')
}

async function gatherPages(
  bridge: Pick<AgentBridge, 'printPages'>,
  mode: PrintMode,
  onProgress: (done: number, total: number) => void,
  only: readonly number[],
): Promise<PrintJob> {
  const pages: PrintPage[] = []
  const images: string[] = []
  const known = new Map<string, number>()
  let total: number | null = null
  for (let calls = 0; pages.length < only.length; calls++) {
    if (calls >= MAX_PRINT_CALLS) throw new Error('the pages could not be drawn')
    const from = only[pages.length]!
    // up to the end of this unbroken run of pages
    let run = 1
    while (only[pages.length + run] === from + run) run++
    const batch = await bridge.printPages(from, from + run)
    if (total !== null && batch.pageCount !== total) {
      throw new Error('the document changed while printing')
    }
    total = batch.pageCount
    if (batch.from !== from) throw new Error('the document changed while printing')
    if (batch.pages.length === 0) throw new Error('the document changed while printing')
    for (const page of batch.pages) {
      pages.push({ ...page, svg: sharePictures(page.svg, images, known) })
    }
    onProgress(pages.length, only.length)
  }
  return { mode, pages, images, numbers: only.map((page) => page + 1) }
}
