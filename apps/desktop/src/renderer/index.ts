import './style.css'
import type { AppState } from '../shared/contracts'

declare global {
  interface Window {
    chojema: {
      command(action: string, value?: unknown): Promise<unknown>
      onState(handler: (state: AppState) => void): () => void
      pathForFile(file: File): string
    }
  }
}
const content = document.querySelector<HTMLElement>('#content')!
const tabs = document.querySelector<HTMLElement>('#tabs')!
const message = document.querySelector<HTMLElement>('#message')!
const escape = (value: string) => value.replace(/[&<>"']/g, (s) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[s]!)
let current: AppState
let renderedPage = ''

async function command(action: string, value?: unknown) {
  try {
    const result = await window.chojema.command(action, value)
    if (result && typeof result === 'object' && 'error' in result) throw new Error(String(result.error))
    return result
  } catch (error) {
    message.textContent = error instanceof Error ? error.message : String(error)
    setTimeout(() => { message.textContent = '' }, 8000)
  }
}

function render(state: AppState) {
  current = state
  document.documentElement.dataset.theme = state.theme
  tabs.innerHTML = state.tabs.map((tab) => `<div class="tab ${tab.active ? 'active' : ''} ${tab.secondary ? 'secondary' : ''}"><button role="tab" aria-selected="${tab.active}" data-action="activate" data-value="${escape(tab.id)}" title="${escape(tab.path ?? tab.title)}"><span class="format ${tab.kind}">H</span>${escape(tab.title)}</button><button class="close" aria-label="${escape(tab.title)} 닫기" data-action="close" data-value="${escape(tab.id)}">×</button></div>`).join('')
  if (state.page === 'editor') {
    content.innerHTML = ''
    renderedPage = 'editor'
    return
  }
  if (state.page === 'home') {
    renderedPage = 'home'
    content.innerHTML = `<section class="home"><div class="eyebrow">CHOJEMA DOOROO</div><h1>문서에 집중하는 작업 공간</h1><p class="lead">HWP와 HWPX 문서를 작성하고, 나란히 살펴보세요.</p><div class="cards"><button class="card" data-action="new-hwp"><span class="file-mark hwp">H</span><strong>새 문서</strong><span>빈 문서에서 새로 시작</span><small>기본 저장 형식 HWPX</small></button><button class="card" data-action="open"><span class="file-mark hwp">H</span><strong>파일 열기</strong><span>저장된 문서 불러오기</span><small>HWP, HWPX 파일 지원</small></button></div><div class="recent-heading"><h2>최근 문서</h2></div><div class="recent">${state.recent.length ? state.recent.map((path) => `<button class="recent-file" data-action="open-path" data-value="${escape(path)}"><span>${escape(path.split(/[\\/]/).pop()!)}</span><small>${escape(path)}</small></button>`).join('') : '<div class="empty">최근에 연 문서가 없습니다.<br>HWP, HWPX 파일을 이 창으로 끌어 놓아도 열 수 있습니다.</div>'}</div><footer><span>Chojema Dooroo ${escape(state.version)}</span><button data-action="settings">설정</button></footer></section>`
  } else if (renderedPage !== 'settings') {
    renderedPage = 'settings'
    content.innerHTML = `<section class="settings"><button class="back" data-action="home">← 홈</button><div class="eyebrow">PREFERENCES</div><h1>설정</h1><div class="setting"><div><h2>인터페이스 용어</h2><p>Word: 단락·페이지·글꼴 / HWP: 문단·쪽·글자 모양<br>선택한 용어는 모든 편집기에 바로 적용됩니다. 문서 내용과 단축키는 유지됩니다.</p></div><select id="terminology" aria-label="인터페이스 용어"><option value="word">Word 스타일 (기본값)</option><option value="hwp">HWP 스타일</option></select></div><div class="setting"><div><h2>화면 테마</h2><p>문서의 인쇄 색에는 영향을 주지 않습니다.</p></div><select id="theme" aria-label="화면 테마"><option value="system">시스템 설정</option><option value="light">밝게</option><option value="dark">어둡게</option></select></div><div class="setting"><div><h2>문서 도우미</h2><p>연결된 제공업체는 문서 편집기 안에서 선택합니다.</p></div><button data-action="ai-toggle">도우미 표시 전환</button></div><form id="assistant-form"><h2>도우미 연결</h2><p class="muted">구독 연결은 편집기 도우미의 모델 선택에서 설정합니다. API 키를 쓰는 경우에만 입력하세요.</p><label>제공업체<select id="provider"><option value="auto">자동 선택</option><option value="codex">Codex</option><option value="claude-code">Claude Code</option><option value="chatgpt">ChatGPT</option><option value="openai">OpenAI API</option></select></label><label>모델<input id="model" autocomplete="off" placeholder="기본 모델 사용" /></label><label>API 키<input id="api-key" type="password" autocomplete="off" placeholder="비워 두면 저장된 키 유지" /></label><label>API 주소<input id="base-url" type="url" placeholder="기본 주소 사용" /></label><button type="submit">연결 설정 저장</button><span id="assistant-result" role="status"></span></form><div class="setting"><div><h2>업데이트</h2><p id="update-status">${escape(state.update)}</p></div><button data-action="check-update">업데이트 확인</button><button data-action="install-update">다운로드한 업데이트 설치</button><button data-action="releases">배포 페이지</button></div><div class="setting"><div><h2>Chojema Dooroo ${escape(state.version)}</h2><p>버전 및 오픈소스 라이선스 정보</p></div><button data-action="about">라이선스와 출처</button></div><p class="muted">새 문서는 HWPX로 저장합니다. 기존 HWP 문서는 저장 형식을 유지합니다.</p></section>`
    const terminology = document.querySelector<HTMLSelectElement>('#terminology')!
    terminology.onchange = () => void command('terminology', terminology.value)
    const theme = document.querySelector<HTMLSelectElement>('#theme')!
    theme.value = state.theme
    theme.onchange = () => void command('theme', theme.value)
    const form = document.querySelector<HTMLFormElement>('#assistant-form')!
    const provider = document.querySelector<HTMLSelectElement>('#provider')!
    const model = document.querySelector<HTMLInputElement>('#model')!
    const key = document.querySelector<HTMLInputElement>('#api-key')!
    const base = document.querySelector<HTMLInputElement>('#base-url')!
    void command('assistant-get').then((raw) => {
      const setup = raw as { provider: string; model: string; baseUrl: string }
      if (setup && form.isConnected) { provider.value = setup.provider; model.value = setup.model; base.value = setup.baseUrl }
    })
    form.onsubmit = (event) => {
      event.preventDefault()
      void command('assistant-save', { provider: provider.value, model: model.value, apiKey: key.value, baseUrl: base.value }).then((result) => {
        if (result) { key.value = ''; document.querySelector('#assistant-result')!.textContent = '저장했습니다.' }
      })
    }
  }
  const terminology = document.querySelector<HTMLSelectElement>('#terminology')
  if (terminology) terminology.value = state.terminology
  const status = document.querySelector('#update-status')
  if (status) status.textContent = state.update
}
document.addEventListener('click', (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>('[data-action]')
  if (!button || button.disabled) return
  void command(button.dataset.action!, button.dataset.value)
})
document.addEventListener('dragover', (event) => { event.preventDefault() })
document.addEventListener('drop', (event) => {
  event.preventDefault()
  for (const file of Array.from(event.dataTransfer?.files ?? [])) void command('open-path', window.chojema.pathForFile(file))
})
window.chojema.onState(render)
void command('state').then((state) => { if (state) render(state as AppState) })
