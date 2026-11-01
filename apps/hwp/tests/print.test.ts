/**
 * PDF and print: the plugin draws the pages for print with the real engine, the renderer
 * gathers them a few at a time keeping each picture once, and the main process puts them
 * in one HTML page sized page by page.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'
import { agentPlugin, type AgentPluginHost } from '../studio-plugin/agent-plugin.mjs'
import {
  IMAGE_SCALE,
  badJob,
  imageFile,
  ownIds,
  pageImageHtml,
  pagePicturePaths,
  printJobToImages,
  printableHtml,
  sideMm,
  type ImageWindow,
} from '../src/main/print-document'
import { gatherPrintJob, parsePageRange, sharePictures } from '../src/renderer/print-flow'
import type { AgentBridge } from '../src/renderer/ai/agent-bridge'

const require = createRequire(import.meta.url)

beforeAll(async () => {
  const wasm = join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')
  await init({ module_or_path: readFileSync(wasm) })
})

/** A blank document of `pages` pages, each starting with its number. */
function open(pages: number) {
  const doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  for (let page = 0; page < pages; page++) {
    if (page > 0) doc.insertPageBreak(0, page - 1, doc.getParagraphLength(0, page - 1))
    doc.insertText(0, page, 0, `쪽 ${page + 1}`)
  }
  const host = {
    read: (fn: (d: never) => unknown) => fn(doc as never),
    transaction: () => {
      throw new Error('printing changes nothing')
    },
    events: { on: () => 0 },
    automation: { registerCommand: () => {}, execute: () => null },
  } as unknown as AgentPluginHost
  return { plugin: agentPlugin.activate(host), doc }
}

describe('the pages for print', () => {
  it('are SVG at the page size, from the page asked for', () => {
    const { plugin, doc } = open(3)
    expect(doc.pageCount()).toBe(3)
    const all = plugin.printPages(0)
    expect(all).toMatchObject({ pageCount: 3, from: 0 })
    expect(all.pages).toHaveLength(3)
    for (const page of all.pages) {
      expect(page.svg.startsWith('<svg')).toBe(true)
      // A4 in CSS pixels
      expect(sideMm(page.width)).toBe(210)
      expect(sideMm(page.height)).toBe(297)
    }
    const rest = plugin.printPages(2)
    expect(rest).toMatchObject({ pageCount: 3, from: 2 })
    expect(rest.pages).toHaveLength(1)
    expect(plugin.printPages(7).pages).toHaveLength(0)
  })

  it('lay out with the portable widths and put the screen’s back', () => {
    const { plugin, doc } = open(1)
    // the screen's widths need a canvas the test does not have: only the calls are recorded
    const calls: boolean[] = []
    Object.assign(doc, {
      canvasMetricsActive: () => true,
      selectCanvasMetrics: (on: boolean) => {
        calls.push(on)
        return true
      },
    })
    plugin.printPages(0)
    expect(calls).toEqual([false, true])
  })

  it('are gathered call by call, and the job keeps each picture once', async () => {
    const { plugin } = open(5)
    const logo = 'data:image/png;base64,iVBORw0KGgo='
    // two pages a call, every page carrying the same picture
    const bridge: Pick<AgentBridge, 'printPages'> = {
      printPages: async (from) => {
        const batch = plugin.printPages(from)
        const pages = batch.pages.slice(0, 2).map((page) => ({
          ...page,
          svg: page.svg.replace('</svg>', `<image href="${logo}"/></svg>`),
        }))
        return { ...batch, pages }
      },
    }
    const progress: number[] = []
    const job = await gatherPrintJob(bridge, 'pdf', (done) => progress.push(done))
    expect(progress).toEqual([2, 4, 5])
    expect(job.pages).toHaveLength(5)
    expect(job.images).toEqual([logo])
    for (const page of job.pages) expect(page.svg).toContain('href="ieum-image:0"')
  })

  it('tell how many pages print and which page the caret is on', () => {
    const { plugin } = open(3)
    expect(plugin.pageStatus()).toEqual({ pageCount: 3, currentPage: 0 })
    expect(plugin.printPages(1, 2).pages).toHaveLength(1)
  })

  it('are gathered for the pages asked for only, in runs, with their numbers', async () => {
    const asked: [number, number | undefined][] = []
    const bridge: Pick<AgentBridge, 'printPages'> = {
      printPages: async (from, end) => {
        asked.push([from, end])
        // one page a call within a run: the run is asked for again from where it stopped
        return { pageCount: 9, from, pages: [{ svg: `<svg>${from}</svg>`, width: 10, height: 10 }] }
      },
    }
    const progress: [number, number][] = []
    const job = await gatherPrintJob(bridge, 'png', (done, total) => progress.push([done, total]), [1, 2, 5])
    expect(asked).toEqual([[1, 3], [2, 3], [5, 6]])
    expect(job.pages.map((page) => page.svg)).toEqual(['<svg>1</svg>', '<svg>2</svg>', '<svg>5</svg>'])
    expect(job.numbers).toEqual([2, 3, 6])
    expect(progress.at(-1)).toEqual([3, 3])
  })

  it('stop when the document shrank below the pages asked for', async () => {
    const bridge: Pick<AgentBridge, 'printPages'> = {
      printPages: async (_from) => ({ pageCount: 2, from: 2, pages: [] }),
    }
    await expect(gatherPrintJob(bridge, 'pdf', () => {}, [4])).rejects.toThrow(/changed/)
  })

  it('stop when the document changes under them', async () => {
    let count = 4
    const bridge: Pick<AgentBridge, 'printPages'> = {
      printPages: async (from) => {
        const result = {
          pageCount: count,
          from,
          pages: [{ svg: '<svg/>', width: 10, height: 10 }],
        }
        count = 6
        return result
      },
    }
    await expect(gatherPrintJob(bridge, 'print', () => {})).rejects.toThrow(/changed/)
  })
})

