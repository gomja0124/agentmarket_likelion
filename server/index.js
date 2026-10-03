import { createApiServer } from './app.js';

const port = Number(process.env.PORT || 8080);
const server = createApiServer();
server.listen(port, '127.0.0.1', () => {
  console.log(`Agent Market Step 1 API listening at http://127.0.0.1:${port}`);
  console.log('Demo identity headers are for local use only; this server has no production authentication.');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => {
    server.store.close();
    process.exit(0);
  }));
}
