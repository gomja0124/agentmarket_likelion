# Step 2 공개 수요 API

Step 2는 Step 1 검색과 분리된 공개 수요, 역방향 매칭, 연결 요청, 알림 흐름이다. 기본 구매 조건은 비공개다. 확정된 구매 조건에서 공개 수요 **초안**을 만든 뒤 구매자가 Web에서 직접 공개해야 판매자에게 나타난다.

## API

| 경로 | 주체 | 동작 |
| --- | --- | --- |
| `POST /api/purchase-requests/:id/public-demand` | 조건 소유자 또는 Agent | 확정 구매 조건의 비공개 공개 수요 초안 생성. 구매 조건당 하나 |
| `GET /api/public-demands/mine` | 구매자 | 내 수요 전체 상태 조회 |
| `GET /api/public-demands/:id` | 구매자 또는 관련 판매자 | 구매자는 전체 필드, 판매자는 공개 필드만 조회 |
| `PATCH /api/public-demands/:id` | 초안은 구매자/Agent, 공개 중에는 구매자만 | 제목·설명·예산 범위·모델·용량·상태·만료일 수정 |
| `POST /api/public-demands/:id/publish` | 구매자만 | 검토한 초안을 ACTIVE로 공개 |
| `POST /api/public-demands/:id/pause` | 구매자만 | 매칭·신규 연결 요청·알림 중지 |
| `POST /api/public-demands/:id/resume` | 구매자만 | 다시 공개 |
| `POST /api/public-demands/:id/close` | 구매자만 | 종료 |
| `GET /api/listings/:id/public-demands` | 매물 소유자 | ACTIVE 매물에 맞는 ACTIVE 공개 수요만 조회 |
| `POST /api/connection-requests` | 판매자만 | `{publicDemandId, listingId}`로 MATCH 후보에 연결 요청 |
| `GET /api/connection-requests/mine` | 구매자/판매자 | 내 연결 요청·내역 조회 |
| `POST /api/connection-requests/:id/accept` / `decline` | 구매자만 | 대기 요청 수락·거절 |
| `GET /api/notifications/mine` | 사용자 | 최근 알림 100개 조회 |
| `POST /api/notifications/:id/read` | 알림 소유자 | 읽음 처리 |

공개 수요에는 연락처·정확한 주소·Agent 대화 전문을 위한 필드가 없다. 제목·설명의 전화번호와 이메일 형태는 입력을 거부하며, 사용자는 공개 전 자유 문구를 직접 검토해야 한다. 판매자 응답에서 구매자 ID와 비공개 구매 조건 ID를 제거한다. 정확한 모델·예산·용량·상태 조건을 위반하면 EXCLUDED로 숨기고, 매물의 판단 정보가 없으면 NEEDS_CONFIRMATION으로 표시한다. 연결 요청은 MATCH에만 허용한다. 동일 매물·수요 조합은 한 번만 알림을 만든다. 만료일이 지나면 관련 API 접근 시 EXPIRED로 전환한다.

`AGENT_MARKET_ENABLE_STEP2=1`을 MCP 프로세스에 설정하면 비공개 초안 생성·수정, 내 수요 목록, 내 매물의 공개 수요 탐색, 알림 조회 도구가 나타난다. 공개·연결 요청·수락 도구는 없다.

## 한 브라우저 시연

1. `npm --prefix backend ci` 후 저장소 루트에서 `npm run start:api`, `npm run dev:frontend`를 각각 실행한다.
2. `http://localhost:4173`에서 **구매자** 계정으로 맞춤 검색 조건을 만들고 사람이 검색을 승인한다.
3. **구해요·알림**에서 확정 조건을 비공개 초안으로 전환하고 공개 내용을 확인한 뒤 **검토하고 공개하기**를 누른다.
4. 상단에서 **판매자** 계정으로 전환한다. 내 판매글에서 맞는 매물의 **맞는 구해요**를 열고 연결 요청을 보낸다.
5. **구매자** 계정으로 돌아와 **구해요·알림**에서 연결 요청을 수락한다. 판매자 알림에 수락 결과가 표시된다.

이 계정 전환은 로컬 `demo` 인증 모드에서만 보인다. 실제 배포에는 로그인과 서버 인증 중계가 필요하다.
