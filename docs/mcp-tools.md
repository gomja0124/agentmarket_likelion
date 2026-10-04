# MCP 서버 — 외부 Agent 연결

외부 개인 Agent(Claude Desktop, Cursor, ChatGPT 등)가 Agent Market에 접속하는 창구다. `mcp/`는 [Backend API](backend-api.md)를 그대로 감싸는 얇은 어댑터이며 로직을 갖지 않는다. 상태 전이, 권한, 검증은 전부 서버가 판정하고 어댑터는 그 결과를 Agent가 이해할 수 있는 형태로 돌려준다.

```
[사용자] ── 대화 ──▶ [외부 Agent] ── MCP ──▶ mcp/ ── HTTP (Bearer 토큰) ──▶ server/
                                                                               ▲
[사용자] ── 브라우저 ──▶ [Web] ─────────── HTTP (X-User-Id + X-Web-Secret) ─────┘
```

두 가지 전송 방식을 제공한다.

| 방식 | 파일 | 누가 띄우나 | 용도 |
| --- | --- | --- | --- |
| stdio | `mcp/index.js` | Agent 앱이 로컬에서 직접 실행 | 로컬 개발, 개인 노트북에서 Claude Desktop 연결 |
| Streamable HTTP | `mcp/http.js` | 우리가 서버에 올려둠 | 배포. 사용자는 URL과 토큰만 알면 어디서든 연결 |

## 인증과 권한

Agent는 **사람이 Web에서 발급한 토큰**으로만 접속한다. 토큰은 `amk_`로 시작하고 서버에는 SHA-256 해시만 저장된다. 발급 응답에서 딱 한 번 원문을 보여주고 다시는 조회할 수 없다.

토큰에는 scope가 붙는다. scope에 없는 tool은 목록에 아예 나타나지 않고, 우회해서 API를 쳐도 서버가 403으로 막는다.

| scope | 허용 | 해당 tool |
| --- | --- | --- |
| `read` (항상 포함) | 조회·검색 | whoami, get_market_guide, get_category_schema, browse_listings, get_listing, list_my_* |
| `listing:write` | 판매글 초안 | create_listing_draft, update_listing_draft |
| `purchase:write` | 구매 조건 초안 | create_purchase_request_draft, update_purchase_request_draft |
| `search` | 확정된 조건으로 검색·매칭 | search_listings |

토큰 관리 API (사람 전용, Web에서 호출)

```
POST   /api/agent-tokens            { name, scopes?, expiresInDays? }  → 토큰 원문 포함 (1회)
GET    /api/agent-tokens            목록 (원문·해시 없음, prefix·마지막 사용 시각 포함)
DELETE /api/agent-tokens/:id        폐기. 이후 요청은 401
GET    /api/me                      현재 호출 주체와 scope (Agent·사람 모두)
```

백엔드 인증 모드 (`AGENT_MARKET_AUTH_MODE`)

| 모드 | Agent | 사람(Web) | 용도 |
| --- | --- | --- | --- |
| `demo` (기본) | 토큰이 있으면 검증, 없으면 `X-User-Id` 헤더를 그대로 믿음 | `X-User-Id` 헤더 | 로컬 개발 |
| `strict` | Bearer 토큰 필수 | `X-User-Id` + `X-Web-Secret`(서버 간 공유 비밀) 필수, 모르는 사용자는 거부 | 배포 |

Web 서버는 로그인 세션을 확인한 뒤 사용자 ID를 `X-User-Id`로, `AGENT_MARKET_WEB_SECRET`을 `X-Web-Secret`으로 넣어 API를 호출한다. 브라우저가 API를 직접 부르는 구조라면 Web 백엔드가 프록시 역할을 해야 비밀이 노출되지 않는다.

## 실행

### 로컬 (demo 모드, 토큰 없이)

```sh
npm install
node server/index.js          # 127.0.0.1:8080
```

Claude Desktop `claude_desktop_config.json`

```json
{
  "mcpServers": {
    "agent-market": {
      "command": "node",
      "args": ["/absolute/path/agentmarket_likelion/mcp/index.js"],
      "env": { "AGENT_MARKET_API_URL": "http://127.0.0.1:8080", "AGENT_MARKET_USER_ID": "00000000-0000-4000-8000-000000000001" }
    }
  }
}
```

### 로컬 (토큰 사용)

Web이 아직 토큰 발급 화면을 안 만들었으면 curl로 발급한다.

```sh
curl -X POST http://127.0.0.1:8080/api/agent-tokens -H 'Content-Type: application/json' \
  -H 'X-User-Id: 00000000-0000-4000-8000-000000000001' -H 'X-Actor-Type: HUMAN' \
  -d '{"name":"claude-desktop","scopes":["listing:write","purchase:write","search"]}'
```

