# Agent Market — Step 1

외부 Agent의 판매·구매 초안을 사람이 검토·승인하고, 자체 DB 매물을 검색하는 Web MVP입니다.

## 구조

- `frontend/`: `feat/gomja-frontend`에서 가져온 HTML·CSS·JavaScript 화면, API 어댑터, 데모 데이터, 테스트
- `backend/`: Node.js HTTP API, SQLite 저장소, 마이그레이션, 공통 JSON Schema, 테스트

React를 사용하지 않으며 별도 패키지 설치 없이 실행합니다. Node.js 22.5 이상과 Python 3가 필요합니다.

## 실행

저장소 루트에서 터미널 두 개로 실행합니다.

```sh
npm run start:api
```

```sh
npm run dev:frontend
```

브라우저에서 http://localhost:4173 을 엽니다. 프론트엔드는 기본적으로 http://127.0.0.1:8080 API에 연결합니다. `frontend/config.js`에서 주소를 바꾸거나 빈 문자열로 설정해 localStorage 데모 모드를 사용할 수 있습니다.

백엔드는 `backend/.local/agent-market.sqlite`에 DB를 생성하고 12개 ACTIVE 매물을 준비합니다. 사용자 헤더는 로컬 데모용이므로 공개 배포 전 실제 인증을 연결해야 합니다.

## 테스트

```sh
npm test
```

`npm run demo:search`는 메모리 DB로 판매 초안 → 사람 게시 → 구매 조건 → 사람 확정 → 검색 흐름을 검증합니다.

`npm run test:backend`와 `npm run test:frontend`로 각각 실행할 수도 있습니다.

## 문서

- [백엔드 실행·범위](backend/README.md)
- [검색 실행·테스트·데모 가이드](backend/docs/search-runbook.md)
- [백엔드 API 계약](backend/docs/backend-api.md)
- [공통 JSON Schema](backend/schemas/step1.schema.json)
- [프론트엔드 실행·화면](frontend/README.md)
- [프론트엔드 API](frontend/docs/frontend-api.md)

Step 1은 핸드폰·태블릿, 초안과 사람 승인, 비공개 구매 조건, Rule-based Matching만 포함합니다.
