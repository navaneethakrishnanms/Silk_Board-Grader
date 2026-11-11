/** `npm run seed` — seeds the MySQL database (see src/seed.ts). */
import { env } from '../src/config/env.js';
import { prisma } from '../src/lib/prisma.js';
import { DEMO_USERS, runSeed } from '../src/seed.js';

runSeed({ demo: env.SEED_DEMO === 'true', engineWaitMs: 5000 })
  .then(async () => {
    console.log(`seeded users: ${DEMO_USERS.map((u) => `${u.email} (${u.role})`).join(', ')}`);
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