응답의 `token`을 `AGENT_MARKET_TOKEN`으로 넣는다. `AGENT_MARKET_USER_ID`는 빼도 된다.

### 배포 (strict + 원격 MCP)

```sh
cp .env.example .env     # AGENT_MARKET_WEB_SECRET 등 채우기
docker compose up -d --build
```

| 서비스 | 포트 | 헬스체크 |
| --- | --- | --- |
| api | 8080 | `GET /api/health` |
| mcp | 8090 | `GET /healthz` |

TLS는 앞단 리버스 프록시(Caddy, nginx, Cloudflare)에서 종료한다. 사용자에게 알려줄 것은 `https://<도메인>/mcp`와 Web에서 발급한 토큰 두 가지다. Claude Desktop/claude.ai의 커스텀 커넥터나 Cursor의 MCP 설정에 URL을 넣고 Authorization 헤더에 `Bearer <token>`을 넣으면 된다.

원격 서버의 보호 장치: 요청마다 토큰 검증(60초 캐시, 폐기 시 다음 검증에서 차단), 토큰별 분당 요청 제한(기본 120, 초과 시 429), 본문 1MB 제한, 백엔드 호출 15초 타임아웃, JSON 구조화 로그, SIGTERM 시 정상 종료.

### 환경 변수

| 이름 | 기본값 | 의미 |
| --- | --- | --- |
| `AGENT_MARKET_API_URL` | `http://127.0.0.1:8080` | 백엔드 주소 |
| `AGENT_MARKET_TOKEN` | 없음 | stdio 모드에서 쓸 Agent 토큰 |
| `AGENT_MARKET_USER_ID` | 데모 사용자 | 토큰이 없을 때(demo 백엔드) 대리할 사용자 |
| `AGENT_MARKET_WEB_URL` | 없음 | 승인 안내 문구에 넣을 Web 주소 |
| `AGENT_MARKET_API_TIMEOUT_MS` | 15000 | 백엔드 호출 타임아웃 |
| `MCP_HOST` / `MCP_PORT` | 127.0.0.1 / 8090 | 원격 MCP 바인딩 |
| `MCP_RATE_LIMIT_PER_MINUTE` | 120 | 토큰별 분당 요청 제한 |
| `MCP_IDENTITY_TTL_MS` | 60000 | 토큰 검증 캐시 |
| 백엔드: `HOST`, `PORT`, `AGENT_MARKET_DB_PATH`, `AGENT_MARKET_AUTH_MODE`, `AGENT_MARKET_WEB_SECRET`, `AGENT_MARKET_CORS_ORIGIN` | | [.env.example](../.env.example) 참고 |

## Tool 목록

이름과 입출력은 **03 MCP Tools Spec — Step 1**을 따른다. 읽기 tool은 승인 없이 호출할 수 있다. 쓰기 tool은 전부 멱등하며 `requestId`(UUID)를 넘기면 재시도해도 중복 생성되지 않는다. 생략하면 어댑터가 호출마다 새 키를 만든다. 스펙의 "authenticated userId"는 tool 인자가 아니라 토큰 바인딩에서 온다. Agent가 다른 사용자를 지정할 수 없다.

### 스펙 tool (7)

| tool | scope | 입력 | 출력 |
| --- | --- | --- | --- |
| `get_category_schema` | read | `category` | `requiredFields`, `optionalFields`, `questionHints`, `minimumPurchaseConditions` |
| `create_listing_draft` | listing:write | `category`, `model`(또는 `productName`), `priceKrw`, `freeText`(→description), `images?`, 선택 구조화 필드 | `draftId`, `structuredFields`, `missingFields`, `nextQuestions`, `publishable`, `reviewRequired: true`, `humanApprovalRequired`, `nextAction`, `draft` |
| `update_listing_draft` | listing:write | `draftId`, `patch{...}` | 위와 같음 + `updatedDraft` |
| `create_purchase_request_draft` | purchase:write | `category?`, `naturalLanguageRequest?`, `knownConstraints{category, modelQuery, maxBudgetKrw, storageGb, conditionPreferences}` | `requestId`, `structuredConditions`, `missingFields`, `nextQuestions`, `readyForConfirmation`, `humanApprovalRequired`, `nextAction`, `purchaseRequest` |
| `update_purchase_request_draft` | purchase:write | `requestId`, `patch{...}` | 위와 같음 + `updatedRequest` |
| `search_listings` | search | `purchaseRequestId` | `summary{total, MATCH, NEEDS_CONFIRMATION, EXCLUDED, ruleVersion}`, `results: SearchResult[]` (각 후보에 `listing`, `matchedFields`, `unmetFields`, `missingFields`) |
| `get_listing` | read | `listingId` | `Listing` (구조화 필드 + `images`) |

