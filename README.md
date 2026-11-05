# Chojema Dooroo

HWP와 HWPX 문서를 작성하고 편집하는 데스크톱 워드 프로세서입니다.

## 주요 기능

- **한글 문서 편집**: HWP와 HWPX 문서를 열고 편집하며, 새 문서는 HWPX를 기본 형식으로 저장합니다.
- **형식 유지**: 기존 HWP 파일은 일반 저장 시 HWP 형식을 유지하며, 다른 이름으로 저장을 통해 HWPX로 변환할 수 있습니다.
- **작업 공간**: 문서별 탭, 두 문서 나란히 보기, 현재 탭을 별도 창으로 분리하는 기능을 제공합니다.
- **인쇄 및 내보내기**: 문서 인쇄와 PDF 내보내기, 페이지별 PNG·JPG 그림 내보내기를 지원합니다. 내보낼 때 문서 전체, 현재 페이지, 페이지 범위를 고를 수 있습니다. 인쇄 전에는 미리보기로 확인합니다.
- **문서 점검**: 행정안전부 행정문서 작성 가이드라인 기준으로 AI 없이 문서를 검사합니다.
- **PDF 가져오기**: PDF의 텍스트를 편집할 수 있는 새 HWPX 문서로 가져옵니다. 문단, 글자 크기, 페이지 나눔을 따르며 그림·표·도형과 스캔한 페이지는 가져오지 않습니다.
- **문서 도우미**: 편집기 내에서 선택적으로 AI 문서 도우미를 연결해 사용할 수 있습니다. 사용자가 요청하기 전에는 문서 내용을 외부로 전송하지 않습니다.

## 설치

[GitHub Releases](https://github.com/chojema/ChojemaDooroo/releases)에서 최신 Windows x64 설치 파일(`ChojemaDooroo-Setup-<버전>-x64.exe`) 또는 macOS Apple Silicon용 DMG(`ChojemaDooroo-<버전>-arm64.dmg`)를 내려받아 실행합니다. macOS 앱은 Developer ID 서명과 공증 없이 ad-hoc 서명만 되어 있으므로, 처음 실행할 때 Finder에서 앱을 Control-클릭한 뒤 `열기`를 선택하세요.

설치 파일에는 코드 서명이 포함되어 있지 않습니다. 중요한 문서는 복사본으로 호환성을 먼저 확인한 뒤 사용하세요.

Windows 설치본은 실행 후 주기적으로 새 버전을 확인하며, 새 버전이 있으면 다운로드 후 설정 화면에서 설치할 수 있습니다. macOS는 자동 업데이트를 지원하지 않으므로 새 버전을 직접 내려받아 설치합니다.

## 글꼴

두루는 macOS와 Windows의 표준 글꼴 폴더에 있는 글꼴만 실제로 사용합니다. 시스템 공용 폴더와 운영체제의 표준 사용자 글꼴 폴더가 여기에 해당합니다. 이 기준은 편집 화면, 인쇄 미리보기, 인쇄와 PDF 및 그림 내보내기에 동일하게 적용합니다.

사용할 수 없는 글꼴은 대체하여 표시하므로 글자 모양, 줄바꿈과 페이지 구성이 달라질 수 있습니다. 사용자가 글꼴을 직접 변경하지 않는 한 원본 글꼴 이름은 저장할 때 유지됩니다. 문서를 열 때 대체 표시 알림을 보여 주며, 알림이 사라진 뒤에도 상단의 `대체 글꼴 안내`에서 전체 목록과 정책을 확인할 수 있습니다.

별도로 설치한 글꼴은 해당 사용권을 확인해 주세요. 표준 폴더에 설치되어 있다는 사실만으로 사용이 허용되는 것은 아닙니다. [Microsoft 글꼴 사용권 안내](https://learn.microsoft.com/en-us/typography/fonts/font-faq)

## MCP로 사용

0.7.0부터 외부 MCP 클라이언트에서 문서 열기, 읽기, 텍스트와 표 편집, HWP/HWPX 저장을 호출할 수 있으며, 0.10.0부터는 설정 파일을 직접 수정하지 않고 **AI 도우미와 대화하거나 설정 버튼 한 번으로 자동 연결**할 수 있습니다.

### 1. 외부 AI 앱에 Chojema Dooroo 자동 등록
- **AI 대화로 등록**: 편집기 오른쪽의 **AI 도우미** 대화창에서 다음과 같이 말합니다.
  - *"초제마 두루 MCP 연결해 줘"*
  - *"Claude Desktop이랑 Cursor에 MCP 등록해 줘"*
  - *"D:/Work 폴더를 허용해서 읽기 전용으로 MCP 등록해 줘"*
- **설정 화면에서 등록**: **도구 > 환경 설정 > MCP > 외부 AI에 자동 등록** 버튼을 누릅니다.
- Claude Desktop, Claude Code, Cursor, Windsurf, Antigravity의 설정 파일에 현재 설치된 앱 경로와 앱 내부에 기본 내장된 `mcp.mjs`, 기본 `Documents` 폴더(또는 지정한 폴더)가 자동으로 기록됩니다. 등록 후 해당 외부 AI 앱을 재시작(또는 MCP 새로고침)하면 바로 HWP/HWPX 도구를 사용할 수 있습니다.

### 2. 초제마 두루 AI 도우미에 외부 MCP 서버 연결
- 편집기의 **AI 도우미** 대화창에서 외부 MCP 서버를 연결해 달라고 말하면 앱이 직접 그 서버를 실행·연결하고 도구를 가져옵니다.
  - *"memory MCP 서버 연결해 줘"*
  - *"filesystem MCP를 /Users/사용자/Documents 경로로 추가해 줘"*
- 연결된 외부 MCP 서버의 도구들은 대화 중 즉시 호출할 수 있으며, 설정은 앱 데이터 폴더(`mcp-servers.json`)에 유지됩니다.

수동 설정 예제와 전체 도구 목록은 [MCP 연결 안내](docs/mcp.md)를 참고하세요.

## 소스에서 빌드 및 실행

Node.js 24 LTS, npm 10 이상, Git이 필요합니다. 저장소에 포함된 `rhwp` WebAssembly 바이너리를 사용하므로 일반 빌드에는 Rust가 필요하지 않습니다.

```sh
git clone https://github.com/chojema/ChojemaDooroo.git
cd ChojemaDooroo
npm ci
npm run dev
```

검사 및 패키징 명령:

```sh
npm run typecheck
npm test
npm run test:smoke
npm run dist:win
```

빌드된 설치 파일은 `apps/desktop/release` 폴더에 생성됩니다. macOS에서 빌드할 때는 `npm run dist:mac`을 사용합니다.

## 라이선스와 출처

[IeumOffice](https://github.com/pblsketch/openoffice)의 소스 중 HWP 편집기 및 공용 라이브러리를 바탕으로 만들었습니다. 해당 소스는 [GenOffice](https://github.com/genspark-ai/genoffice)에 기반하며 Apache-2.0 라이선스입니다. HWP/HWPX 엔진과 편집기는 [rhwp](https://github.com/edwardkim/rhwp)의 MIT 라이선스 코드를 사용합니다.

[LICENSE](LICENSE), [NOTICE](NOTICE) 및 포함된 구성요소의 라이선스 고지를 유지합니다. 자세한 구조와 변경 범위는 [개발 안내](docs/development.md)와 [출처 기록](docs/upstream.md)을 참고하세요.

본 제품은 한글과컴퓨터의 한글 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.
