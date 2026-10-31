# Chojema Dooroo

HWP와 HWPX 문서를 작성하고 편집하는 데스크톱 워드 프로세서입니다.

## 주요 기능

- **한글 문서 편집**: HWP와 HWPX 문서를 열고 편집하며, 새 문서는 HWPX를 기본 형식으로 저장합니다.
- **형식 유지**: 기존 HWP 파일은 일반 저장 시 HWP 형식을 유지하며, 다른 이름으로 저장을 통해 HWPX로 변환할 수 있습니다.
- **작업 공간**: 문서별 탭, 두 문서 나란히 보기, 현재 탭을 별도 창으로 분리하는 기능을 제공합니다.
- **인쇄 및 내보내기**: 문서 인쇄와 PDF 내보내기, 페이지별 PNG·JPG 그림 내보내기를 지원합니다. 내보낼 때 문서 전체, 현재 페이지, 페이지 범위를 고를 수 있습니다.
- **PDF 가져오기**: PDF의 텍스트를 편집할 수 있는 새 HWPX 문서로 가져옵니다. 문단, 글자 크기, 페이지 나눔을 따르며 그림·표·도형과 스캔한 페이지는 가져오지 않습니다.
- **문서 도우미**: 편집기 내에서 선택적으로 AI 문서 도우미를 연결해 사용할 수 있습니다. 사용자가 요청하기 전에는 문서 내용을 외부로 전송하지 않습니다.

## 설치

[GitHub Releases](https://github.com/chojema/ChojemaDooroo/releases)에서 최신 Windows x64 설치 파일(`ChojemaDooroo-Setup-<버전>-x64.exe`) 또는 macOS Apple Silicon용 DMG(`ChojemaDooroo-<버전>-arm64.dmg`)를 내려받아 실행합니다. macOS 앱은 Developer ID 서명과 공증 없이 ad-hoc 서명만 되어 있으므로, 처음 실행할 때 Finder에서 앱을 Control-클릭한 뒤 `열기`를 선택하세요.

설치 파일에는 코드 서명이 포함되어 있지 않습니다. 중요한 문서는 복사본으로 호환성을 먼저 확인한 뒤 사용하세요.

Windows 설치본은 실행 후 주기적으로 새 버전을 확인하며, 새 버전이 있으면 다운로드 후 설정 화면에서 설치할 수 있습니다. macOS는 자동 업데이트를 지원하지 않으므로 새 버전을 직접 내려받아 설치합니다.

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