`nextQuestions`는 비어 있는 항목에 대한 질문을 스펙 우선순위로 만든다. 판매: category → model → priceKrw → storageGb → condition → accessories. 구매: category → maxBudgetKrw → modelQuery → storageGb. 백엔드는 값을 추정하지 않으므로 Agent가 사용자에게 묻고 `update_*`로 채운다.

### 보조 tool (6, 모두 read)

| tool | 설명 |
| --- | --- |
| `whoami` | 대리하는 사용자, 토큰 이름, scope |
| `get_market_guide` | 할 수 있는 일·없는 일, 판매·구매 흐름, 승인 지점. 가장 먼저 호출 |
| `browse_listings` | 구매 조건 없이 ACTIVE 매물 텍스트 검색 (시세 파악용) |
| `list_my_listing_drafts` | 내 판매 초안 + `nextAction` |
| `list_my_listings` | 내 매물 (ACTIVE/INACTIVE) |
| `list_my_purchase_requests` | 내 구매 조건 + `nextAction` |

tool로 노출하지 않는 것: 게시(`publish`), 확정(`confirm`), 비활성화(`deactivate`), 토큰 발급·폐기. 서버도 Agent면 403으로 거부한다. Step 2 tool(`public_demand`, `browse_buyer_demand`, `watch_listings`, `notify_match`)은 없다.

## 승인 지점 (스펙 3절)

| 시점 | 누가 | 어디서 | Agent에게 보이는 신호 |
| --- | --- | --- | --- |
| Agent 연결 | 사용자 | Web (토큰 발급) | 토큰 없이는 연결 자체가 안 됨 |
| 판매글 게시 | 판매자 | Web → `POST .../publish` | `publishable: true`, `humanApprovalRequired: true`, `nextAction`에 게시 안내 |
| 구매 조건 확정·검색 | 구매자 | Web → `POST .../confirm` 후 검색 | `readyForConfirmation: true`, `nextAction`에 확정 안내. 확정 전 `search_listings`는 `INVALID_STATE` |
| 권한 확대 | 사용자 | Web (새 토큰) | 없는 scope의 tool은 목록에 없음. `whoami`로 현재 권한 확인 |
| 연결 해제 | 사용자 | Web (토큰 폐기) | 다음 요청부터 401 |

쓰기 tool 응답에는 항상 `humanApprovalRequired`와 `nextAction`이 들어간다. Agent는 `nextAction` 문장을 사용자에게 그대로 전달하면 된다.

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

code 종류: `VALIDATION_ERROR`, `INVALID_STATE`, `FORBIDDEN`(사람 전용 또는 scope 부족), `UNAUTHORIZED`(토큰 문제), `NOT_FOUND`, `TIMEOUT`, `NETWORK_ERROR`. 뒤의 둘만 `retryable: true`.

`search_listings` 응답에는 `summary`(MATCH / NEEDS_CONFIRMATION / EXCLUDED 개수)와 `results`가 함께 온다. `NEEDS_CONFIRMATION`은 매물 정보가 없어 판단할 수 없다는 뜻이며 적합으로 추정하면 안 된다.

## 테스트 (05 Acceptance Spec 대응)

`test/mcp.test.js`는 AC-01~05, 07을 MCP 경로로 검증한다. AC-05의 매칭 규칙 자체는 Search & Matching 영역이라 결과 형식만 확인하고, AC-06(결과 화면)은 Web 영역이다.

```sh
node --test                    # 전체 24개
node --test test/auth.test.js         # 토큰 발급·폐기·만료, scope, strict 모드
node --test test/mcp.test.js          # stdio E2E (demo 모드)
node --test test/mcp-remote.test.js   # strict 백엔드 + 원격 MCP E2E, 폐기·scope·429
```

E2E는 인메모리 API를 띄우고 실제 MCP 프로세스/HTTP 서버를 SDK 클라이언트로 호출한다. Claude Desktop이나 원격 커넥터가 하는 것과 같은 경로이므로 이 테스트가 통과하면 실제 연결도 동작한다.

## Web(프론트)에서 해야 할 것

- 설정 화면: 토큰 이름과 scope 체크박스 → `POST /api/agent-tokens` → 토큰 원문을 한 번 보여주고 복사 버튼
- 토큰 목록: prefix, scope, 마지막 사용, 폐기 버튼 → `DELETE /api/agent-tokens/:id`
- Web 서버는 API 호출 시 `X-Web-Secret` 헤더를 붙인다 (strict 모드)

## Step 2에서 추가될 것

공개 구매 수요 조회·응답, 신규 매물 감시 등록, 가격·시간 제안, 가예약, 사람 승인 요청 tool. 전부 같은 어댑터 패턴으로 추가하고 새 scope(`offer:write`, `hold:write`)를 붙인다.
