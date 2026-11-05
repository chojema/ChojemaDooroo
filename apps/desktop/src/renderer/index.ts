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
let settingsTab = 'general'

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
    content.innerHTML = `<section class="home"><div class="eyebrow">CHOJEMA DOOROO</div><h1>문서에 집중하는 작업 공간</h1><p class="lead">HWP와 HWPX 문서를 작성하고, 나란히 살펴보세요.</p><div class="cards"><button class="card" data-action="new-hwp"><span class="file-mark hwp">H</span><strong>새 문서</strong><span>빈 문서에서 새로 시작</span><small>기본 저장 형식 HWPX</small></button><button class="card" data-action="open"><span class="file-mark hwp">H</span><strong>파일 열기</strong><span>저장된 문서 불러오기</span><small>HWP, HWPX 파일 지원</small></button></div><div class="recent-heading"><h2>최근 문서</h2></div><div class="recent">${state.recent.length ? state.recent.map((path) => `<button class="recent-file" data-action="open-path" data-value="${escape(path)}"><span>${escape(path.split(/[\\/]/).pop()!)}</span><small>${escape(path)}</small></button>`).join('') : '<div class="empty">최근에 연 문서가 없습니다.<br>HWP, HWPX 파일을 이 창으로 끌어 놓아도 열 수 있습니다.</div>'}</div><footer><span>Chojema Dooroo ${escape(state.version)}</span><button data-action="settings">환경 설정</button></footer></section>`
  } else if (renderedPage !== 'settings') {
    renderedPage = 'settings'
    const hasDocument = state.tabs.length > 0
    const docHint = '<p class="hint">문서를 연 상태에서 사용할 수 있습니다.</p>'
    const panes: Array<[string, string, string]> = [
      ['general', '일반', `<div class="setting"><div><h2>인터페이스 용어</h2><p>Word: 단락·페이지·글꼴 / HWP: 문단·쪽·글자 모양<br>선택한 용어는 모든 편집기에 바로 적용됩니다. 문서 내용과 단축키는 유지됩니다.</p></div><select id="terminology" aria-label="인터페이스 용어"><option value="word">Word 스타일 (기본값)</option><option value="hwp">HWP 스타일</option></select></div><div class="setting"><div><h2>화면 테마</h2><p>문서의 인쇄 색에는 영향을 주지 않습니다.</p></div><select id="theme" aria-label="화면 테마"><option value="system">시스템 설정</option><option value="light">밝게</option><option value="dark">어둡게</option></select></div>`],
      ['file', '파일', `<div class="setting"><div><h2>복구용 자동 저장</h2><p>저장하지 않은 변경이 있을 때 복구 사본을 만듭니다. 대형 문서는 복구 사본을 만드는 동안 잠시 멈출 수 있으니 간격을 길게 두면 좋습니다.</p></div><label class="inline"><input type="checkbox" id="opt-recovery" /> 사용</label><label class="inline"><input type="number" id="opt-recovery-min" min="1" max="120" /> 분마다</label></div><div class="setting"><div><h2>쉴 때 자동 저장</h2><p>입력이 멈추면 복구 사본을 한 번 더 만듭니다.</p></div><label class="inline"><input type="checkbox" id="opt-idle" /> 사용</label><label class="inline"><input type="number" id="opt-idle-sec" min="5" max="600" /> 초 뒤</label></div><div class="setting"><div><h2>PDF 저장</h2><p>안내를 끄면 PDF로 저장을 선택하는 즉시 문서 준비가 시작됩니다. 진행률과 오류는 계속 표시됩니다.</p></div><label class="inline"><input type="checkbox" id="opt-pdf-guide" /> 저장 방법 안내 표시</label></div><p class="muted">새 문서는 HWPX로 저장합니다. 기존 HWP 문서는 저장 형식을 유지합니다.</p>`],
      ['font', '글꼴', `<div class="setting"><div><h2>사용하는 글꼴</h2><p>macOS와 Windows의 표준 글꼴 폴더(시스템 공용 폴더와 사용자 글꼴 폴더)에 설치된 글꼴을 자동으로 사용합니다. 따로 감지하거나 등록할 필요가 없습니다. 별도로 설치한 글꼴은 해당 사용권을 확인해 주세요.</p></div></div><div class="setting"><div><h2>대체 글꼴 안내</h2><p>문서에 쓰인 글꼴이 PC에 없으면 비슷한 글꼴로 대신 보여 주며, 원본 글꼴 이름은 그대로 저장합니다. 현재 문서에서 대체된 글꼴 목록을 볼 수 있습니다.</p>${docHint}</div><button data-action="editor-panel" data-value="font-details" ${hasDocument ? '' : 'disabled'}>현재 문서의 대체 글꼴 보기</button></div><div class="setting"><div><h2>최근 사용 글꼴</h2><p>글꼴 목록 위쪽에 최근에 사용한 글꼴을 보여 줍니다.</p></div><label class="inline"><input type="checkbox" id="opt-recent" /> 보이기</label><label class="inline"><input type="number" id="opt-recent-count" min="1" max="5" /> 개</label></div><div class="setting"><div><h2>대표 글꼴</h2><p>한글, 영문, 한자 등 언어별 글꼴을 짝지어 한 번에 적용하는 글꼴 세트입니다.</p>${docHint}</div><button data-action="editor-panel" data-value="font-sets" ${hasDocument ? '' : 'disabled'}>대표 글꼴 등록</button></div>`],
      ['assistant', 'AI 도우미', `<div class="setting"><div><h2>문서 도우미</h2><p>연결된 제공업체는 문서 편집기 안에서 선택합니다.</p></div><button data-action="ai-toggle">도우미 표시 전환</button></div><form id="assistant-form"><h2>도우미 연결</h2><p class="muted">구독 연결은 편집기 도우미의 모델 선택에서 설정합니다. API 키를 쓰는 경우에만 입력하세요.</p><label>제공업체<select id="provider"><option value="auto">자동 선택</option><option value="codex">Codex</option><option value="claude-code">Claude Code</option><option value="chatgpt">ChatGPT</option><option value="openai">OpenAI API</option><option value="ollama">Ollama (이 PC에서 실행)</option></select></label><label class="cloud-field">모델<input id="model" autocomplete="off" placeholder="기본 모델 사용" /></label><label class="cloud-field">API 키<input id="api-key" type="password" autocomplete="off" placeholder="비워 두면 저장된 키 유지" /></label><label class="cloud-field">API 주소<input id="base-url" type="url" placeholder="기본 주소 사용" /></label><div id="ollama-box" hidden><div class="ollama-row"><label>Ollama 모델<select id="ollama-model" aria-label="Ollama 모델"></select></label><button type="button" id="ollama-refresh">다시 확인</button></div><p id="ollama-status" role="status"></p><p class="ollama-note">문서 내용이 이 PC 밖으로 나가지 않습니다. 응답 속도와 정확도는 PC 성능과 모델에 따라 다릅니다. 두루는 Ollama를 설치하거나 모델을 내려받지 않습니다. 자동 선택에는 포함되지 않습니다.</p></div><button type="submit">연결 설정 저장</button><span id="assistant-result" role="status"></span></form>`],
      ['mcp', 'MCP', `<div class="setting"><div><h2>MCP 자동 등록</h2><p id="mcp-summary">AI 도우미 대화창에서 "MCP 연결해 줘"라고 말해도 자동 등록할 수 있습니다.</p></div><button id="mcp-auto-register" type="button">외부 AI에 자동 등록</button></div>`],
      ['update', '업데이트', `<div class="setting"><div><h2>업데이트</h2><p id="update-status">${escape(state.update)}</p></div><button data-action="check-update">업데이트 확인</button><button data-action="install-update">다운로드한 업데이트 설치</button><button data-action="releases">배포 페이지</button></div><div class="setting"><div><h2>Chojema Dooroo ${escape(state.version)}</h2><p>버전 및 오픈소스 라이선스 정보</p></div><button data-action="about">라이선스와 출처</button></div>`],
    ]
    if (!panes.some(([id]) => id === settingsTab)) settingsTab = 'general'
    content.innerHTML = `<section class="settings"><button class="back" data-action="home">← 홈</button><div class="eyebrow">PREFERENCES</div><h1>환경 설정</h1><div class="pref-tabs" role="tablist">${panes.map(([id, label]) => `<button role="tab" class="pref-tab" data-pref-tab="${id}" aria-selected="${id === settingsTab}">${label}</button>`).join('')}</div>${panes.map(([id, , body]) => `<div class="pref-pane" data-pref-pane="${id}" role="tabpanel" ${id === settingsTab ? '' : 'hidden'}>${body}</div>`).join('')}</section>`
    for (const tab of content.querySelectorAll<HTMLButtonElement>('[data-pref-tab]')) {
      tab.onclick = () => {
        settingsTab = tab.dataset.prefTab!
        for (const t of content.querySelectorAll<HTMLButtonElement>('[data-pref-tab]')) t.setAttribute('aria-selected', String(t === tab))
        for (const pane of content.querySelectorAll<HTMLElement>('[data-pref-pane]')) pane.hidden = pane.dataset.prefPane !== settingsTab
      }
    }
    const optionInputs = {
      recoveryEnabled: document.querySelector<HTMLInputElement>('#opt-recovery')!,
      recoveryIntervalMinutes: document.querySelector<HTMLInputElement>('#opt-recovery-min')!,
      idleSaveEnabled: document.querySelector<HTMLInputElement>('#opt-idle')!,
      idleDelaySeconds: document.querySelector<HTMLInputElement>('#opt-idle-sec')!,
      showPdfPrintGuidance: document.querySelector<HTMLInputElement>('#opt-pdf-guide')!,
      showRecentFonts: document.querySelector<HTMLInputElement>('#opt-recent')!,
      recentFontCount: document.querySelector<HTMLInputElement>('#opt-recent-count')!,
    }
    const showOptions = (options: Record<string, boolean | number>) => {
      for (const [key, input] of Object.entries(optionInputs)) {
        if (input.type === 'checkbox') input.checked = Boolean(options[key])
        else input.value = String(options[key])
      }
      optionInputs.recoveryIntervalMinutes.disabled = !optionInputs.recoveryEnabled.checked
      optionInputs.idleDelaySeconds.disabled = !optionInputs.idleSaveEnabled.checked
      optionInputs.recentFontCount.disabled = !optionInputs.showRecentFonts.checked
    }
    void command('editor-options-get').then((raw) => { if (raw && content.isConnected) showOptions(raw as Record<string, boolean | number>) })
    for (const input of Object.values(optionInputs)) {
      input.onchange = () => {
        const value = Object.fromEntries(Object.entries(optionInputs).map(([key, el]) => [key, el.type === 'checkbox' ? el.checked : Number(el.value)]))
        void command('editor-options-set', value).then(() => command('editor-options-get')).then((raw) => { if (raw) showOptions(raw as Record<string, boolean | number>) })
      }
    }
    const terminology = document.querySelector<HTMLSelectElement>('#terminology')!
    terminology.onchange = () => void command('terminology', terminology.value)
    const theme = document.querySelector<HTMLSelectElement>('#theme')!
    theme.value = state.theme
    theme.onchange = () => void command('theme', theme.value)
    const mcpSummary = document.querySelector<HTMLElement>('#mcp-summary')!
    const mcpBtn = document.querySelector<HTMLButtonElement>('#mcp-auto-register')!
    const refreshMcpStatus = () => {
      void command('mcp-status').then((raw) => {
        if (!raw || !mcpSummary.isConnected) return
        const data = raw as { hosts?: Array<{ label: string; registered: boolean }>; servers?: Array<{ name: string; connected: boolean }> }
        const regHosts = (data.hosts ?? []).filter((h) => h.registered).map((h) => h.label)
        const connServers = (data.servers ?? []).filter((s) => s.connected).map((s) => s.name)
        const parts: string[] = []
        if (regHosts.length) parts.push(`등록된 클라이언트: ${regHosts.join(', ')}`)
        if (connServers.length) parts.push(`연결된 외부 서버: ${connServers.join(', ')}`)
        mcpSummary.textContent = parts.length
          ? `${parts.join(' · ')} (AI 도우미 대화로도 관리 가능)`
          : 'AI 도우미 대화창에서 "MCP 연결해 줘"라고 말하거나 오른쪽 버튼으로 바로 등록할 수 있습니다.'
      })
    }
    refreshMcpStatus()
    mcpBtn.onclick = () => {
      void command('mcp-host-register', {}).then((res) => {
        const out = res as { updated?: Array<{ label: string }> } | undefined
        if (out?.updated?.length) {
          message.textContent = `MCP 자동 등록 완료: ${out.updated.map((u) => u.label).join(', ')}`
          setTimeout(() => { message.textContent = '' }, 6000)
        }
        refreshMcpStatus()
      })
    }
    const form = document.querySelector<HTMLFormElement>('#assistant-form')!
    const provider = document.querySelector<HTMLSelectElement>('#provider')!
    const model = document.querySelector<HTMLInputElement>('#model')!
    const key = document.querySelector<HTMLInputElement>('#api-key')!
    const base = document.querySelector<HTMLInputElement>('#base-url')!
    const ollamaBox = document.querySelector<HTMLElement>('#ollama-box')!
    const ollamaModel = document.querySelector<HTMLSelectElement>('#ollama-model')!
    const ollamaStatus = document.querySelector<HTMLElement>('#ollama-status')!
    let savedOllamaModel = ''
    let ollamaTools = new Map<string, boolean | undefined>()
    const showOllamaWarning = () => {
      const tools = ollamaTools.get(ollamaModel.value)
      ollamaStatus.dataset.warn = String(tools === false)
      if (tools === false) ollamaStatus.textContent = '이 모델은 도구 호출을 지원하지 않아 표 편집, 글꼴 바꾸기 같은 문서 편집 기능이 제한될 수 있습니다.'
      else if (ollamaTools.size) ollamaStatus.textContent = `설치된 모델 ${ollamaTools.size}개를 찾았습니다.`
    }
    const refreshOllama = () => {
      ollamaStatus.dataset.warn = 'false'
      ollamaStatus.textContent = 'Ollama를 확인하는 중…'
      void command('ollama-models').then((raw) => {
        if (!form.isConnected) return
        const listing = raw as { running: boolean; models?: Array<{ id: string; parameterSize?: string; tools?: boolean }> } | undefined
        const wanted = ollamaModel.value || savedOllamaModel
        ollamaTools = new Map((listing?.models ?? []).map((m) => [m.id, m.tools]))
        ollamaModel.innerHTML = (listing?.models ?? []).map((m) => `<option value="${escape(m.id)}">${escape(m.id)}${m.parameterSize ? ` · ${escape(m.parameterSize)}` : ''}${m.tools === false ? ' — 문서 편집 제한' : ''}</option>`).join('')
        ollamaModel.disabled = !ollamaTools.size
        if (wanted && ollamaTools.has(wanted)) ollamaModel.value = wanted
        if (!listing?.running) ollamaStatus.textContent = 'Ollama가 실행 중이 아닙니다. Ollama(ollama.com)를 설치해 실행하고 모델을 받은 뒤 다시 확인을 누르세요.'
        else if (!ollamaTools.size) ollamaStatus.textContent = '설치된 모델이 없습니다. 터미널에서 ollama pull <모델 이름>으로 모델을 받은 뒤 다시 확인을 누르세요.'
        else showOllamaWarning()
      })
    }
    const showProvider = () => {
      const local = provider.value === 'ollama'
      ollamaBox.hidden = !local
      for (const field of form.querySelectorAll<HTMLElement>('.cloud-field')) field.hidden = local
      if (local) refreshOllama()
    }
    provider.onchange = showProvider
    ollamaModel.onchange = showOllamaWarning
    document.querySelector<HTMLButtonElement>('#ollama-refresh')!.onclick = refreshOllama
    void command('assistant-get').then((raw) => {
      const setup = raw as { provider: string; model: string; baseUrl: string }
      if (setup && form.isConnected) {
        provider.value = setup.provider
        if (setup.provider === 'ollama') savedOllamaModel = setup.model
        else { model.value = setup.model; base.value = setup.baseUrl }
        showProvider()
      }
    })
    form.onsubmit = (event) => {
      event.preventDefault()
      const local = provider.value === 'ollama'
      if (local && !ollamaModel.value) { document.querySelector('#assistant-result')!.textContent = 'Ollama 모델을 먼저 받아 주세요.'; return }
      void command('assistant-save', local ? { provider: 'ollama', model: ollamaModel.value } : { provider: provider.value, model: model.value, apiKey: key.value, baseUrl: base.value }).then((result) => {
        if (result) { key.value = ''; document.querySelector('#assistant-result')!.textContent = '저장했습니다.' }
      })
    }
  }
  const terminology = document.querySelector<HTMLSelectElement>('#terminology')
  if (terminology) terminology.value = state.terminology
  const status = document.querySelector('#update-status')
  if (status) status.textContent = state.update
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-action="editor-panel"]')) button.disabled = state.tabs.length === 0
  for (const hint of document.querySelectorAll<HTMLElement>('.settings .hint')) hint.hidden = state.tabs.length > 0
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
