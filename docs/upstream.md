# 소스 출처와 변경 범위

- 원본: [IeumOffice](https://github.com/pblsketch/openoffice) 및 그 기반인 [GenOffice](https://github.com/genspark-ai/genoffice)
- 포함 범위: `apps/hwp`, 필요한 공용 `packages`, `vendor/rhwp-core`
- 원저작권, 라이선스와 출처는 `LICENSE`, `NOTICE` 및 구성요소별 고지에 보존합니다.

## 주요 변경 파일

- `packages/i18n/src/product.ts`: 제품명, 사용자 데이터 폴더, 저장소 경로를 Chojema Dooroo에 맞게 설정.
- `apps/hwp/src/main/hwp-main.ts`: 새 문서의 기본 저장 형식을 HWPX로 설정하고 기존 문서의 저장 형식은 유지.
- `packages/pdf-structure/src/writeback/font.ts`, `font-cmap.ts`: 공용 글꼴 판독 코드를 내부 참조로 정리.
- `apps/desktop`: Chojema Dooroo 전용 데스크톱 창, 탭, 나란히 보기, 창 분리, 설정 및 업데이트 구성.
