# Agent Market — Step 1

중고 핸드폰·태블릿 판매글 초안, 사람 승인 게시, 비공개 구매 조건, 자체 매물 DB 검색의 핵심 백엔드 MVP입니다. 외부 개인 Agent는 MCP 어댑터를 통해 같은 HTTP API를 사용하며, 게시와 구매 조건 확정은 사람만 실행합니다.

## 로컬 실행

Node.js 22.5 이상에서 별도 패키지 설치 없이 실행합니다.

```sh
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
node --test
```

## 역할 경계

이 백엔드는 진규의 DB·API·상태·시드 범위를 구현합니다. Rule-based 검색은 E2E 동작을 위해 최소 기준만 두었으므로 지후의 조건/매칭 규칙과 함께 조정해야 합니다. 프론트 API 초안은 별도 `feat/gomja-frontend` 브랜치에서 읽기만 했으며 이 브랜치에는 병합하지 않았습니다.
