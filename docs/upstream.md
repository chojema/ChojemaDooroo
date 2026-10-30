# 소스 출처와 변경 범위

- 원본: [IeumOffice](https://github.com/pblsketch/openoffice) 및 그 기반인 [GenOffice](https://github.com/genspark-ai/genoffice)
- 포함 범위: `apps/hwp`, HWP 전용 동작에 필요한 공용 `packages`, `vendor/rhwp-core`
- 원저작권, 라이선스와 출처는 `LICENSE`, `NOTICE` 및 구성요소별 고지에 보존합니다.

## 주요 변경 사항

- `packages/i18n/src/product.ts`: 제품명, 사용자 데이터 폴더, 저장소 경로를 Chojema Dooroo에 맞게 설정.
- `apps/hwp/src/main/hwp-main.ts`: 새 문서의 기본 저장 형식을 HWPX로 설정하고 기존 문서의 저장 형식은 유지.
- `apps/desktop`: Chojema Dooroo 전용 데스크톱 창, 탭, 나란히 보기, 창 분리, 설정 및 업데이트 구성.
- `packages`: HWP/HWPX 편집기와 무관한 타 문서 포맷 엔진(DOCX, PPTX, XLSX, PDF, ODT, EPUB, XMind) 및 슬라이드 템플릿 폰트 제거.
