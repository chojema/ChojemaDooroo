# 구조 및 개발 안내

- `apps/desktop`: Chojema Dooroo 전용 창, 탭, 나란히 보기, 설정, 업데이트와 패키징.
- `apps/hwp`: HWP/HWPX 편집기와 rhwp 연결.
- `packages`: HWP 텍스트/메모 파싱(`file-parse`), 공용 화면(`ui`), 일렉트론 유틸리티(`electron-utils`), 다국어(`i18n`), 프로젝트 저장소(`project-store`), ZIP 검증(`zip-gate`), AI 도우미(`agent-core`, `ai-provider`, `ai-search`).
- `vendor/rhwp-core`: rhwp WebAssembly와 재빌드용 패치.
- `tools`: 라이선스 고지, 버전, 공개 파일 검사와 실제 앱 검증.

창을 분리할 때 같은 `WebContentsView`를 새 `BrowserWindow`로 옮깁니다. 문서를 다시 읽거나 직렬화하지 않아 편집 내용과 실행 취소 이력을 유지합니다.

배포 데이터는 `ChojemaDocs` 전용 사용자 데이터 폴더에 저장합니다. 개발 실행은 `ChojemaDocs-Dev`를 사용합니다. 이전 버전 사용자의 설정과 업데이트 경로를 잇기 위해 폴더 이름과 `appId`(`io.github.chojema.docs`)는 유지합니다.

`tools/build-rhwp-core.mjs`로 엔진 자체를 재빌드하는 경우에만 Rust와 `wasm-pack`이 필요합니다.
