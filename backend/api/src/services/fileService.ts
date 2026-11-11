/** Signed, expiring file URLs: `/api/v1/files/<token>`.
 *  token = base64url(JSON{p: storage-relative path, e: expiry}) + "." + HMAC-SHA256.
 *  Signed URLs let <img src> work without an Authorization header. */
import crypto from 'node:crypto';
import { env } from '../config/env.js';

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export function signPath(rel: string, ttlSeconds = env.FILE_URL_TTL_SECONDS): string {
  const payload = b64url(JSON.stringify({ p: rel, e: Math.floor(Date.now() / 1000) + ttlSeconds }));
  const sig = crypto.createHmac('sha256', env.FILE_URL_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function fileUrl(rel: string | null | undefined, ttlSeconds?: number): string | null {
  if (!rel) return null;
  return `${env.API_PREFIX}/files/${signPath(rel, ttlSeconds)}`;
}

export function verifyToken(token: string): string | null {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = crypto.createHmac('sha256', env.FILE_URL_SECRET).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const { p, e } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof p !== 'string' || typeof e !== 'number' || e < Date.now() / 1000) return null;
    return p;
  } catch {
    return null;
  }
}
