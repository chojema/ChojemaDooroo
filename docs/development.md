# 구조 및 개발 안내

- `apps/desktop`: Chojema Dooroo 전용 창, 탭, 나란히 보기, 설정, 업데이트와 패키징.
- `apps/hwp`: HWP/HWPX 편집기와 rhwp 연결.
- `packages`: HWP 텍스트/메모 파싱(`file-parse`), 공용 화면(`ui`), 일렉트론 유틸리티(`electron-utils`), 다국어(`i18n`), 프로젝트 저장소(`project-store`), ZIP 검증(`zip-gate`), AI 도우미(`agent-core`, `ai-provider`, `ai-search`).
- `vendor/rhwp-core`: rhwp WebAssembly와 재빌드용 패치.
- `tools`: 라이선스 고지, 버전, 공개 파일 검사와 실제 앱 검증.

창을 분리할 때 같은 `WebContentsView`를 새 `BrowserWindow`로 옮깁니다. 문서를 다시 읽거나 직렬화하지 않아 편집 내용과 실행 취소 이력을 유지합니다.

배포 데이터는 `ChojemaDocs` 전용 사용자 데이터 폴더에 저장합니다. 개발 실행은 `ChojemaDocs-Dev`를 사용합니다. 이전 버전 사용자의 설정과 업데이트 경로를 잇기 위해 폴더 이름과 `appId`(`io.github.chojema.docs`)는 유지합니다.

`tools/build-rhwp-core.mjs`로 엔진 자체를 재빌드하는 경우에만 Rust와 `wasm-pack`이 필요합니다.

## macOS Apple Silicon 빌드

Windows에서 설치한 `node_modules`는 macOS에서 재사용할 수 없습니다. 동기화 폴더의 소스만 별도 작업 폴더로 복사하거나 깨끗한 체크아웃을 사용하고, 해당 폴더에서 다음 순서로 실행합니다.

```sh
npm ci
node node_modules/electron/install.js
npm run typecheck
npm test
npm run build
npm run notices
npm run dist:mac -w @chojema/desktop -- --arm64 --publish never
npm run test:smoke
```

`electron/install.js`는 npm의 설치 스크립트 정책 때문에 Electron 런타임 자동 설치가 생략된 환경에서도 실행 파일을 준비합니다. 설치되어 있으면 즉시 종료합니다.

산출물은 `apps/desktop/release/ChojemaDooroo-<버전>-arm64.dmg`, 같은 이름의 ZIP, `apps/desktop/release/mac-arm64/ChojemaDooroo.app`입니다. 실제 패키지 검사는 `CHOJEMA_DOOROO_EXE`에 `.app/Contents/MacOS/ChojemaDooroo` 절대 경로를 넣어 `npm run test:smoke`를 실행합니다. 검사는 임시 사용자 프로필을 사용합니다.

macOS 전용 `build/icon.icns`를 사용하고 로컬 실행용 ad-hoc 서명을 적용합니다. Apple Developer ID 서명과 공증은 포함하지 않으므로 공개 배포용 신뢰 검증과는 구분합니다. Intel(x64) 빌드는 별도 런타임 준비와 검증이 필요합니다.

앱 아이콘 원본은 `apps/desktop/build/*.svg`입니다. 수정한 뒤 macOS에서 `python3 tools/build-icons.py`를 실행하면 `icon.png`, `icon.ico`, `icon.icns`를 다시 만듭니다(Google Chrome, Pillow 필요).
