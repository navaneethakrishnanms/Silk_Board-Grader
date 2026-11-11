import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { recoverInterruptedJobs } from './services/gradingService.js';
import { ensureDir } from './services/storageService.js';

async function main() {
  await Promise.all(['originals', 'derived', 'reports', 'models'].map((d) => ensureDir(d)));
  await prisma.$connect();
  const n = await recoverInterruptedJobs();
  if (n) logger.warn(`${n} interrupted grading job(s) reset to READY_TO_GRADE`);
  const app = createApp();
  app.listen(env.PORT, () => {
    logger.info(`SilkGrade API on http://localhost:${env.PORT}${env.API_PREFIX}  storage=${env.storageRoot}  engine=${env.ENGINE_URL}`);
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'API failed to start');
  process.exit(1);
});
