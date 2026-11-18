import { createWebServer } from './app.js';

const server = createWebServer();
const host = process.env.WEB_HOST || '127.0.0.1';
const port = Number(process.env.WEB_PORT || 4173);
server.listen(port, host, () => console.log(`Agent Market Web listening at http://${host}:${port}`));
const shutdown = () => server.close(() => { server.store.close(); process.exit(0); });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, shutdown);
