import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt, { type SignOptions } from 'jsonwebtoken';
import type { Role, UserDTO } from '@silkgrade/shared';
import type { User } from '@prisma/client';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { unauthorized } from '../utils/httpError.js';
import { audit } from './auditService.js';

interface TokenPayload {
  sub: string;
  role: Role;
  typ: 'access' | 'refresh';
  jti?: string;
}

export const hashPassword = (pw: string) => bcrypt.hash(pw, 12);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);
const hashJti = (jti: string) => crypto.createHash('sha256').update(jti).digest('hex');

const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

export function ttlSeconds(ttl: string): number {
  const m = /^(\d+)([smhd])?$/.exec(ttl.trim());
  if (!m) return 900;
  return Number(m[1]) * UNIT_SECONDS[m[2] ?? 's'];
}

/** Short-lived access token (stateless). */
export function signAccessToken(user: Pick<User, 'id' | 'role'>): { accessToken: string; expiresIn: number } {
  const expiresIn = ttlSeconds(env.JWT_ACCESS_TTL);
  const payload: TokenPayload = { sub: user.id, role: user.role as Role, typ: 'access' };
  return { accessToken: jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn } as SignOptions), expiresIn };
}

/** Access + refresh pair. The refresh token is recorded (hash of its id) so it can be revoked. */
export async function issueTokens(user: Pick<User, 'id' | 'role'>) {
  const jti = crypto.randomUUID();
  const refreshTtl = ttlSeconds(env.JWT_REFRESH_TTL);
  const payload: TokenPayload = { sub: user.id, role: user.role as Role, typ: 'refresh', jti };
  const refreshToken = jwt.sign(payload, env.JWT_REFRESH_SECRET, { expiresIn: refreshTtl } as SignOptions);
  await prisma.refreshToken.create({
    data: { userId: user.id, tokenHash: hashJti(jti), expiresAt: new Date(Date.now() + refreshTtl * 1000) },
  });
  return { ...signAccessToken(user), refreshToken };
}

function verify(token: string, secret: string, typ: TokenPayload['typ']): TokenPayload {
  try {
    const p = jwt.verify(token, secret) as TokenPayload;
    if (p.typ !== typ) throw new Error('wrong token type');
    return p;
  } catch {
    throw unauthorized(typ === 'access' ? 'Invalid or expired token' : 'Invalid or expired refresh token');
  }
}

export const verifyAccess = (token: string) => verify(token, env.JWT_ACCESS_SECRET, 'access');
export const verifyRefresh = (token: string) => verify(token, env.JWT_REFRESH_SECRET, 'refresh');

/** Rotate: the presented refresh token is revoked and a new pair issued.
 *  Re-use of an already revoked token revokes every session of that user (token theft). */
export async function rotateRefresh(refreshToken: string) {
  const p = verifyRefresh(refreshToken);
  if (!p.jti) throw unauthorized('Invalid refresh token');
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash: hashJti(p.jti) } });
  if (!row || row.userId !== p.sub) throw unauthorized('Invalid refresh token');
  if (row.revokedAt) {
    await revokeAllForUser(p.sub);
    await audit(p.sub, 'LOGIN_FAILED', 'User', p.sub, { reason: 'revoked refresh token reused — all sessions revoked' });
    throw unauthorized('Refresh token was revoked');
  }
  if (row.expiresAt.getTime() < Date.now()) throw unauthorized('Refresh token expired');
  const user = await prisma.user.findUnique({ where: { id: p.sub } });
  if (!user || !user.active) throw unauthorized('User inactive or not found');
  await prisma.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
  return { user, tokens: await issueTokens(user) };
}

/** Logout: revoke one refresh token (ignored if unknown or already invalid). */
export async function revokeRefresh(refreshToken: string): Promise<boolean> {
  try {
    const p = verifyRefresh(refreshToken);
    if (!p.jti) return false;
    const r = await prisma.refreshToken.updateMany({ where: { tokenHash: hashJti(p.jti), revokedAt: null }, data: { revokedAt: new Date() } });
    return r.count > 0;
  } catch {
    return false;
  }
}

export async function revokeAllForUser(userId: string): Promise<number> {
  const r = await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  return r.count;
}

export function toUserDTO(u: User): UserDTO {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role as Role,
    active: u.active,
    createdAt: u.createdAt.toISOString(),
  };
}

export async function login(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user || !user.active || !(await verifyPassword(password, user.passwordHash))) return null;
  return { user, tokens: await issueTokens(user) };
}
