import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const API_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  API_PREFIX: z.string().default('/api/v1'),
  DATA_MODE: z.enum(['mysql', 'memory']).default('mysql'),
  DATABASE_URL: z.string().default(''),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),
  FILE_URL_SECRET: z.string().min(16),
  FILE_URL_TTL_SECONDS: z.coerce.number().default(3600),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  STORAGE_ROOT: z.string().default('../../storage'),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  S3_ENDPOINT: z.string().default(''),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('silkgrade'),
  S3_ACCESS_KEY: z.string().default(''),
  S3_SECRET_KEY: z.string().default(''),
  S3_PREFIX: z.string().default(''),
  S3_FORCE_PATH_STYLE: z.string().default('true'),
  MAX_UPLOAD_MB: z.coerce.number().default(40),
  ENGINE_URL: z.string().default('http://127.0.0.1:8001'),
  ENGINE_INTERNAL_TOKEN: z.string().default(''),
  ENGINE_TIMEOUT_MS: z.coerce.number().default(60000),
  LAB_NAME: z.string().default('Bangalore Silk Board — Silk Testing Laboratory'),
  SEED_ADMIN_EMAIL: z.string().default('admin@silkgrade.local'),
  SEED_ADMIN_PASSWORD: z.string().default('Admin@12345'),
  SEED_DEMO: z.string().default('true'),
});

const parsed = schema
  .refine((v) => v.DATA_MODE === 'memory' || v.DATABASE_URL.length > 0, { message: 'DATABASE_URL is required when DATA_MODE=mysql', path: ['DATABASE_URL'] })
  .safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const e = parsed.data;
export const env = {
  ...e,
  isProd: e.NODE_ENV === 'production',
  isTest: e.NODE_ENV === 'test',
  corsOrigins: e.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  storageRoot: path.isAbsolute(e.STORAGE_ROOT) ? e.STORAGE_ROOT : path.resolve(API_ROOT, e.STORAGE_ROOT),
  apiRoot: API_ROOT,
};
