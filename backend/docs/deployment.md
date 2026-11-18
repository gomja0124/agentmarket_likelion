# 단일 서비스 배포 (Railway)

Web·strict API·HTTP MCP가 같은 SQLite 파일을 사용하는 배포 경로다. 저장소 루트 `Dockerfile`이 단일 컨테이너로 세 서버를 실행한다. 공개 `PORT`에는 Web과 `/mcp`만 연결된다. API는 컨테이너 내부 `127.0.0.1`에서만 수신한다. [Railway 볼륨](https://docs.railway.com/volumes/reference)은 서비스 하나에 붙으므로 이 구성이 SQLite 공유에 맞다.

## 공개 배포 순서

1. Railway 계정에 GitHub를 연결하고 이 저장소 `dokyeong-merge` 브랜치를 서비스 소스로 선택한다. Dockerfile은 저장소 루트에 있다.
2. 서비스에 영속 볼륨을 추가하고 `/data`에 마운트한다. 볼륨이 root 소유로 붙는 환경을 위해 이미지 시작 스크립트가 `/data`를 `node` 사용자로 넘긴 뒤 비특권 사용자로 실행한다.
3. 서비스 변수 `AGENT_MARKET_WEB_SECRET`에 무작위 32바이트 이상의 값을 넣는다. 예: 로컬에서 `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. 이 값을 저장소에 커밋하거나 브라우저에 노출하지 않는다. `AGENT_MARKET_ENABLE_STEP2=1`은 Step 2 MCP 도구를 공개할 때만 설정한다.
4. Public Networking에서 Railway 도메인을 생성한다. `RAILWAY_PUBLIC_DOMAIN`이 런타임에 제공되면 앱은 `https://<도메인>`을 Web 주소로 사용한다. 사용자 지정 도메인을 쓰면 `AGENT_MARKET_WEB_URL=https://<도메인>`을 명시한다.
5. 서비스 health check 경로를 `/healthz`로 설정하고 배포한다. `https://<도메인>/healthz`가 `web`, `api`, `mcp`를 표시해야 한다. `/api/me`는 로그인 없이 401, `/mcp`는 토큰 없이 401이어야 한다.
6. Railway CLI로 `railway ssh -- node /app/backend/scripts/create-web-user.js <로그인 이름> '<표시 이름>'`을 실행해 초기 계정을 발급한다. 이 명령은 비밀번호를 한 번만 출력한다. 웹에서 로그인한 뒤 Agent 화면에서 필요한 권한의 토큰을 발급한다. [Railway SSH 사용법](https://docs.railway.com/cli/ssh)을 참고한다.
7. 외부 Agent의 MCP 설정에 `https://<도메인>/mcp`와 `Authorization: Bearer <발급 토큰>`을 넣고 `tools/list` 및 구매 초안 작성 등 허용된 도구 호출을 검증한다. 토큰을 유출했으면 Web에서 폐기한다.

배포 계정과 도메인에서 실제 서비스를 만든 뒤에만 공개 배포가 완료된다. `npm test`의 `deployment.test.js`는 같은 공개 포트에서 Web 로그인 → strict API → 토큰 발급 → MCP 도구 조회를 검증한다.

## 데이터 보존

SQLite 경로는 `/data/agent-market.sqlite`다. Railway 볼륨의 자동 백업을 켜고, 별도로 `node /app/backend/scripts/backup-db.js /data/backups`로 일관된 스냅샷을 만들 수 있다. 백업 파일을 볼륨 밖으로 내려받아 복구 시험을 해야 한다. 여러 인스턴스로 수평 확장하려면 SQLite를 관리형 DB로 이전해야 한다.

Railway는 [무료 요금제에도 볼륨을 제공하지만 용량과 사용량 제한이 있고](https://docs.railway.com/pricing/plans), 서비스 실행 비용이 발생할 수 있다. 실제 요금제와 사용량은 서비스 생성 전에 확인한다.
