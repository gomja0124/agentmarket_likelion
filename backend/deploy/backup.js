import { createBackup } from '../scripts/backup-db.js';

export function scheduleBackups({ source, destinationDirectory, intervalHours = 24, beforeBackup, log = console } = {}) {
  if (!source || !destinationDirectory) throw new Error('백업 원본과 저장 위치가 필요합니다.');
  if (!Number.isFinite(intervalHours) || intervalHours < 1 || intervalHours > 168) {
    throw new Error('백업 간격은 1~168시간이어야 합니다.');
  }
  const run = () => {
    try {
      beforeBackup?.();
      const result = createBackup(source, destinationDirectory);
      log.info?.(`DB 백업 완료: ${result.destination} (${result.bytes} bytes)`);
      return result;
    } catch (error) {
      log.error?.(`DB 백업 실패: ${error.message}`);
      return null;
    }
  };
  const initial = run();
  const timer = setInterval(run, intervalHours * 60 * 60 * 1000);
  timer.unref();
  return { initial, run, stop: () => clearInterval(timer) };
}
