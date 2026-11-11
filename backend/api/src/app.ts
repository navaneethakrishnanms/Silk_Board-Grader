import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { buildRouter } from './routes/index.js';

export function createApp(opts: { authRateLimit?: number } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cors({
    origin: (origin, cb) => cb(null, !origin || env.corsOrigins.includes(origin)),
    credentials: true,
  }));
  app.use(express.json({ limit: '2mb' }));
  if (!env.isTest) app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url?.includes('/files/') ?? false } }));
  app.use(env.API_PREFIX, buildRouter(opts));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
