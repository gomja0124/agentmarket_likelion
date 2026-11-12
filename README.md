# Agent Market — Step 1 + Step 2 데모

외부 Agent의 판매·구매 초안을 사람이 검토·승인하고, 자체 DB 매물을 검색하는 Web MVP입니다. Step 2의 공개 구매 수요, 판매자 역방향 탐색, 사람 승인 연결 요청, 중복 방지 알림도 로컬 데모로 구현했습니다.

`dokyeong-merge`는 `integration/buyer-features`와 `codex/agentmarket-step1`을 병합한 뒤 UAT·11/02 회의 방향에 맞춰 구매자 중심 진입, 자연어 조건 입력, 역할별 메뉴, 입력·복귀 안정성, 매물 재활성화와 한글 모델 별칭 검색을 보완한 브랜치입니다.

## 구조

- `frontend/`: `feat/gomja-frontend`에서 가져온 HTML·CSS·JavaScript 화면, API 어댑터, 데모 데이터, 테스트
- `backend/`: Node.js HTTP API, SQLite 저장소, 마이그레이션, 공통 JSON Schema, 테스트

React를 사용하지 않으며 백엔드 API는 내장 모듈을 사용하고 MCP 서버는 SDK 의존성을 설치해야 합니다. Node.js 22.5 이상과 Python 3가 필요합니다.

## 실행

먼저 `npm --prefix backend ci`로 MCP 의존성을 설치합니다.

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
- [Step 2 API와 시연 순서](backend/docs/step2-api.md)
- [구현 현황과 남은 작업](docs/IMPLEMENTATION_STATUS.md)
- [공통 JSON Schema](backend/schemas/step1.schema.json)
- [프론트엔드 실행·화면](frontend/README.md)
- [프론트엔드 API](frontend/docs/frontend-api.md)
- [Web 로그인·strict API 중계](backend/docs/web-auth.md)
- [단일 서비스 배포 절차](backend/docs/deployment.md)
- [AWS EC2 배포 절차](backend/docs/deploy-aws.md)

Step 1의 검색은 비공개 구매 조건만 사용합니다. Step 2는 별도 API와 데이터 테이블에서 공개 수요와 연결 요청을 처리합니다.


## MCP 서버

API 실행 후 `npm run start:mcp`로 stdio MCP, `npm run start:mcp:http`로
토큰 인증이 필요한 HTTP MCP를 실행할 수 있습니다. `npm run test:mcp`로
두 전송 방식의 테스트를 실행합니다. 외부 Agent 설정과 토큰 발급은
[MCP 연결 가이드](backend/docs/mcp-tools.md)를 참고하세요.

정적 Web은 demo 인증 모드로 실행할 수 있습니다. strict 모드에서는 `npm run start:web`으로 로그인 Web을 띄웁니다. Web과 API는 같은 DB를 사용하며 공유 비밀은 Web 서버에만 둡니다. [설정 방법](backend/docs/web-auth.md)을 참고하세요.

Step 2 MCP 도구는 `AGENT_MARKET_ENABLE_STEP2=1`로 MCP 서버를 실행할 때만 추가됩니다. Agent는 공개 수요 **초안**과 탐색·알림 조회까지만 할 수 있고 공개·연결 요청·수락은 Web에서 사람이 직접 처리합니다.

## 배포 구성

저장소 루트의 `Dockerfile`은 Web, strict API, HTTP MCP를 한 컨테이너의 한 공개 포트로 실행합니다. `/mcp`는 토큰 인증을 사용하고 API는 컨테이너 내부에서만 열립니다. [EC2 배포 구성](backend/docs/deploy-aws.md)은 Caddy와 영속 볼륨을 사용합니다. [Railway 배포 경로](backend/docs/deployment.md)도 준비되어 있습니다. `backend/docker-compose.yml`은 자체 서버용 3서비스 대안입니다. 공개 회원가입과 로그인은 Web에서 지원하고, 기존 관리자 계정은 CLI로 발급할 수 있습니다. 구매 조건을 정리한 뒤 당근 중고거래 검색으로 이동하는 기능은 확인된 공개 웹 검색 필터만 사용하며, 당근 매물을 자체 DB로 복사하거나 자동 매칭하지 않습니다. 운영 백업과 외부 Agent 앱 등록은 별도로 확인해야 합니다.
