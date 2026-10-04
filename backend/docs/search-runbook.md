# 구매 조건 구조화·검색 실행 가이드

## 실행 환경과 위치

명령은 저장소 루트에서 실행합니다. Node.js 22.5 이상, npm과 Python 3가
필요합니다. npm 패키지 설치나 API 키는 필요하지 않습니다. 자연어 처리는
규칙 기반이며, 외부 Agent의 LLM 대화와 MCP 서버 자체는 이 구현에 없습니다.

```sh
node --version
python3 --version
npm run start:api
```

별도 터미널에서:

```sh
npm run dev:frontend
```

http://localhost:4173 에 접속합니다. API는 http://127.0.0.1:8080,
DB는 backend/.local/agent-market.sqlite 입니다. 신규 DB에는 핸드폰·태블릿
12개 ACTIVE 시드 매물이 생성됩니다. 기존 DB는 데이터와 선택 질문 건너뛰기
정보를 유지하며 필요한 컬럼을 자동 추가합니다.

PORT를 변경하면 frontend/config.js의 AGENT_MARKET_API_BASE도 변경합니다.
AGENT_MARKET_DB_PATH로 별도 DB를 지정할 수 있으며 상대 경로는 backend 기준입니다.

```sh
PORT=8081 AGENT_MARKET_DB_PATH=.local/demo.sqlite npm run start:api
```

## 자동 HTTP 데모

```sh
npm run demo:search
```

임시 포트·메모리 DB를 사용하는 독립 데모입니다. 별도로 서버를 시작하지
않아도 되며 로컬 DB를 변경하지 않습니다. 다음 흐름을 실제 HTTP로 실행하고
검증에 실패하면 종료 코드가 0이 아닌 값이 됩니다.

1. 핸드폰·태블릿 12개 시드 확인
2. Agent 판매 초안 생성, Agent 게시 거부, 사람 게시
3. 자연어 구매 조건 구조화
4. 승인 전 검색과 Agent 확정 거부
5. 사람 확정 후 Agent 검색
6. 동일 요청 ID 재시도 결과 일치 확인

성공 시 status: PASS와 조건·후보·판정 근거·ruleVersion이 출력됩니다.
이 데모는 Agent 역할을 HTTP 헤더로 모사합니다. 실제 MCP 클라이언트나
외부 Agent 연결, 브라우저 화면 조작까지 검증한 것으로 보지 않습니다.

## API 수동 재현

API 서버를 실행한 뒤 다음 요청을 보냅니다. 아래 헤더는 로컬 데모용이며
실제 인증 수단이 아닙니다. 사용자 기본값은 데모 사용자입니다.

```sh
curl -sS http://127.0.0.1:8080/api/health
curl -sS http://127.0.0.1:8080/api/categories/TABLET/schema
curl -sS http://127.0.0.1:8080/api/purchase-requests \
  -H 'Content-Type: application/json' \
  -H 'X-Actor-Type: AGENT' \
  -H 'Idempotency-Key: runbook-purchase-001' \
  -d '{"naturalLanguageRequest":"아이패드 에어 60만원 이하 256GB 이상"}'
```

응답의 id를 다음 변수에 넣습니다. 기대 조건은 TABLET, iPad Air,
maxBudgetKrw=600000, storageGb=256입니다. status는 DRAFT이고
humanApprovalRequired는 true입니다. 상태 선호 질문은 선택 사항입니다.

```sh
PURCHASE_ID='위 응답의 id'
curl -sS "http://127.0.0.1:8080/api/purchase-requests/$PURCHASE_ID"
curl -sS -X POST "http://127.0.0.1:8080/api/purchase-requests/$PURCHASE_ID/search" \
  -H 'X-Actor-Type: AGENT' -H 'Idempotency-Key: runbook-before-approval'
```

마지막 요청은 409 INVALID_STATE입니다. 사람이 조건을 검토한 뒤 확정합니다.

```sh
curl -sS -X POST "http://127.0.0.1:8080/api/purchase-requests/$PURCHASE_ID/confirm"
curl -sS -X POST "http://127.0.0.1:8080/api/purchase-requests/$PURCHASE_ID/search" \
  -H 'X-Actor-Type: AGENT' -H 'Idempotency-Key: runbook-search-001'
```

