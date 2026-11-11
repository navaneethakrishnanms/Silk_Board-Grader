import bcrypt from 'bcryptjs';
import jwt, { type SignOptions } from 'jsonwebtoken';
import type { Role, UserDTO } from '@silkgrade/shared';
import type { User } from '@prisma/client';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { unauthorized } from '../utils/httpError.js';

interface TokenPayload {
  sub: string;
  role: Role;
  typ: 'access' | 'refresh';
}

export const hashPassword = (pw: string) => bcrypt.hash(pw, 12);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

export function ttlSeconds(ttl: string): number {
  const m = /^(\d+)([smhd])?$/.exec(ttl.trim());
  if (!m) return 900;
  return Number(m[1]) * UNIT_SECONDS[m[2] ?? 's'];
}

export function issueTokens(user: Pick<User, 'id' | 'role'>) {
  const accessTtl = ttlSeconds(env.JWT_ACCESS_TTL);
  const access: TokenPayload = { sub: user.id, role: user.role as Role, typ: 'access' };
  const refresh: TokenPayload = { sub: user.id, role: user.role as Role, typ: 'refresh' };
  const accessToken = jwt.sign(access, env.JWT_ACCESS_SECRET, { expiresIn: accessTtl } as SignOptions);
  const refreshToken = jwt.sign(refresh, env.JWT_REFRESH_SECRET, {
    expiresIn: ttlSeconds(env.JWT_REFRESH_TTL),
  } as SignOptions);
  return { accessToken, refreshToken, expiresIn: accessTtl };
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
  return { user, tokens: issueTokens(user) };
}
