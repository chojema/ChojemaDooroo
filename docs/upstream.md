# 소스 출처와 변경 범위

- 원본: [IeumOffice](https://github.com/pblsketch/openoffice) 및 그 기반인 [GenOffice](https://github.com/genspark-ai/genoffice)
- 포함 범위: `apps/hwp`, HWP 전용 동작에 필요한 공용 `packages`, `vendor/rhwp-core`
- 원저작권, 라이선스와 출처는 `LICENSE`, `NOTICE` 및 구성요소별 고지에 보존합니다.

## 원본 반영 기준

- 최초 도입 기준: `357568c8`(2026-10-29, 파일 대조로 추정. 공유 경로가 같은 10-28~10-29 커밋 중 최신).
- 마지막 비교 기준: `4b7a45a91`(v0.12.10, 2026-11-01). 엔진과 편집기 플러그인은 이 시점과 같고, 플러그인에는 우리 고유 기능(그림 내보내기, 페이지 선택, 앱 메뉴, 상태 표시줄)이 더해져 있습니다.
- 선택 반영: 인쇄 미리보기, 문서 점검, AI 그림 보기와 오류 수정 `8d726e9e`, `58215ad2`, `064e16ad`, `52fc3ec5`, `799708f6`.
- 아직 반영하지 않음: AI 공급자·추론 강도·모델 목록 변경, 새 문서 저장 형식 설정, 프로젝트 폴더, Google Drive, 다른 문서 형식과 CLI.

## 주요 변경 사항

- `packages/i18n/src/product.ts`: 제품명, 사용자 데이터 폴더, 저장소 경로를 Chojema Dooroo에 맞게 설정.
- `apps/hwp/src/main/hwp-main.ts`: 새 문서의 기본 저장 형식을 HWPX로 설정하고 기존 문서의 저장 형식은 유지.
- `apps/desktop`: Chojema Dooroo 전용 데스크톱 창, 탭, 나란히 보기, 창 분리, 설정 및 업데이트 구성.
- `packages`: HWP/HWPX 편집기와 무관한 타 문서 포맷 엔진(DOCX, PPTX, XLSX, PDF, ODT, EPUB, XMind) 및 슬라이드 템플릿 폰트 제거.
