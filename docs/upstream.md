# 소스 출처와 변경 범위

- 출처: https://github.com/chojema/chojemaoffice
- 기준 커밋: 9e2242fa86f55b11e66488a40d80384e10d4f2ec
- 원본 제품: IeumOffice, 그 기반인 GenOffice.
- 포함 범위: apps/hwp, 필요한 packages와 vendor/rhwp-core.
- 원저작권, 라이선스와 출처는 LICENSE, NOTICE 및 구성요소별 고지에 보존.

Chojema Docs에서 새로 작성한 제품 코드와 문서는 Chojema가 관리합니다. 기존 저장소의 커밋 이력은 복제하지 않고, 원본 권리자는 출처 및 라이선스 고지로 구분합니다.

## 원본 변경 파일

- `packages/i18n/src/product.ts`: 제품명, 사용자 데이터 폴더, 저장소와 연락 경로를 Chojema Docs 전용으로 변경.
- `apps/hwp/src/main/hwp-main.ts`: 새 문서의 기본 저장 형식을 HWPX로 변경. 기존 문서의 저장 형식은 유지.
- `packages/pdf-structure/src/writeback/font.ts`: PDF 전용 편집기 앱에 대한 참조를 공용 글꼴 판독 파일의 내부 참조로 변경.
- `packages/pdf-structure/src/writeback/font-cmap.ts`: 원본 PDF 편집기에서 사용하던 공용 글꼴 판독 코드를 동일하게 가져옴.
- `apps/desktop/src/main/ai-secrets.ts`: 원본 앱의 인증 정보 보호 유틸리티를 동일하게 가져옴.

추가 변경이 있으면 이 목록을 갱신합니다. 문서 엔진의 내부 식별자와 저장 형식을 제품명 변경 목적으로 치환하지 않습니다.

- `apps/desktop/src/services/main`: 원본에서 공용 문서 도우미 처리만 추출. Word 편집기와 문서 열기, 저장 경로는 포함하지 않음.

- HWP 테스트의 제품명 예상값과 Node.js 시험 환경 설정을 Chojema Docs에 맞춤. 공용 서비스의 기존 테스트를 전용 앱에 포함.
- `packages/agent-core/tests/sanitize-payload.test.ts`: 가짜 인증 문자열을 실행 시 조합하도록 변경하여 공개 검사 오탐을 방지. 검사 규칙은 완화하지 않음.

- 공용 패키지의 공개 테스트용 키와 글꼴 식별자 문자열은 동일한 값을 실행 시 조합하도록 변경. 배포 코드 동작에는 영향 없음.
