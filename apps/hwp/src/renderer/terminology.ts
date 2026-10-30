export type TerminologyStyle = 'word' | 'hwp'

/** Explicit Korean UI vocabulary; never applied to the document model. */
export function wordTerminology(text: string): string {
  return text
    .replace(/문단 모양/g, '단락')
    .replace(/문단/g, '단락')
    .replace(/글자 모양/g, '글꼴')
    .replace(/머리말/g, '머리글')
    .replace(/꼬리말/g, '바닥글')
    .replace(/조판 부호/g, '서식 기호')
    .replace(/찾아 바꾸기/g, '찾기 및 바꾸기')
    .replace(/편집 용지/g, '페이지 설정')
    .replace(/총쪽수/g, '총 페이지 수')
    .replace(/쪽수/g, '페이지 수')
    .replace(/(홀수|짝수)쪽/g, '$1 페이지')
    .replace(/바탕쪽이나/g, '배경 페이지나')
    .replace(/바탕쪽/g, '배경 페이지')
    .replace(/단쪽 보기/g, '한 페이지 보기')
    .replace(/맞쪽/g, '마주 보는 페이지')
    // Preserve direction words (왼쪽, 오른쪽, 양쪽, 안쪽…) and file names.
    .replace(/(^|[^가-힣a-zA-Z_])쪽(으로|이나|은|을|이|과)/g, (_, prefix: string, particle: string) => `${prefix}페이지${({ 으로: '로', 이나: '나', 은: '는', 을: '를', 이: '가', 과: '와' } as Record<string, string>)[particle]}`)
    .replace(/(^|[^가-힣a-zA-Z_])쪽(?=$|[\s·:()/]|번호|나누기|설정|맞춤|테두리|배경|만|을|의|으로|에|이|과|도)/g, '$1페이지')
}

const CHROME = '#studio-header, #status-bar, .dialog-wrap, .context-menu, [role="menu"], [role="tooltip"]'
const CONTENT = 'input, textarea, [contenteditable]:not([contenteditable="false"]), canvas, script, style, #recent-docs-panel, #sb-field, #sb-message, [class*="preview"], [data-terminology="preserve"]'

/**
 * Adapt only studio chrome, retaining each original string so HWP can be restored
 * without guessing a reverse translation. Upstream can rebuild labels at any time.
 * Input values, document canvases and editable previews are never traversed.
 */
export function installTerminology(doc: Document, initial: TerminologyStyle = 'word') {
  let style = initial
  const originals = new WeakMap<Node, Map<string, { source: string; rendered: string }>>()
  const translate = (node: Node, key: string, current: string, write: (value: string) => void, override?: (source: string) => string) => {
    let entries = originals.get(node)
    if (!entries) { entries = new Map(); originals.set(node, entries) }
    const previous = entries.get(key)
    const source = previous && previous.rendered === current ? previous.source : current
    const rendered = style === 'word' ? (override ? override(source) : wordTerminology(source)) : source
    entries.set(key, { source, rendered })
    if (rendered !== current) write(rendered)
  }
  const visit = (node: Node) => {
    const element = node.nodeType === 1 ? node as Element : node.parentElement
    if (!element || element.closest(CONTENT)) return
    if (element.closest(CHROME)) {
      if (node.nodeType === 3) {
        const splitLabel = element.getAttribute('data-i18n-lines')
        const shapeLabel = splitLabel === 'command.format.paraShape.toolbarLabel' || splitLabel === 'command.format.charShape.toolbarLabel'
        translate(node, 'text', node.nodeValue ?? '', (value) => { node.nodeValue = value }, shapeLabel ? (source) => source.replace(/문단/g, '단락').replace(/글자/g, '글꼴').replace(/모양/g, '') : undefined)
      }
      if (node.nodeType === 1) {
        for (const attribute of ['title', 'aria-label', 'placeholder']) {
          const value = element.getAttribute(attribute)
          if (value) translate(node, attribute, value, (next) => element.setAttribute(attribute, next))
        }
      }
    }
    for (const child of Array.from(node.childNodes)) visit(child)
  }
  // Disconnect while writing to avoid observing our own mutations (status labels
  // are refreshed frequently). Only changed subtrees need work between switches.
  const observe = () => observer.observe(doc.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['title', 'aria-label', 'placeholder'] })
  const observer = new doc.defaultView!.MutationObserver((records) => {
    observer.disconnect()
    for (const record of records) {
      if (record.type === 'childList') {
        for (const node of Array.from(record.addedNodes)) visit(node)
      } else visit(record.target)
    }
    observe()
  })
  visit(doc.body)
  observe()
  return {
    setStyle(next: TerminologyStyle) {
      style = next === 'hwp' ? 'hwp' : 'word'
      observer.disconnect()
      visit(doc.body)
      observe()
    },
    dispose() {
      observer.disconnect()
      style = 'hwp'
      visit(doc.body)
    },
  }
}
