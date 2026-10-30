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
    adapter = installTerminology(document, 'hwp')
    expect(document.querySelector('button')!.textContent).toBe('문단 모양')
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
