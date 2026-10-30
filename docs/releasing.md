# 배포 절차

## 버전

버전은 루트 `package.json`과 `apps/desktop/package.json`에서 일치해야 합니다.

```sh
npm run version:set -- 0.1.0-beta.3
```

## 배포 전 검증

1. `CHANGELOG.md`와 `docs/releases/<버전>.md`를 갱신합니다.
2. `npm ci`, `npm run typecheck`, `npm test`를 실행합니다.
3. `npm run build`, `npm run test:smoke`로 편집 화면, 저장, 창 분리를 확인합니다.
4. `npm run dist:win`으로 Windows 설치본을 생성합니다.
5. `npm run check:public`을 실행합니다.
6. 변경 사항을 커밋하고 버전 태그를 push합니다.

```sh
git tag v0.1.0-beta.3
git push origin main
git push origin v0.1.0-beta.3
```

Windows 배포 워크플로는 태그와 제품 버전의 일치를 확인하고, 검사와 빌드 후 설치 파일, 업데이트 정보, SHA-256 체크섬을 GitHub Releases에 게시합니다.

## macOS

macOS 빌드는 Mac 환경에서 수행합니다.

```sh
npm ci
npm run dist:mac
```
