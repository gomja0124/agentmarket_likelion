# Agent Market — Step 1

중고 핸드폰·태블릿 판매글 초안, 사람 승인 게시, 비공개 구매 조건, 자체 매물 DB 검색의 핵심 백엔드 MVP입니다. 외부 개인 Agent용 MCP 어댑터가 연결할 HTTP API를 제공하며, 게시와 구매 조건 확정은 사람만 실행합니다.

## 로컬 실행

Node.js 22.5 이상에서 API 자체는 내장 모듈로 실행하고 MCP 및 전체 테스트는 `npm ci`로 의존성을 설치합니다.

```sh
cd backend
node server/index.js
```

서버는 `http://127.0.0.1:8080`에 열리고, `.local/agent-market.sqlite` 데이터베이스와 12개 활성 핸드폰·태블릿 시드 매물을 준비합니다. API 경로, 응답, 상태·권한 규칙은 [Backend API 계약](docs/backend-api.md)을 참고하세요. 공유 JSON Schema는 [`schemas/step1.schema.json`](schemas/step1.schema.json)에 있습니다.

제안서의 최종 서비스 아키텍처는 PostgreSQL을 목표로 하지만, 초기 E2E를 바로 실행할 수 있도록 이번 얇은 프로토타입은 Node 내장 SQLite를 사용합니다. 실제 배포 전 PostgreSQL 어댑터·마이그레이션과 인증을 연결해야 합니다.

## 핵심 흐름

- 판매자/Agent가 `ListingDraft`를 저장하고, 서버가 누락 필드와 상태를 계산합니다.
- 판매자 본인이 게시 API를 호출해야 `ACTIVE Listing` 스냅샷이 만들어집니다.
- 구매 조건은 소유자 범위로 비공개 저장되며, 구매자가 확정한 뒤에만 검색할 수 있습니다.
- 서버는 ACTIVE 매물만 대상으로 Rule-based 결과를 기록하고, 위반 후보와 확인 필요 후보를 구분합니다.
- Step 2의 공개 구매 수요, 알림, 거래·가격 조율, 결제·배송은 포함하지 않습니다. 사진 AI 분석도 하지 않습니다.

## 확인

```sh
cd backend
node --test
```

## 역할 경계

이 백엔드는 DB·API·상태·시드와 구매 조건 구조화·추가 질문·Rule-based Matching v2를 구현합니다. 자연어는 규칙으로 처리하며 모델 별칭과 세부 변형, 명시 조건 위반과 누락 정보를 판정합니다. stdio·HTTP MCP 서버와 토큰 인증을 포함합니다. 외부 Agent 앱 등록과 실제 Web 로그인 중계는 별도 설정이 필요합니다. 프론트엔드는 저장소의 `frontend/` 폴더에 있으며 같은 HTTP API를 사용합니다.

## 검색 기능 실행·검수

저장소 루트에서 `npm run demo:search`로 독립 HTTP 데모를 실행합니다.
[실행·테스트 가이드](docs/search-runbook.md)에 수동 API 요청, 검수 항목과 제한을 정리했습니다.

## MCP

저장소 루트에서 `npm --prefix backend ci`로 설치한 뒤 `npm run start:mcp` 또는 `npm run start:mcp:http`로 실행합니다. [MCP 가이드](docs/mcp-tools.md)를 참고하세요.
