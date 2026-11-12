# AWS EC2 배포 경로

2026-11-13 기준 서울 리전의 `gomja-market-backend` EC2 인스턴스에서 `dokyeong-merge`의 `47ff0c6`을 배포했다. 공개 주소 `https://gomja-market.store`의 첫 화면·회원가입 페이지·`/healthz` 응답과 앱 컨테이너의 Healthy 상태를 확인했다. 서버의 비추적 `compose.production.yml` 오버라이드는 보존한다.

## 필요한 환경

- 도메인의 DNS A 레코드가 EC2의 안정적인 공개 IP(예: Elastic IP)를 가리켜야 한다. Cloudflare에서 DNS를 관리한다면 Route 53을 거치지 않아도 된다.
- EC2 인바운드 보안 그룹에서 80/443을 공개하고 22는 관리자 접속 주소로 제한한다. 8080/8090은 공개하지 않는다. [AWS 보안 그룹 설명](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/security-group-rules-reference.html).
- EC2에 Docker Engine과 Compose plugin이 설치되어 있어야 한다. Docker 데이터 디렉터리가 영속 EBS 볼륨에 있는지 확인한다. [EBS 데이터 보존](https://docs.aws.amazon.com/ebs/latest/userguide/EBSFeatures.html).

## 배포

1. EC2에서 이 저장소의 `dokyeong-merge` 브랜치를 체크아웃한다.
2. 저장소 루트에서 `.env.aws.example`을 `.env`로 복사하고 `AGENT_MARKET_DOMAIN`과 `AGENT_MARKET_WEB_SECRET`을 실제 값으로 채운다. `.env`는 Git에 넣지 않는다.
3. `docker compose -f compose.aws.yml up -d --build`를 실행한다. `app` 한 컨테이너가 Web·strict API·MCP를 실행하고 SQLite는 `market-data` 볼륨에 저장된다. Caddy가 80/443에서 TLS를 처리한다.
4. DNS가 연결되면 `https://<도메인>/healthz`에서 세 서비스의 정상 상태를 확인한다. 비로그인 상태에서 `/`는 서비스 소개 화면(200), `/register`는 회원가입 화면, `/login`은 계정 입력 화면을 보여줘야 한다. `/api/me`와 `/mcp`는 인증 없이 각각 401이어야 한다. 가입 또는 로그인 후 `/`는 실제 앱을 보여준다. Caddy는 도메인과 80/443이 준비되면 공개 인증서를 자동 발급한다. [Caddy HTTPS 설명](https://caddyserver.com/docs/quick-starts/reverse-proxy).
5. `docker compose -f compose.aws.yml exec app node /app/backend/scripts/create-web-user.js <로그인 이름> '<표시 이름>'`으로 초기 계정을 발급한다. 웹 로그인 후 Agent 화면에서 필요한 권한의 토큰을 발급한다.
6. 외부 Agent에 `https://<도메인>/mcp`와 `Authorization: Bearer <발급 토큰>`을 등록하고 도구 목록·초안 작성·Web 사람 승인 경계를 실제 호출로 검증한다.

## 코드 업데이트 배포

1. EC2의 현재 체크아웃과 `git status`를 확인한 뒤 `dokyeong-merge`의 최신 커밋을 가져온다. 서버에서 직접 수정한 파일이 있다면 먼저 보존한다.
2. 현재 EC2에서는 저장소 루트에서 `sudo docker compose -f compose.aws.yml -f compose.production.yml up -d --build`를 실행한다. 서버 전용 `compose.production.yml`은 버전 관리 대상이 아니다. `market-data` 볼륨은 유지한다.
3. 비로그인 브라우저에서 `https://gomja-market.store/`가 서비스 소개 화면으로 열리는지 확인한다. `/register`는 회원가입 화면, `/login`은 로그인 화면이며, `/api/me`는 비로그인 상태에서 401이어야 한다. 가입 후 구매 조건을 정리해 당근 검색 링크가 열리는지도 확인한다.

AWS IAM 콘솔 비밀번호나 액세스 키를 애플리케이션 `.env`에 넣지 않는다. 앱 `.env`에는 도메인과 `AGENT_MARKET_WEB_SECRET` 등 Compose에서 요구하는 설정만 둔다. `.env`와 자격 증명 CSV는 Git 추적 대상에서 제외한다.

## 운영 확인

- `docker compose -f compose.aws.yml ps`에서 `app`과 `caddy`가 정상인지 본다. Caddy의 `/data`와 `/config`도 별도 볼륨에 보존한다.
- `docker compose -f compose.aws.yml exec app node /app/backend/scripts/backup-db.js /data/backups`로 SQLite 일관된 사본을 생성할 수 있다. 같은 EC2에만 두지 말고 별도 접근 제어된 저장소로 옮겨 복구 시험을 한다. AWS에서는 EBS 스냅샷이나 AWS Backup으로 볼륨 백업을 자동화할 수 있다. [AWS EBS 백업](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/storage_ebs.html).
- `AGENT_MARKET_WEB_SECRET`과 최초 계정 비밀번호, Agent 토큰은 공개 문서·Git·로그에 넣지 않는다.

공개 배포 완료 판정은 실제 HTTPS 주소에서 Web 로그인, API 데이터 저장, MCP 도구 호출과 토큰 폐기를 확인한 뒤에만 한다.
