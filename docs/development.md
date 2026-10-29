# 구조 및 개발 안내

- `apps/desktop`: Chojema Docs 전용 창, 탭, 나란히 보기, 설정, 업데이트와 패키징.
- `apps/hwp`: HWP/HWPX 편집기와 rhwp 연결.
- `packages`: 문서 엔진과 공용 화면, 파일 읽기, 글꼴, 문서 도우미 라이브러리.
- `vendor/rhwp-core`: 원본에서 패치한 rhwp WebAssembly와 재빌드용 패치.
- `tools`: 라이선스 고지, 버전, 공개 파일 검사와 실제 앱 검증.

실제 제품에 제공하는 편집기는 HWP/HWPX 전용입니다. 공용 라이브러리에 남아 있는 XLSX, PPTX, PDF, EPUB 관련 코드는 첨부 문서 읽기, 문서 내부 개체 처리 등의 의존성입니다. 해당 편집기 앱을 제공하는 것은 아닙니다.

창을 분리할 때 같은 WebContentsView를 새 BrowserWindow로 옮깁니다. 문서를 다시 읽거나 직렬화하지 않아 편집 내용과 실행 취소 이력을 유지합니다. 저장과 닫기 전 확인은 각 편집기의 기존 구현을 사용합니다.

배포 데이터는 ChojemaDocs 전용 사용자 데이터 폴더에 저장합니다. 개발 실행은 ChojemaDocs-Dev를 사용합니다. 원본 제품의 설정과 인증 정보를 가져오지 않습니다.

엔진 수정은 최소화합니다. 원본 개선 사항을 가져올 때는 `docs/upstream.md`의 기준 커밋과 대조하고, 변경한 파일과 검증 결과를 갱신합니다. `tools/build-rhwp-core.mjs`로 엔진 자체를 재빌드하는 경우에만 Rust와 wasm-pack이 필요합니다.
