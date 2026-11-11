import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { dataMode, prisma } from './lib/prisma.js';
import { DEMO_USERS, runSeed } from './seed.js';
import { recoverInterruptedJobs } from './services/gradingService.js';
import { ensureDir } from './services/storageService.js';

async function main() {
  await Promise.all(['originals', 'derived', 'reports', 'models'].map((d) => ensureDir(d)));
  await prisma.$connect();
  const n = await recoverInterruptedJobs();
  if (n) logger.warn(`${n} interrupted grading job(s) reset to READY_TO_GRADE`);
  const app = createApp();
  app.listen(env.PORT, () => {
    logger.info(`SilkGrade API on http://localhost:${env.PORT}${env.API_PREFIX}  mode=${dataMode}  storage=${env.storageRoot}  engine=${env.ENGINE_URL}`);
  });
  if (dataMode === 'memory') {
    logger.warn('DEMO MODE (DATA_MODE=memory): data is kept in memory and is lost on restart');
    await runSeed({ demo: true, engineWaitMs: 90_000 });
    logger.info(`demo logins: ${DEMO_USERS.map((u) => `${u.email} / ${u.password}`).join('  ·  ')}`);
  }
}

main().catch((err) => {
  logger.fatal({ err }, 'API failed to start');
  process.exit(1);
});
