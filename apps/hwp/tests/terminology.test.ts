// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { installTerminology, wordTerminology } from '../src/renderer/terminology'

let adapter: ReturnType<typeof installTerminology> | undefined
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
afterEach(() => { adapter?.dispose(); document.body.innerHTML = '' })

describe('interface terminology', () => {
  it('translates UI vocabulary while preserving directions and English', () => {
    expect(wordTerminology('문단 모양 / 글자 모양 / 쪽 번호 / 1/2쪽 / 단쪽 보기')).toBe('단락 / 글꼴 / 페이지 번호 / 1/2페이지 / 한 페이지 보기')
    expect(wordTerminology('머리말 꼬리말 조판 부호 편집 용지 찾아 바꾸기')).toBe('머리글 바닥글 서식 기호 페이지 설정 찾기 및 바꾸기')
    expect(wordTerminology('왼쪽 오른쪽 양쪽 안쪽 바깥쪽 위쪽 아래쪽 Page Paragraph')).toBe('왼쪽 오른쪽 양쪽 안쪽 바깥쪽 위쪽 아래쪽 Page Paragraph')
  })

  it('translates templates before inserting quoted document text', () => {
    const template = wordTerminology('문단 지움 · {text}')
    expect(template.replace('{text}', '문단과 쪽')).toBe('단락 지움 · 문단과 쪽')
    expect(wordTerminology('{page}쪽')).toBe('{page}페이지')
    expect(wordTerminology('쪽을 준비하는 중…')).toBe('페이지를 준비하는 중…')
  })

  it('names pagination options by their behavior rather than just replacing 문단', () => {
    expect(wordTerminology('외톨이줄 보호(K)')).toBe('단락의 첫 줄이나 마지막 줄 분리 방지(K)')
    expect(wordTerminology('다음 문단과 함께(N)')).toBe('다음 단락과의 사이에 페이지 나누지 않음(N)')
    expect(wordTerminology('문단 보호(P)')).toBe('현재 단락을 나누지 않음(P)')
    expect(wordTerminology('문단 앞에서 항상 쪽 나눔(E)')).toBe('단락 앞에서 페이지 나누기(E)')
    expect(wordTerminology('문단 위(U): / 문단 아래(V):')).toBe('단락 앞(U): / 단락 뒤(V):')
  })

  it('covers editing, character, numbering and object layout vocabulary', () => {
    expect(wordTerminology('되돌리기 / 오려 두기 / 복사하기 / 붙이기 / 골라 붙이기 / 모양 복사')).toBe('실행 취소 / 잘라내기 / 복사 / 붙여넣기 / 선택하여 붙여넣기 / 서식 복사')
    expect(wordTerminology('장평(W): 자간(P): 글자 색(C): 글자 크기')).toBe('문자 배율(W): 문자 간격(P): 글꼴 색(C): 글꼴 크기')
    expect(wordTerminology('문단 번호 모양 / 글머리표 / 글상자 / 문자표')).toBe('번호 매기기 / 글머리 기호 / 텍스트 상자 / 기호')
    expect(wordTerminology('글자처럼 취급 / 어울림 / 자리 차지 / 글 뒤로 / 글 앞으로')).toBe('텍스트 줄 안 / 정사각형 / 위/아래 / 텍스트 뒤로 / 텍스트 앞으로')
    expect(wordTerminology('나눔 정렬 / 여백만 지정')).toBe('나눔 정렬 / 여백만 지정')
  })

  it('defaults to Word, restores exact originals, and never changes user content', () => {
    document.body.innerHTML = `<header id="studio-header"><button title="문단 모양">문단 모양</button><div id="recent-docs-panel">문단.hwpx</div></header><div class="dialog-wrap"><label>머리말</label><input value="쪽 문단"><textarea>쪽 문단</textarea><div contenteditable="true">쪽 문단</div><div class="dialog-preview">쪽 문단</div></div><main>쪽 문단</main>`
    adapter = installTerminology(document)
    const button = document.querySelector('button')!
    expect(button.textContent).toBe('단락')
    expect(button.title).toBe('단락')
    expect(document.querySelector('input')!.value).toBe('쪽 문단')
    for (const selector of ['textarea', '[contenteditable]', '.dialog-preview', 'main']) expect(document.querySelector(selector)!.textContent).toBe('쪽 문단')
    expect(document.querySelector('#recent-docs-panel')!.textContent).toBe('문단.hwpx')
    adapter.setStyle('hwp')
    expect(button.textContent).toBe('문단 모양')
    expect(button.title).toBe('문단 모양')
    adapter.setStyle('word')
    expect(button.textContent).toBe('단락')
  })

  it('restores source labels on cleanup so remounting can still select HWP', () => {
    document.body.innerHTML = '<header id="studio-header"><button>문단 모양</button></header>'
    adapter = installTerminology(document)
    adapter.dispose()
    expect(document.documentElement.hasAttribute('data-dooroo-terminology')).toBe(false)
    adapter = installTerminology(document, 'hwp')
    expect(document.querySelector('button')!.textContent).toBe('문단 모양')
  })

  it('uses context for menus and tabs and restores HWP without changing IDs or control state', () => {
    document.body.innerHTML = `<header id="studio-header"><span data-i18n="menu.insert">입력</span><span data-i18n="menu.page">쪽</span><input title="글자 크기" value="10"></header><div class="dialog-wrap ps-dialog"><button class="dialog-tab" data-tab="basic">기본</button><button class="dialog-tab" data-tab="extended">확장</button><legend>여백</legend><label><input type="checkbox" checked>외톨이줄 보호(K)</label><button class="dialog-btn-primary">설정(D)</button></div><div class="dialog-wrap cs-dialog"><button class="dialog-tab" data-tab="extended">확장</button></div>`
    adapter = installTerminology(document)
    expect(document.querySelector('[data-i18n="menu.insert"]')!.textContent).toBe('삽입')
    expect(document.querySelector('[data-i18n="menu.page"]')!.textContent).toBe('레이아웃')
    expect(document.querySelector('.ps-dialog [data-tab="basic"]')!.textContent).toBe('들여쓰기 및 간격')
    expect(document.querySelector('.ps-dialog [data-tab="extended"]')!.textContent).toBe('줄 및 페이지 나누기')
    expect(document.querySelector('.cs-dialog [data-tab="extended"]')!.textContent).toBe('고급')
    expect(document.querySelector('legend')!.textContent).toBe('들여쓰기')
    expect(document.querySelector('.dialog-btn-primary')!.textContent).toBe('확인')
    expect(document.querySelector('input')!.title).toBe('글꼴 크기')
    const checkbox = document.querySelector<HTMLInputElement>('[type="checkbox"]')!
    adapter.setStyle('hwp')
    expect(document.querySelector('[data-i18n="menu.page"]')!.textContent).toBe('쪽')
    expect(document.querySelector('.ps-dialog [data-tab="extended"]')!.textContent).toBe('확장')
    expect(document.querySelector('label')!.textContent).toBe('외톨이줄 보호(K)')
    expect(document.querySelector('.dialog-btn-primary')!.textContent).toBe('설정(D)')
    expect(checkbox.checked).toBe(true)
    expect(document.querySelector('input')!.value).toBe('10')
  })

  it('preserves user style/font/bookmark names and implicit option values', () => {
    document.body.innerHTML = `<header id="studio-header"><select id="style-name"><option value="1">외톨이줄 보호 문단</option></select><select id="font-name"><option value="font">글상자 글꼴</option></select></header><div class="dialog-wrap"><span class="sd-style-name">문단 모양</span><span class="sd-cur-style-name">글자 모양</span><div class="bm-list">쪽 번호</div><select id="implicit"><option>문단 모양</option></select><select id="explicit"><option value="inline">글자처럼 취급</option></select></div>`
    adapter = installTerminology(document)
    expect(document.querySelector('#style-name option')!.textContent).toBe('외톨이줄 보호 문단')
    expect(document.querySelector('#font-name option')!.textContent).toBe('글상자 글꼴')
    expect(document.querySelector('.sd-style-name')!.textContent).toBe('문단 모양')
    expect(document.querySelector('.sd-cur-style-name')!.textContent).toBe('글자 모양')
    expect(document.querySelector('.bm-list')!.textContent).toBe('쪽 번호')
    expect(document.querySelector<HTMLSelectElement>('#implicit')!.value).toBe('문단 모양')
    expect(document.querySelector('#explicit option')!.textContent).toBe('텍스트 줄 안')
    expect(document.querySelector<HTMLSelectElement>('#explicit')!.value).toBe('inline')
    document.querySelector('.dialog-wrap')!.insertAdjacentHTML('beforeend', '<select id="dialog-font"><option value="문단 모양 글꼴">문단 모양 글꼴</option></select>')
    adapter.setStyle('word')
    expect(document.querySelector('#dialog-font option')!.textContent).toBe('문단 모양 글꼴')
  })

  it('adapts split toolbar labels and late input attributes', async () => {
    document.body.innerHTML = `<header id="studio-header"><button data-i18n-lines="command.edit.formatCopy.toolbarLabel">모양<br>복사</button><input value="문단 모양" aria-label="찾아 바꾸기"></header>`
    adapter = installTerminology(document)
    expect(document.querySelector('button')!.innerHTML).toBe('서식<br>복사')
    const input = document.querySelector('input')!
    input.setAttribute('placeholder', '문단 모양')
    await settle()
    expect(input.placeholder).toBe('단락')
    expect(input.getAttribute('aria-label')).toBe('찾기 및 바꾸기')
    expect(input.value).toBe('문단 모양')
    adapter.setStyle('hwp')
    expect(input.placeholder).toBe('문단 모양')
    expect(document.querySelector('button')!.innerHTML).toBe('모양<br>복사')
  })

  it('translates fragmented toolbar captions without changing unrelated fragments', () => {
    document.body.innerHTML = `<header id="studio-header"><span data-i18n-lines="ui.iconToolbarViewport.toolbarLabel.x05c63e">오려<br>두기</span><span data-i18n-lines="ui.iconToolbarViewport.toolbarLabel.x06e1ec">복사<br>하기</span><span data-i18n-lines="command.view.ctrlMark.toolbarLabel">조판<br>부호</span><span data-i18n-lines="command.format.toggleNumbering.toolbarLabel">문단<br>번호</span><span data-i18n-lines="ui.tbBullet.toolbarLabel">글머리<br>표</span><span>표 모양</span></header>`
    adapter = installTerminology(document)
    expect(Array.from(document.querySelectorAll('span'), (span) => span.innerHTML)).toEqual(['잘라<br>내기', '복사<br>', '서식<br>기호', '번호<br>매기기', '글머리<br>기호', '표 모양'])
    adapter.setStyle('hwp')
    expect(Array.from(document.querySelectorAll('span'), (span) => span.innerHTML)).toEqual(['오려<br>두기', '복사<br>하기', '조판<br>부호', '문단<br>번호', '글머리<br>표', '표 모양'])
  })

  it('handles dialogs opened later and repeated status updates without stale restoration', async () => {
    document.body.innerHTML = '<footer id="status-bar"><span>1/2쪽</span></footer>'
    adapter = installTerminology(document)
    const status = document.querySelector('span')!
    status.firstChild!.nodeValue = '2/3쪽'
    document.body.insertAdjacentHTML('beforeend', '<div class="dialog-wrap"><h2>문단 모양</h2></div>')
    await settle()
    expect(status.textContent).toBe('2/3페이지')
    expect(document.querySelector('h2')!.textContent).toBe('단락')
    adapter.setStyle('hwp')
    expect(status.textContent).toBe('2/3쪽')
    expect(document.querySelector('h2')!.textContent).toBe('문단 모양')
  })
})
