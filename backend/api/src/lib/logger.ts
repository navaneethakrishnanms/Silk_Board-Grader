import pino from 'pino';
import { env } from '../config/env.js';

export const logger = pino({
  level: env.isTest ? 'silent' : env.isProd ? 'info' : 'debug',
  redact: ['req.headers.authorization', 'password', 'passwordHash'],
});
