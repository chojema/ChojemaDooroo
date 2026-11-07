export type TerminologyStyle = 'word' | 'hwp'

// Match complete feature names before general vocabulary. Similar-looking HWP
// features with different semantics (e.g. 나눔 정렬, 바탕쪽) keep their own identity.
const WORD_TERMS: ReadonlyArray<readonly [string, string]> = [
  ['외톨이줄 보호', '단락의 첫 줄이나 마지막 줄 분리 방지'],
  ['문단 앞에서 항상 쪽 나눔', '단락 앞에서 페이지 나누기'],
  ['다음 문단과 함께', '다음 단락과의 사이에 페이지 나누지 않음'],
  ['문단 보호', '현재 단락을 나누지 않음'],
  ['문단 위', '단락 앞'],
  ['문단 아래', '단락 뒤'],
  ['문단 번호 모양', '번호 매기기'],
  ['문단 번호', '번호 매기기'],
  ['문단 부호', '단락 기호'],
  ['문단 모양', '단락'],
  ['문단', '단락'],
  ['글자 모양', '글꼴'],
  ['글자 크기', '글꼴 크기'],
  ['글자 색', '글꼴 색'],
  ['글자 스타일', '문자 스타일'],
  ['장평', '문자 배율'],
  ['자간', '문자 간격'],
  ['진하게', '굵게'],
  ['오려 두기', '잘라내기'],
  ['오려두기', '잘라내기'],
  ['복사하기', '복사'],
  ['골라 붙이기', '선택하여 붙여넣기'],
  ['붙이기', '붙여넣기'],
  ['되돌리기', '실행 취소'],
  ['지우기', '삭제'],
  ['모양 복사', '서식 복사'],
  ['모양 붙여넣기', '서식 붙여넣기'],
  ['찾아가기', '이동'],
  ['글머리표 모양', '글머리 기호'],
  ['글머리표', '글머리 기호'],
  ['글상자', '텍스트 상자'],
  ['문자표', '기호'],
  ['개체 묶기', '그룹화'],
  ['개체 풀기', '그룹 해제'],
  ['글자처럼 취급', '텍스트 줄 안'],
  ['글 앞으로', '텍스트 앞으로'],
  ['글 뒤로', '텍스트 뒤로'],
  ['자리 차지', '위/아래'],
  ['어울림', '정사각형'],
  ['머리말', '머리글'],
  ['꼬리말', '바닥글'],
  ['조판 부호', '서식 기호'],
  ['조판부호', '서식 기호'],
  ['찾아 바꾸기', '찾기 및 바꾸기'],
  ['편집 용지', '페이지 설정'],
]