describe('a range of pages', () => {
  it('reads pages, spans and open ends into page indexes in order, each once', () => {
    expect(parsePageRange('2', 9)).toEqual({ pages: [1] })
    expect(parsePageRange('1-3, 5', 9)).toEqual({ pages: [0, 1, 2, 4] })
    expect(parsePageRange(' 5 , 3~4,4 ', 9)).toEqual({ pages: [2, 3, 4] })
    expect(parsePageRange('8-', 9)).toEqual({ pages: [7, 8] })
    expect(parsePageRange('1,', 9)).toEqual({ pages: [0] })
  })

  it('refuses what is not a range, and pages the document does not have', () => {
    for (const text of ['', ' , ', 'abc', '1-2-3', '-3', '5-3', '1.5']) {
      expect(parsePageRange(text, 9)).toEqual({ error: 'invalid' })
    }
    for (const text of ['0', '10', '8-12', '99999999999-']) {
      expect(parsePageRange(text, 9)).toEqual({ error: 'outside' })
    }
  })
})

describe('the preview page', () => {
  it('draws one page as print, with the count it belongs to', () => {
    const { plugin } = open(3)
    const page = plugin.previewPage(1)
    expect(page).toMatchObject({ pageCount: 3, page: 1 })
    expect(page.svg.startsWith('<svg')).toBe(true)
    expect(sideMm(page.width)).toBe(210)
    expect(sideMm(page.height)).toBe(297)
  })

  it('refuses a page outside the document', () => {
    const { plugin } = open(2)
    expect(() => plugin.previewPage(-1)).toThrow()
    expect(() => plugin.previewPage(2)).toThrow()
  })

  it('lays the page out with the portable widths, then puts the screen’s back', () => {
    const { plugin, doc } = open(1)
    const calls: boolean[] = []
    Object.assign(doc, {
      canvasMetricsActive: () => true,
      selectCanvasMetrics: (on: boolean) => {
        calls.push(on)
        return true
      },
    })
    plugin.previewPage(0)
    expect(calls).toEqual([false, true])
  })
})

