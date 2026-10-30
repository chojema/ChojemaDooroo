# Chojema Dooroo

HWP와 HWPX 문서를 한 앱에서 작성하고 편집하는 데스크톱 워드 프로세서입니다.

제작 및 유지관리: **Chojema**

## 문서와 화면

- 한글 문서: HWP와 HWPX를 열고 저장하며, 새 문서는 HWPX를 기본으로 사용합니다.
- 문서별 탭, 두 문서 나란히 보기, 현재 탭을 별도 창으로 이동할 수 있습니다.
- 기존 HWP 파일은 일반 저장 시 형식을 유지합니다. HWPX로 바꾸려면 다른 이름으로 저장합니다.
- 문서 편집기에는 선택적으로 연결할 수 있는 문서 도우미가 있습니다. 사용자의 명시적인 요청 전에는 문서 내용을 제공업체로 보내지 않습니다.
- 엑셀, 슬라이드, PDF 전용 편집기는 포함하지 않습니다. 문서 인쇄와 PDF 내보내기는 편집기의 기능입니다.

## 설치

[GitHub Releases](https://github.com/chojema/ChojemaDooroo/releases)에서 Windows x64 설치 파일 `ChojemaDooroo-Setup-<버전>-x64.exe`(0.1.0-beta.2까지는 `ChojemaDocs-Setup-<버전>-x64.exe`)를 받습니다.

현재 버전은 시험 배포 단계입니다. 설치 파일에는 코드 서명이 없습니다. 문서 호환성을 확인할 때는 원본의 복사본을 사용하세요. 복잡한 서식과 개체가 모든 문서에서 동일하게 보존되는 것을 보증하지 않습니다.

macOS는 별도 요청에 따라 Mac에서 빌드하고 검증합니다. 현재 Mac 배포본이나 실행 검증 완료를 의미하지 않습니다.

## 소스에서 실행

Node.js 24 LTS, npm 10 이상, Git이 필요합니다. 일반 앱 빌드에는 Rust가 필요하지 않습니다. 저장소에 포함된 rhwp WebAssembly를 재사용합니다.

```sh
git clone https://github.com/chojema/ChojemaDooroo.git
cd ChojemaDooroo
npm ci
npm run dev
```

HWP 편집기를 처음 빌드할 때 고정된 rhwp 태그의 편집기 소스를 GitHub에서 받아옵니다. 이후 동일한 소스와 패치에는 빌드 캐시를 사용합니다.

```sh
npm run typecheck
npm test
npm run test:smoke
npm run dist:win
```

설치 파일은 `apps/desktop/release`에 생성됩니다. Mac에서 직접 빌드할 때는 `npm run dist:mac`을 사용합니다. 서명과 공증은 별도 구성 대상입니다.

## 업데이트와 배포

첫 공개 시험 버전은 `0.1.0-beta.2`입니다. 버그 수정은 패치 번호, 호환 가능한 기능 추가는 부 번호, 큰 호환성 변경은 주 번호를 올립니다. 시험 버전은 `-beta.N`, 배포 후보는 `-rc.N`을 사용합니다. 안정화 이후 첫 정식 버전은 `0.1.0`으로 배포합니다.

Windows 설치본은 시작 후와 4시간 간격으로 이 저장소의 새 버전을 확인합니다. 새 버전이 있으면 다운로드 여부를 묻습니다. 다운로드한 업데이트는 작업을 저장한 뒤 설정에서 설치합니다. macOS의 서명 없는 배포본은 배포 페이지에서 직접 내려받는 방식입니다.

자세한 절차는 [배포 안내](docs/releasing.md)와 [구조 및 개발 안내](docs/development.md)를 참고하세요.

## 라이선스와 출처

Chojema Dooroo의 제품 개발과 유지관리는 Chojema가 담당합니다. 재사용 구성요소의 원저작권은 각 권리자에게 있습니다.

[chojema/chojemaoffice](https://github.com/chojema/chojemaoffice)의 소스 중 HWP 편집기 및 공용 라이브러리를 바탕으로 만들었습니다. 해당 소스는 [IeumOffice](https://github.com/pblsketch/openoffice)와 [GenOffice](https://github.com/genspark-ai/genoffice)에 기반하며 Apache-2.0 라이선스입니다. HWP/HWPX 엔진과 편집기는 [rhwp](https://github.com/edwardkim/rhwp)의 MIT 라이선스 코드를 사용합니다.

[LICENSE](LICENSE), [NOTICE](NOTICE), 포함된 구성요소의 라이선스를 유지합니다. 원본을 수정한 파일과 변경 내용은 [출처 기록](docs/upstream.md)에 정리합니다. 원본 제품 이름은 출처 설명을 위한 것이며 제휴나 보증을 의미하지 않습니다.

본 제품은 한글과컴퓨터의 한글 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.
