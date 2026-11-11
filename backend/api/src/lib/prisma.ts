import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';
import { createMemoryPrisma } from './memoryDb.js';

/** DATA_MODE=mysql (default) uses the real Prisma client; DATA_MODE=memory uses the
 *  in-memory implementation (demo mode — data resets on restart). */
export const dataMode = env.DATA_MODE;

export const prisma: PrismaClient =
  dataMode === 'memory'
    ? (createMemoryPrisma() as unknown as PrismaClient)
    : new PrismaClient({ log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'] });