describe('the preview page target', () => {
  it('finds the first paragraph that starts on the page', () => {
    const { plugin } = open(3)
    const target = plugin.pageTarget(1)
    expect(target.ok).toBe(true)
    if (!target.ok) return
    expect(target.page).toBe(1)
    expect(target.target).toMatchObject({
      kind: 'body_paragraph',
      section: 0,
      paragraph: 1,
      charOffset: 0,
    })
    expect(target.target.length).toBeGreaterThan(0)
  })

  it('refuses a page outside the document', () => {
    const { plugin } = open(2)
    expect(() => plugin.pageTarget(2)).toThrow()
    expect(() => plugin.pageTarget(-1)).toThrow()
  })
})

describe('sharing pictures', () => {
  it('replaces each picture by its place in the job, the same picture by the same place', () => {
    const images: string[] = []
    const known = new Map<string, number>()
    const a = 'data:image/png;base64,AAAA'
    const b = 'data:image/jpeg;base64,BBBB'
    expect(sharePictures(`<image href="${a}"/><image href="${b}"/>`, images, known)).toBe(
      '<image href="ieum-image:0"/><image href="ieum-image:1"/>',
    )
    expect(sharePictures(`<image href="${b}"/>`, images, known)).toBe(
      '<image href="ieum-image:1"/>',
    )
    expect(images).toEqual([a, b])
    // links are not pictures
    expect(sharePictures('<a href="https://example.com/">x</a>', images, known)).toContain(
      'https://example.com/',
    )
  })
})

