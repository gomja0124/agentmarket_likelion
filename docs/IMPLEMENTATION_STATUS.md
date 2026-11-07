# Agent Market 구현 현황

2026-10-30 기준. 기준 문서: Notion의 개발 시작 최종안, 01~06 세부 Spec. 작업 기준 브랜치: `integration/buyer-features`.

| 요구사항 | 현재 상태 | 확인 근거 |
| --- | --- | --- |
| Step 1 판매 Agent 초안 → 사람 게시 | 구현 | MCP·API·Web, 사람 전용 publish와 소유권 검사, 통합 테스트 |
| Step 1 구매 조건 구조화 → 사람 검색 승인 | 구현 | 자연어 규칙 파서, 비공개 요청, confirm/search 승인 검사, 통합 테스트 |
| Step 1 자체 DB 12개 이상·Rule-based Matching | 구현 | PHONE/TABLET 시드 12개, MATCH/NEEDS_CONFIRMATION/EXCLUDED, 통합 테스트 |
| Step 1 외부 MCP 연결 | 로컬·원격 실행 경로 구현 | stdio·HTTP MCP, Web 토큰 발급·폐기 화면, 권한 테스트. 실제 Agent 앱 등록은 환경별 설정 필요 |
| Step 2-A 공개 수요 초안·사람 공개·상태·만료 | 구현 | `003_reverse_market.sql`, Web·API, 통합 테스트 |
| Step 2-B 판매자 역방향 매칭 | 구현 | 본인 ACTIVE 매물 기준 조회, 공개 필드만 응답, Web·API |
| Step 2-C 연결 요청·구매자 수락/거절 | 구현 | MATCH만 요청 가능, 중복 방지, 사람 전용 상태 변경, Web·API |
| Step 2-D 새 매물/수요 매칭 알림 | 기본 흐름 구현 | ACTIVE 등록 시 양쪽 알림, 조합 중복 방지, 일시정지·종료·만료 제외 |
| Step 2 MCP 초안·탐색·알림 | 선택 실행 경로 구현 | `AGENT_MARKET_ENABLE_STEP2=1`; 공개·요청·수락은 Web 전용 |

## 남은 배포 작업

- Web 로그인 세션과 API 중계 서버가 없다. 현재 Web은 로컬 demo 인증 모드에서 동작하며, strict 모드는 서버가 `X-Web-Secret`을 보관하는 중계 계층과 실제 사용자 인증이 필요하다.
- 저장소는 SQLite 프로토타입이다. 운영 DB로 PostgreSQL을 쓰려면 어댑터와 마이그레이션을 따로 구현해야 한다.
- 알림은 API 조회 방식이다. 푸시·이메일·백그라운드 작업자는 없다. 만료 상태는 관련 API 접근 시 갱신된다.
- 연결 수락 후 연락 방법·거래 진행, 결제·배송은 문서의 제외 범위다.

## 검증

`npm test`는 Step 1/2 API, MCP, Web 어댑터 테스트를 실행한다. 실제 브라우저에서 구매자 조건 확정 → 공개 수요 게시 → 판매자 역방향 탐색 → 연결 요청 → 구매자 수락을 확인했다. 재현 절차는 [Step 2 시연 가이드](../backend/docs/step2-api.md)에 있다.