신규 시드 DB에서 iPad Air 5 256GB, 570000원은 MATCH입니다. API는
EXCLUDED도 진단용으로 반환하며 프론트 HTTP 어댑터는 후보 목록에서 제외합니다.
동일 검색 요청 ID는 원래 결과를 반환합니다. 새 검색에는 새 ID를 사용합니다.

```sh
curl -sS -X PATCH "http://127.0.0.1:8080/api/purchase-requests/$PURCHASE_ID" \
  -H 'Content-Type: application/json' -d '{"maxBudgetKrw":500000}'
curl -sS -X POST "http://127.0.0.1:8080/api/purchase-requests/$PURCHASE_ID/search"
```

수정 후에는 DRAFT로 돌아가 마지막 요청이 409가 됩니다. 재확정이 필요합니다.
Agent 수정에는 X-Actor-Type: AGENT와 새 Idempotency-Key를 추가하세요.

## 자동 테스트와 검수 범위

```sh
npm test
npm run test:backend
npm run test:frontend
```

전체 테스트는 백엔드 다음 프론트엔드 순서로 실행되며 서버를 따로 실행할
필요가 없습니다. HTTP 테스트는 임시 포트·메모리 DB, DB 마이그레이션 테스트는
임시 디렉터리를 사용합니다.

| 검수 항목 | 자동 검증 위치 |
| --- | --- |
| AC-01 판매 초안 저장·수정 | backend.test.js, frontend-integration.test.js |
| AC-02 Agent 게시 거부·사람 게시 | backend.test.js, search-demo.js |
| AC-03 자연어 구매 조건·충돌·추가 질문 | purchase-conditions.test.js, purchase-questions.test.js |
| AC-04 승인 전 검색 거부·수정 후 재승인 | backend.test.js |
| AC-05 ACTIVE 필터·별칭·세부 모델·예산·누락 판정 | matching.test.js, backend.test.js |
| AC-06 프론트 API 어댑터 결과 전달 | frontend-integration.test.js |
| 중복 호출·실패 로그·비공개 조건 | backend.test.js |
| 기존 DB 마이그레이션·질문 선택 유지 | purchase-questions.test.js |

AC-01의 자유 설명을 외부 Agent가 구조화하는 실제 MCP 흐름과 AC-06의 화면
표시는 별도 수동 검수가 필요합니다. 자동 테스트는 화면 렌더링을 검증하지 않습니다.

## Web 수동 검수

- 판매 화면에서 초안을 생성·수정하고 필수 값 누락 시 게시 불가 확인
- 사람 게시 후 내 판매글과 공개 매물에 표시되는지 확인
- 구매 조건 검토 후 검색, 후보 가격·모델·용량·상태 표시 확인
- 정보가 없는 경우 확인 필요 항목이 표시되는지 확인
- 사진 AI 분석·공개 수요·지속 감시·협상·결제 UI가 포함되지 않았는지 확인

외부 Agent가 만든 초안은 현재 내 구매 조건 목록을 통해 검토합니다.
ID 전용 Web deep link와 선택 질문 건너뛰기 전용 UI는 추가하지 않았습니다.
skippedQuestionFields는 API로 지원됩니다.

## 문제 해결과 제한

- EADDRINUSE: PORT를 다른 값으로 지정하고 프론트 API 주소를 맞춥니다.
- Web 매물 로딩 실패: API가 실행 중인지, config.js의 주소가 맞는지 확인합니다.
- 테스트 listen EPERM: 로컬 포트 바인딩을 차단한 실행 환경입니다. 허용된
  환경에서 실행하세요. 코드의 매칭 실패와 구분해야 합니다.
- node:sqlite experimental 경고: 일부 Node 버전에서 출력되며 테스트 실패는 아닙니다.
- 모호한 자연어: missingFields/nextQuestions를 확인해 구조화 조건으로 답합니다.
- numbered modelQuery는 정확한 변형을 구분합니다. iPhone 15는 15 Pro를
  포함하지 않습니다. 모델군 검색은 iPhone처럼 넓은 모델 이름을 사용하세요.

배포 전 실제 인증과 Agent 사용자 권한 검증이 필요합니다. Step 1에는 플랫폼
내부 AI 채팅, 외부 크롤링, 사진 AI 분석, Step 2 기능을 구현하지 않습니다.
