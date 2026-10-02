# Frontend API Interface 초안

백엔드 계약이 아직 없는 상태에서 프론트엔드가 기대하는 임시 인터페이스입니다. 공통 Schema와 인증 방식을 합의한 후 변경합니다. 시간은 ISO 8601, ID는 UUID를 사용합니다.

## 필드

| 객체 | 주요 필드 |
| --- | --- |
| ListingDraft | `id`, `sellerId`, `source: AGENT/HUMAN`, `title`, `description`, `category: PHONE/TABLET`, `brand`, `model`, `storageGb`, `condition`, `accessories`, `priceKrw`, `images`, `missingFields`, `status` |
| Listing | Draft 필드, `draftId`, `status: ACTIVE/INACTIVE`, `publishedAt` |
| PurchaseRequest | `id`, `buyerId`, `source`, `category`, `modelQuery`, `maxBudgetKrw`, `storageGb`, `conditionPreferences`, `status: DRAFT/CONFIRMED` |
| SearchResult | `id`, `listingId`, `listing`, `matchStatus: MATCH/NEEDS_CONFIRMATION/EXCLUDED`, `matchedFields`, `unmetFields`, `missingFields`, `ruleVersion` |

## 제안 경로

| 동작 | 메서드·경로 | 응답 |
| --- | --- | --- |
| 활성 매물 목록 | `GET /api/listings?status=ACTIVE` | `Listing[]` |
| 매물 상세 | `GET /api/listings/:id` | `Listing` |
| 내 매물 | `GET /api/listings/mine` | `Listing[]` |
| 내 초안 | `GET /api/listing-drafts/mine` | `ListingDraft[]` |
| 초안 생성·수정 | `POST /api/listing-drafts`, `PATCH /api/listing-drafts/:id` | `ListingDraft` |
| **사람 게시 승인** | `POST /api/listing-drafts/:id/publish` | `Listing` |
| 매물 비활성화 | `POST /api/listings/:id/deactivate` | `Listing` |
| 구매 조건 생성·수정 | `POST /api/purchase-requests`, `PATCH /api/purchase-requests/:id` | `PurchaseRequest` |
| **사람 조건 확정** | `POST /api/purchase-requests/:id/confirm` | `PurchaseRequest` |
| **사람 검색 실행** | `POST /api/purchase-requests/:id/search` | `SearchResult[]` |

서버는 인증된 사용자만 게시·확정·검색을 실행할 수 있어야 합니다. 프론트엔드 버튼 비활성화만으로 권한을 보장할 수 없습니다. 타인 소유는 403, 잘못된 상태 전이는 409, 필수값 누락은 422로 응답합니다. 오류 본문은 최소 `{ "message": "..." }`를 기대합니다.

현재 사진은 데모에서 Data URL로 보관합니다. 실제 서버 연동 시 업로드 방식과 이미지 URL 계약을 별도로 합의해야 합니다. `SearchResult.listing` 포함 여부도 합의가 필요하며, 포함하지 않는다면 목록 조회로 연결합니다.
