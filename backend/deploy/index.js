import { startDeployment } from './app.js';
import { scheduleBackups } from './backup.js';

const deployment = await startDeployment();
const backups = scheduleBackups({ source: process.env.AGENT_MARKET_DB_PATH || '/data/agent-market.sqlite',
  destinationDirectory: process.env.AGENT_MARKET_BACKUP_DIR || '/backups',
  intervalHours: Number(process.env.AGENT_MARKET_BACKUP_INTERVAL_HOURS || 24),
  beforeBackup: () => deployment.api.store.purgeOldConnectionMessages(
    new Date(Date.now() - 30 * 86_400_000).toISOString()) });
console.log(`Agent Market listening on ${deployment.gateway.address().address}:${deployment.gateway.address().port}`);
let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  backups.stop();
  const timer = setTimeout(() => process.exit(1), 10_000);
  timer.unref();
  await deployment.close();
  process.exit(0);
});
