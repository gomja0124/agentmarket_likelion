# Step 1 MCP Tools

외부 개인 Agent(Claude Desktop, Cursor 등)가 Agent Market에 접속하는 창구다. `mcp/` 는 [Backend API](backend-api.md)를 그대로 감싸는 얇은 어댑터이며 로직을 갖지 않는다. 상태 전이, 권한, 검증은 전부 서버가 판정하고 어댑터는 그 결과를 Agent가 이해할 수 있는 형태로 돌려준다.

```
[사용자] ── 대화 ──▶ [외부 Agent] ── MCP(stdio) ──▶ mcp/index.js ── HTTP(X-Actor-Type: AGENT) ──▶ server/
                                                                                                  ▲
[사용자] ── 브라우저 ──▶ [Web] ────────────────────── HTTP(X-Actor-Type: HUMAN) ─────────────────────┘
```

## 실행

```sh
npm install            # @modelcontextprotocol/sdk, zod
node server/index.js   # 백엔드 (127.0.0.1:8080)
node mcp/index.js      # MCP 서버 (stdio). 보통 Agent 앱이 직접 띄운다
```

환경 변수

| 이름 | 기본값 | 의미 |
| --- | --- | --- |
| `AGENT_MARKET_API_URL` | `http://127.0.0.1:8080` | 백엔드 주소 |
| `AGENT_MARKET_USER_ID` | 데모 사용자 UUID | 이 Agent가 대리하는 사용자. 서버의 `X-User-Id`로 전달된다 |
| `AGENT_MARKET_WEB_URL` | 없음 | 승인 안내 문구에 넣을 Web 주소 |

Claude Desktop `claude_desktop_config.json` 예시

```json
{
  "mcpServers": {
    "agent-market": {
      "command": "node",
      "args": ["/absolute/path/agentmarket_likelion/mcp/index.js"],
      "env": {
        "AGENT_MARKET_API_URL": "http://127.0.0.1:8080",
        "AGENT_MARKET_USER_ID": "00000000-0000-4000-8000-000000000001",
        "AGENT_MARKET_WEB_URL": "http://localhost:5173"
      }
    }
  }
}
```

사용자 식별은 Step 1 데모용 헤더 방식이다. 실제 배포에서는 Web에서 발급한 토큰을 `env`에 넣고 서버가 검증해야 한다.

## Tool 목록

읽기 tool은 승인 없이 호출할 수 있다. 쓰기 tool은 전부 멱등하며 `requestId`(UUID)를 넘기면 재시도해도 중복 생성되지 않는다. 생략하면 어댑터가 호출마다 새 키를 만든다.

| tool | 종류 | 백엔드 경로 | 설명 |
| --- | --- | --- | --- |
| `get_market_guide` | 읽기 | `GET /api/health` | 할 수 있는 일·없는 일, 판매·구매 흐름, 승인 지점. 가장 먼저 호출 |
| `get_category_schema` | 읽기 | `GET /api/categories/:c/schema` | 필수·선택 항목과 질문 힌트 |
| `search_listings` | 읽기 | `GET /api/listings?q=` | ACTIVE 매물 텍스트 검색 |
| `get_listing` | 읽기 | `GET /api/listings/:id` | 매물 상세 |
| `list_my_listing_drafts` | 읽기 | `GET /api/listing-drafts/mine` | 내 판매 초안 + nextStep |
| `list_my_listings` | 읽기 | `GET /api/listings/mine` | 내 매물 |
| `list_my_purchase_requests` | 읽기 | `GET /api/purchase-requests/mine` | 내 구매 조건 + nextStep |
| `create_listing_draft` | 쓰기 | `POST /api/listing-drafts` | 판매글 초안 생성 |
| `update_listing_draft` | 쓰기 | `PATCH /api/listing-drafts/:id` | 초안 수정 |
| `create_purchase_request` | 쓰기 | `POST /api/purchase-requests` | 구매 조건 초안 생성 |
| `update_purchase_request` | 쓰기 | `PATCH /api/purchase-requests/:id` | 구매 조건 수정 (확정 상태면 DRAFT로 되돌아감) |
| `run_search` | 쓰기 | `POST /api/purchase-requests/:id/search` | 확정된 조건으로 Rule-based 매칭 |

tool로 노출하지 않는 것: 게시(`publish`), 확정(`confirm`), 비활성화(`deactivate`). 서버도 `X-Actor-Type: AGENT`면 403으로 거부하므로 어댑터를 우회해도 Agent는 할 수 없다.

## 승인 지점

| 시점 | 누가 | 어디서 | Agent에게 보이는 신호 |
| --- | --- | --- | --- |
| 판매글 게시 | 판매자 | Web | 초안 `status: READY_FOR_REVIEW` + `nextStep`에 게시 안내. 게시 후에는 `list_my_listings`에 나타남 |
| 구매 조건 확정 | 구매자 | Web | 조건 `status: DRAFT` + `nextStep`에 확정 안내. 확정 전 `run_search`는 `INVALID_STATE` |

쓰기 tool 응답에는 항상 `nextStep` 문자열이 들어간다. Agent는 이 문장을 사용자에게 그대로 전달하면 된다.

## 응답 형식

성공은 서버 객체를 그대로 담고, 실패는 `isError: true`와 함께 아래 구조로 돌아온다. 전송 오류가 아니라 tool 결과이므로 Agent가 읽고 다음 행동을 고를 수 있다.

```json
{
  "success": false,
  "code": "INVALID_STATE",
  "message": "구매자가 Web에서 조건을 확정한 뒤 검색할 수 있습니다.",
  "details": {},
  "retryable": false,
  "suggestedAction": "현재 상태에서는 불가능합니다. 사용자가 Web에서 확정·게시했는지 확인한 뒤 다시 시도하세요."
}
```

`run_search` 응답에는 `summary`(MATCH / NEEDS_CONFIRMATION / EXCLUDED 개수)와 `results`가 함께 온다. `NEEDS_CONFIRMATION`은 매물 정보가 없어 판단할 수 없다는 뜻이며 적합으로 추정하면 안 된다.

## E2E 테스트

```sh
node --test test/mcp.test.js
```

인메모리 API를 띄우고, `mcp/index.js`를 실제 stdio 프로세스로 실행한 뒤 SDK 클라이언트로 호출한다. 판매 초안 → 사람 게시 → 조회, 구매 조건 → 확정 전 검색 거부 → 사람 확정 → 검색, 멱등 재시도, 오류 구조화를 확인한다. Claude Desktop이 하는 것과 같은 경로이므로 이 테스트가 통과하면 실제 연결도 동작한다.

## Step 2에서 추가될 것

공개 구매 수요 조회·응답, 신규 매물 감시 등록, 가격·시간 제안, 가예약, 사람 승인 요청 tool. 전부 같은 어댑터 패턴으로 추가한다.
