# Web 로그인과 API 중계

`backend/web/`은 같은 출처에서 정적 Web과 `/api/*`를 제공한다. 로그인된 사용자만 API 중계를 이용할 수 있다. Web 서버는 브라우저가 보낸 `X-User-Id`, `X-Web-Secret`, `Authorization`을 전달하지 않고, 서버가 검증한 사용자 ID와 `AGENT_MARKET_WEB_SECRET`을 strict API에 붙인다. 외부 Agent는 별도 MCP Bearer 토큰 경로를 사용한다.

## 로컬 실행

API와 Web이 **같은** `AGENT_MARKET_DB_PATH`를 사용해야 한다. Node.js 22.5 이상이 필요하다. 두 터미널에서 실행한다.

```sh
export AGENT_MARKET_DB_PATH=/absolute/path/agent-market.sqlite
export AGENT_MARKET_WEB_SECRET='<16자 이상 임의 비밀값>'
AGENT_MARKET_AUTH_MODE=strict npm run start:api
```

```sh
export AGENT_MARKET_DB_PATH=/absolute/path/agent-market.sqlite
export AGENT_MARKET_WEB_SECRET='<API와 같은 비밀값>'
export AGENT_MARKET_WEB_URL=http://127.0.0.1:4173
export AGENT_MARKET_API_URL=http://127.0.0.1:8080
npm run start:web
```

초기 계정은 관리자가 별도 터미널에서 발급한다. 새 사용자 ID를 만들거나, 마지막 인자에 기존 사용자 UUID를 넣어 샘플 판매자 등의 데이터에 연결한다. 비밀번호는 명령 실행 시 한 번만 출력된다. 기존 사용자 ID에 다시 발급하면 이전 Web 세션이 모두 폐기된다.

```sh
AGENT_MARKET_DB_PATH=/absolute/path/agent-market.sqlite \
  node backend/scripts/create-web-user.js buyer1 '구매자 1'
```

브라우저에서는 `http://127.0.0.1:4173`으로 접속한다. 로그인 화면으로 이동한 뒤 계정 정보를 입력한다. 공개 환경에서는 HTTPS 주소를 `AGENT_MARKET_WEB_URL`로 설정해야 한다.

## 인증 경계

- 비밀번호는 무작위 salt를 사용한 scrypt 해시로 저장한다. Web 세션은 12시간 유효하고 DB에는 무작위 세션 원문 대신 SHA-256 해시만 저장한다.
- HTTPS에서는 `__Host-` 접두사, `Secure`, `HttpOnly`, `SameSite=Strict` 쿠키를 사용한다. 로컬 HTTP는 별도 개발 쿠키 이름을 쓴다. 변경 요청은 설정한 Web origin과 CSRF 토큰을 모두 확인한다.
- 로그인 시도는 Web 프로세스별 IP와 로그인 이름 기준으로 제한한다. 여러 Web 복제본을 운영한다면 중앙 저장소를 이용한 제한으로 바꿔야 한다.
- 공개 회원가입·이메일 인증·비밀번호 찾기 UI는 아직 없다. 초기에는 관리자가 계정을 발급하는 방식이다. 정확한 사용자 가입 방식은 제품 결정이 필요하다.
- API의 `8080` 포트는 공개 인터넷으로 전달하지 않는다. Docker Compose는 Web/API/MCP를 모두 localhost에만 노출하고, 외부 HTTPS 프록시가 Web과 `/mcp`만 노출하도록 준비한다.

## Docker Compose

`backend/.env.example`을 `.env`로 복사해 실제 비밀값·HTTPS Web URL을 채운 뒤 `cd backend && docker compose up -d --build`를 실행한다. Web `4173`, API `8080`, MCP `8090`은 호스트의 `127.0.0.1`에만 바인딩된다. TLS 리버스 프록시에서 `/`는 Web, `/mcp`는 MCP로 전달한다. [Caddy 설정 예시](../Caddyfile.example)가 있으며 실제 도메인·DNS·80/443 포트는 배포 환경에서 설정해야 한다. Web 컨테이너에서 계정을 발급할 때는 `docker compose exec web node backend/scripts/create-web-user.js <로그인 이름> <표시 이름> [기존 사용자 UUID]`를 사용한다. SQLite 파일은 공유 볼륨에 보관한다.

운영 데이터의 일관된 스냅샷은 `docker compose exec web node backend/scripts/backup-db.js /data/backups`로 만들 수 있다. 스크립트는 SQLite `VACUUM INTO`로 별도 파일을 생성하고 `integrity_check`를 실행한다. 백업 파일에는 계정과 거래 데이터가 포함되므로 접근 제어된 별도 저장소로 이동하고 주기·보존 기간·복구 시험을 운영 환경에 맞게 설정해야 한다. [SQLite 공식 문서](https://www.sqlite.org/lang_vacuum.html)도 참고한다.

현재 구성은 서버·컨테이너 설정까지다. 공개 도메인, TLS 프록시, 운영 백업, 외부 Agent 클라이언트 연결과 실제 계정 UAT는 별도로 완료해야 한다.

설계 참고: [OWASP 세션 관리](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [OWASP CSRF 방어](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html), [OWASP 비밀번호 저장](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