describe('the printable HTML', () => {
  it('puts the paper sizes on the standard sizes they are meant to be', () => {
    // 59528 × 84186 HWPUNIT as the editor reports them
    expect(sideMm(793.7)).toBe(210)
    expect(sideMm(1122.5)).toBe(297)
    expect(sideMm(1587.4)).toBe(420)
    expect(sideMm(740.8)).toBe(196.003)
  })

  it('gives every page its own ids, with the references that use them', () => {
    const svg =
      '<svg><defs><clipPath id="body-clip-2"><rect/></clipPath></defs>' +
      '<g clip-path="url(#body-clip-2)"><use href="#body-clip-2"/></g></svg>'
    expect(ownIds(svg, 'p3-')).toBe(
      '<svg><defs><clipPath id="p3-body-clip-2"><rect/></clipPath></defs>' +
        '<g clip-path="url(#p3-body-clip-2)"><use href="#p3-body-clip-2"/></g></svg>',
    )
  })

  it('sizes each page on its own and points the pictures at their files', () => {
    const html = printableHtml(
      [
        { svg: '<svg id="a"><image href="ieum-image:0"/></svg>', width: 793.7, height: 1122.5 },
        { svg: '<svg id="a"></svg>', width: 1122.5, height: 793.7 },
      ],
      (index) => `image-${index}.png`,
    )
    expect(html).toContain('@page p0 { size: 210mm 297mm; margin: 0; }')
    expect(html).toContain('@page p1 { size: 297mm 210mm; margin: 0; }')
    expect(html).toContain('<div class="page p0"><svg id="p0-a"><image href="image-0.png"/></svg>')
    expect(html).toContain('<svg id="p1-a">')
    // nothing in it may run or reach out
    expect(html).toContain("default-src 'none'")
    expect(html).not.toContain('<script')
  })

  it('writes the usual picture types out as files and keeps the rest in the page', () => {
    const png = imageFile('data:image/png;base64,iVBORw0KGgo=', 4)
    expect(png?.name).toBe('image-4.png')
    expect([...png!.bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
    expect(imageFile('data:image/svg+xml;base64,PHN2Zy8+', 0)?.name).toBe('image-0.svg')
    expect(imageFile('data:image/x-wmf;base64,AAAA', 0)).toBeNull()
    expect(imageFile('data:text/html;base64,AAAA', 0)).toBeNull()
  })

  it('refuses jobs that are not pages', () => {
    const page = { svg: '<svg/>', width: 10, height: 10 }
    expect(badJob({ mode: 'pdf', pages: [page], images: [] })).toBeNull()
    expect(badJob({ mode: 'png', pages: [page], images: [] })).toBeNull()
    expect(badJob({ mode: 'jpg', pages: [page], images: [] })).toBeNull()
    expect(badJob({ mode: 'fax', pages: [page], images: [] })).toMatch(/mode/)
    expect(badJob({ mode: 'pdf', pages: [], images: [] })).toMatch(/no pages/)
    expect(badJob({ mode: 'pdf', pages: [{ ...page, svg: '<html>' }], images: [] })).toMatch(/page/)
    expect(badJob({ mode: 'pdf', pages: [{ ...page, width: -1 }], images: [] })).toMatch(/size/)
    expect(badJob({ mode: 'pdf', pages: [page], images: [3] })).toMatch(/pictures/)
    expect(badJob({ mode: 'pdf', pages: [page], images: [], numbers: [2] })).toBeNull()
    expect(badJob({ mode: 'pdf', pages: [page], images: [], numbers: [1, 2] })).toMatch(/numbers/)
    expect(badJob({ mode: 'pdf', pages: [page], images: [], numbers: [0] })).toMatch(/numbers/)
    expect(badJob(null)).toMatch(/not a print job/)
  })
})

describe('the pages as pictures', () => {
  it('names one file for a single page and numbered files in page order for more', () => {
    expect(pagePicturePaths('/docs/report.png', 'png', 1)).toEqual(['/docs/report.png'])
    expect(pagePicturePaths('/docs/report', 'jpg', 1)).toEqual(['/docs/report.jpg'])
    expect(pagePicturePaths('/docs/report.jpeg', 'jpg', 3)).toEqual([
      '/docs/report-01.jpg',
      '/docs/report-02.jpg',
      '/docs/report-03.jpg',
    ])
    expect(pagePicturePaths('/docs/a.png', 'png', 2, [3, 120])).toEqual([
      '/docs/a-003.png',
      '/docs/a-120.png',
    ])
    const many = pagePicturePaths('/docs/a.png', 'png', 120)
    expect(many[0]).toBe('/docs/a-001.png')
    expect(many[119]).toBe('/docs/a-120.png')
  })

  it('draws one page filling the window on white, with nothing that runs', () => {
    const html = pageImageHtml(
      { svg: '<svg id="a"><image href="ieum-image:2"/></svg>', width: 10, height: 10 },
      (index) => `image-${index}.png`,
    )
    expect(html).toContain(
      '<body><svg id="p0-a"><image href="image-2.png"/></svg><div class="drawn"></div></body>',
    )
    expect(html).toContain('background: #fff')
    expect(html).toContain("default-src 'none'")
    expect(html).not.toContain('<script')
  })

  /**
   * An offscreen window: each invalidate paints a frame of the current size (none at all
   * when `paints` is false), and the frames before a load are an empty one. The first
   * `whiteFrames` of each load are the white of a window yet to draw the page.
   */
  function offscreen(paints = true, whiteFrames = 0) {
    const sizes: number[][] = []
    const loaded: string[] = []
    const state = { destroyed: false, size: [0, 0], loads: 0, painted: 0 }
    const listeners = new Set<(event: unknown, dirty: unknown, image: unknown) => void>()
    const frame = (empty: boolean) => {
      const drawn = state.painted++ >= whiteFrames
      const picture = {
        toPNG: () => Buffer.from(`png ${state.loads} ${drawn ? 'page' : 'white'}`),
        toJPEG: (quality: number) =>
          Buffer.from(`jpeg ${quality} ${state.loads} ${drawn ? 'page' : 'white'}`),
      }
      return {
        isEmpty: () => empty,
        getSize: () => ({ width: state.size[0], height: state.size[1] }),
        toBitmap: () => Buffer.from(drawn ? [255, 0, 255, 255] : [255, 255, 255, 255]),
        crop: (rect: { height: number }) =>
          rect.height === 1
            ? { toBitmap: () => Buffer.from(drawn ? [255, 0, 255, 255] : [255, 255, 255, 255]) }
            : { ...picture, cropped: rect },
        ...picture,
      }
    }
    const win = {
      setContentSize: (width: number, height: number) => {
        sizes.push([width, height])
        state.size = [width, height]
      },
      loadFile: async (path: string) => {
        loaded.push(readFileSync(path, 'utf8'))
        state.loads++
        state.painted = 0
      },
      destroy: () => {
        state.destroyed = true
      },
      webContents: {
        on: (_name: string, listener: (event: unknown, dirty: unknown, image: unknown) => void) =>
          listeners.add(listener),
        off: (_name: string, listener: (event: unknown, dirty: unknown, image: unknown) => void) =>
          listeners.delete(listener),
        invalidate: () => {
          if (paints) for (const listener of listeners) listener({}, {}, frame(false))
        },
      },
    } as unknown as ImageWindow
    return { win, sizes, loaded, state, listeners }
  }

  it('draws each page at its own size, scaled, and saves it in the format asked for', async () => {
    const { win, sizes, loaded, state, listeners } = offscreen()
    const saved: [number, string][] = []
    await printJobToImages(
      {
        mode: 'jpg',
        pages: [
          { svg: '<svg id="one"/>', width: 793.7, height: 1122.5 },
          { svg: '<svg id="two"/>', width: 1122.5, height: 793.7 },
        ],
        images: [],
      },
      'jpg',
      () => win,
      async (index, bytes) => {
        saved.push([index, bytes.toString()])
      },
    )
    expect(sizes).toEqual([
      [Math.round(793.7 * IMAGE_SCALE), Math.round(1122.5 * IMAGE_SCALE) + 1],
      [Math.round(1122.5 * IMAGE_SCALE), Math.round(793.7 * IMAGE_SCALE) + 1],
    ])
    expect(loaded[0]).toContain('id="p0-one"')
    expect(loaded[1]).toContain('id="p0-two"')
    // each page's frame is one drawn after its own load
    expect(saved).toEqual([
      [0, 'jpeg 90 1 page'],
      [1, 'jpeg 90 2 page'],
    ])
    expect(state.destroyed).toBe(true)
    expect(listeners.size).toBe(0)
  })

  it('waits past the white frames of a window yet to draw the page', async () => {
    const { win } = offscreen(true, 3)
    const saved: string[] = []
    await printJobToImages(
      { mode: 'png', pages: [{ svg: '<svg/>', width: 10, height: 10 }], images: [] },
      'png',
      () => win,
      async (_index, bytes) => {
        saved.push(bytes.toString())
      },
    )
    expect(saved).toEqual(['png 1 page'])
  })

  it('stops at a page that is never drawn, and still closes the window', async () => {
    // only the frame wait's clock is fake: the job's files are written for real
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    const { win, state } = offscreen(false)
    let settled = false
    const done = expect(
      printJobToImages(
        { mode: 'png', pages: [{ svg: '<svg/>', width: 10, height: 10 }], images: [] },
        'png',
        () => win,
        async () => undefined,
      ),
    )
      .rejects.toThrow(/page 1/)
      .finally(() => {
        settled = true
      })
    for (let i = 0; i < 1000 && !settled; i++) {
      await new Promise((resolve) => setImmediate(resolve))
      await vi.advanceTimersByTimeAsync(100)
    }
    await done
    vi.useRealTimers()
    expect(state.destroyed).toBe(true)
  })
})