/** Explicit Korean UI vocabulary; never applied to the document model. */
export function wordTerminology(text: string): string {
  for (const [source, target] of WORD_TERMS) text = text.replaceAll(source, target)
  return text
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
const CONTENT = 'textarea, [contenteditable]:not([contenteditable="false"]), canvas, script, style, #recent-docs-panel, #sb-field, #sb-message, [class*="preview"], [data-terminology="preserve"], #style-name option, #font-name option, .sd-style-name, .sd-cur-style-name, .bm-list'

// Upstream splits these captions at <br>; translating each fragment without its
// command would leave HWP fragments behind or change unrelated uses of 모양/표.
const WORD_TOOLBAR_PARTS: Record<string, Record<string, string>> = {
  'ui.iconToolbarViewport.toolbarLabel.x05c63e': { 오려: '잘라', 두기: '내기' },
  'ui.iconToolbarViewport.toolbarLabel.x06e1ec': { 복사: '복사', 하기: '' },
  'command.edit.formatCopy.toolbarLabel': { 모양: '서식', 복사: '복사' },
  'command.view.ctrlMark.toolbarLabel': { 조판: '서식', 부호: '기호' },
  'command.view.paraMark.toolbarLabel': { 문단: '단락', 부호: '기호' },
  'command.format.paraShape.toolbarLabel': { 문단: '단락', 모양: '' },
  'command.format.charShape.toolbarLabel': { 글자: '글꼴', 모양: '' },
  'command.format.toggleNumbering.toolbarLabel': { 문단: '번호', 번호: '매기기' },
  'ui.tbBullet.toolbarLabel': { 글머리: '글머리', 표: '기호' },
}

/** Context is needed for short labels shared by unrelated dialogs. */
function wordLabel(source: string, element: Element): string {
  if (element.matches('[data-i18n="menu.insert"]')) return source.replace('입력', '삽입')
  if (element.matches('[data-i18n="menu.page"]')) return source.replace(/^쪽$/, '레이아웃')
  if (element.matches('.ps-dialog .dialog-tab[data-tab="basic"]')) return source.replace('기본', '들여쓰기 및 간격')
  if (element.matches('.ps-dialog .dialog-tab[data-tab="extended"]')) return source.replace('확장', '줄 및 페이지 나누기')
  if (element.matches('.cs-dialog .dialog-tab[data-tab="basic"]')) return source.replace('기본', '글꼴')
  if (element.matches('.cs-dialog .dialog-tab[data-tab="extended"]')) return source.replace('확장', '고급')
  if (element.closest('.ps-dialog') && element.matches('legend')) return wordTerminology(source).replace(/^여백$/, '들여쓰기')
  if (element.matches('.dialog-btn-primary')) return source.replace(/^설정(\([A-Z]\))?$/, '확인')
  const splitLabel = element.getAttribute('data-i18n-lines')
  const parts = splitLabel ? WORD_TOOLBAR_PARTS[splitLabel] : undefined
  if (parts && Object.hasOwn(parts, source)) return parts[source]
  return wordTerminology(source)
}

const WORD_DIALOG_CSS = `
  :root[data-dooroo-terminology] .ps-dialog .cs-main-row { min-height: 0; }
  :root[data-dooroo-terminology] .ps-dialog .cs-left-col {
    display: flex; flex-direction: column; min-height: 0;
  }
  :root[data-dooroo-terminology] .ps-dialog .dialog-body {
    min-height: 0; overflow-y: auto;
  }
  :root[data-dooroo-terminology="word"] .ps-dialog {
    width: min(640px, calc(100vw - 32px));
  }
  :root[data-dooroo-terminology="word"] .ps-dialog .dialog-tabs { flex-wrap: wrap; }
  :root[data-dooroo-terminology="word"] .ps-dialog .dialog-checkbox {
    white-space: normal; overflow-wrap: anywhere;
  }
`

/**
 * Adapt only studio chrome, retaining each original string so HWP can be restored
 * without guessing a reverse translation. Upstream can rebuild labels at any time.
 * Input values, document canvases and editable previews are never traversed.
 */
export function installTerminology(doc: Document, initial: TerminologyStyle = 'word') {
  let style = initial
  const previousStyle = doc.documentElement.getAttribute('data-dooroo-terminology')
  const stylesheet = doc.createElement('style')
  stylesheet.textContent = WORD_DIALOG_CSS
  doc.head.appendChild(stylesheet)
  doc.documentElement.setAttribute('data-dooroo-terminology', style)
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
        // Implicit values and names used as values (e.g. dialog font lists) are
        // data, rather than vocabulary. Preserve both their label and argument.
        const namedValue = element.matches('option') && (!element.hasAttribute('value') || element.getAttribute('value') === element.textContent)
        if (!namedValue) translate(node, 'text', node.nodeValue ?? '', (value) => { node.nodeValue = value }, (source) => wordLabel(source, element))
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
      doc.documentElement.setAttribute('data-dooroo-terminology', style)
      observer.disconnect()
      visit(doc.body)
      observe()
    },
    dispose() {
      observer.disconnect()
      style = 'hwp'
      visit(doc.body)
      stylesheet.remove()
      if (previousStyle === null) doc.documentElement.removeAttribute('data-dooroo-terminology')
      else doc.documentElement.setAttribute('data-dooroo-terminology', previousStyle)
    },
  }
}
