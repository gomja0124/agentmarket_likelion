import { startDeployment } from './app.js';

const deployment = await startDeployment();
console.log(`Agent Market listening on ${deployment.gateway.address().address}:${deployment.gateway.address().port}`);
let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  const timer = setTimeout(() => process.exit(1), 10_000);
  timer.unref();
  await deployment.close();
  process.exit(0);
});
