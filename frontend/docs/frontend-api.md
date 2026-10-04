# Frontend API Interface 초안

현재 백엔드와 연결되는 프론트엔드 인터페이스입니다. 공통 계약은 [백엔드 API](../../backend/docs/backend-api.md)와 [JSON Schema](../../backend/schemas/step1.schema.json)를 참고하세요. 현재 서버의 사용자 헤더는 로컬 데모용이며, 배포 전 실제 인증 연결이 필요합니다. 시간은 ISO 8601, ID는 UUID를 사용합니다.

## 필드

| 객체 | 주요 필드 |
| --- | --- |
| ListingDraft | `id`, `sellerId`, `source: AGENT/HUMAN`, `title`, `description`, `category: PHONE/TABLET`, `brand`, `model`, `storageGb`, `condition`, `accessories`, `priceKrw`, `images`, `missingFields`, `nextQuestions`, `status`, `createdAt`, `updatedAt` |
| Listing | Draft 필드, `draftId`, `status: ACTIVE/INACTIVE`, `createdAt`, `updatedAt`, `publishedAt` |
| PurchaseRequest | `id`, `buyerId`, `source`, `category`, `modelQuery`, `maxBudgetKrw`, `storageGb`, `conditionPreferences`, `missingFields`, `nextQuestions`, `status: DRAFT/CONFIRMED`, `createdAt`, `updatedAt` |
| SearchResult | `id`, `purchaseRequestId`, `listingId`, `listing`(선택), `matchStatus: MATCH/NEEDS_CONFIRMATION/EXCLUDED`, `matchedFields`, `unmetFields`, `missingFields`, `ruleVersion`, `createdAt` |

## 제안 경로

| 동작 | 메서드·경로 | 응답 |
| --- | --- | --- |
| 활성 매물 목록 | `GET /api/listings?status=ACTIVE` | `Listing[]` |
| 매물 상세 | `GET /api/listings/:id` | `Listing` |
| 내 매물 | `GET /api/listings/mine` | `Listing[]` |
| 내 초안 | `GET /api/listing-drafts/mine` | `ListingDraft[]` |
| 게시물 수정 시작 | `POST /api/listings/:id/drafts` | 새 `ListingDraft` |
| 초안 생성·수정 | `POST /api/listing-drafts`, `PATCH /api/listing-drafts/:id` | `ListingDraft` |
| **사람 게시 승인** | `POST /api/listing-drafts/:id/publish` | `Listing` |
| 매물 비활성화 | `POST /api/listings/:id/deactivate` | `Listing` |
| 구매 조건 생성·수정 | `POST /api/purchase-requests`, `PATCH /api/purchase-requests/:id` | `PurchaseRequest` |
| 내 구매 조건 | `GET /api/purchase-requests/mine` | `PurchaseRequest[]` |
| **사람 조건 확정** | `POST /api/purchase-requests/:id/confirm` | `PurchaseRequest` |
| **사람 검색 실행** | `POST /api/purchase-requests/:id/search` | `SearchResult[]` |

서버는 인증된 사용자만 게시·확정·검색을 실행할 수 있어야 합니다. 프론트엔드 버튼 비활성화만으로 권한을 보장할 수 없습니다. 타인 소유는 403, 잘못된 상태 전이는 409, 필수값 누락은 422로 응답합니다. 오류 본문은 최소 `{ "message": "..." }`를 기대합니다.

현재 사진은 데모에서 Data URL로 보관합니다. 실제 서버 연동 시 업로드 방식과 이미지 URL 계약을 별도로 합의해야 합니다. `SearchResult.listing` 포함 여부도 합의가 필요하며, 포함하지 않는다면 목록 조회로 연결합니다.

게시된 매물의 수정 시작은 기존 매물을 바로 PATCH하지 않고 새 ListingDraft를 만드는 동작입니다. 재게시 때 매물 ID 유지 여부와 기존 초안·매물 처리 규칙은 백엔드 State Rules에 맞춰 확정해야 합니다. 데모에서는 원본 매물을 게시 전까지 유지하고, 새 초안을 게시할 때 같은 ID의 매물을 교체합니다.
