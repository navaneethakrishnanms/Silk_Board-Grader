import type { Request, Response } from 'express';
import { loginSchema, refreshSchema } from '@silkgrade/shared';
import { prisma } from '../lib/prisma.js';
import { parse } from '../middleware/validate.js';
import { audit } from '../services/auditService.js';
import { login, revokeRefresh, rotateRefresh, toUserDTO } from '../services/authService.js';
import { unauthorized } from '../utils/httpError.js';

export async function postLogin(req: Request, res: Response) {
  const { email, password } = parse(loginSchema, req.body);
  const r = await login(email, password);
  if (!r) {
    await audit(null, 'LOGIN_FAILED', 'User', email.toLowerCase(), { ip: req.ip });
    throw unauthorized('Invalid email or password');
  }
  await audit(r.user.id, 'LOGIN', 'User', r.user.id, { ip: req.ip });
  res.json({ ...r.tokens, user: toUserDTO(r.user) });
}

export async function postRefresh(req: Request, res: Response) {
  const { refreshToken } = parse(refreshSchema, req.body);
  const { user, tokens } = await rotateRefresh(refreshToken);
  res.json({ ...tokens, user: toUserDTO(user) });
}

/** Revokes the presented refresh token (the access token simply expires). */
export async function postLogout(req: Request, res: Response) {
  const body = req.body as { refreshToken?: string } | undefined;
  const revoked = body?.refreshToken ? await revokeRefresh(body.refreshToken) : false;
  res.json({ ok: true, revoked });
}

export async function getMe(req: Request, res: Response) {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) throw unauthorized();
  res.json(toUserDTO(user));
}
