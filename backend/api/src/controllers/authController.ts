import type { Request, Response } from 'express';
import { loginSchema, refreshSchema } from '@silkgrade/shared';
import { prisma } from '../lib/prisma.js';
import { parse } from '../middleware/validate.js';
import { audit } from '../services/auditService.js';
import { issueTokens, login, toUserDTO, verifyRefresh } from '../services/authService.js';
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
  const p = verifyRefresh(refreshToken);
  const user = await prisma.user.findUnique({ where: { id: p.sub } });
  if (!user || !user.active) throw unauthorized('User inactive or not found');
  res.json({ ...issueTokens(user), user: toUserDTO(user) });
}

export async function getMe(req: Request, res: Response) {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) throw unauthorized();
  res.json(toUserDTO(user));
}
