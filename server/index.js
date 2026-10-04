import { createApiServer } from './app.js';

const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || '127.0.0.1';
const server = createApiServer();
server.listen(port, host, () => {
  const mode = process.env.AGENT_MARKET_AUTH_MODE || 'demo';
  console.log(`Agent Market Step 1 API listening at http://${host}:${port} (auth mode: ${mode})`);
  if (mode === 'demo') console.log('demo 모드: X-User-Id 헤더를 그대로 믿습니다. 외부에 노출하려면 AGENT_MARKET_AUTH_MODE=strict 로 실행하세요.');
});

const shutdown = () => {
  server.close(() => { server.store.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 10_000).unref();
};
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, shutdown);
