import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@silkgrade/shared';
import { prisma } from '../lib/prisma.js';
import { verifyAccess } from '../services/authService.js';
import { unauthorized } from '../utils/httpError.js';

/** Requires a valid access token; loads the (active) user. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return next(unauthorized());
  try {
    const payload = verifyAccess(h.slice(7));
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.active) return next(unauthorized('User inactive or not found'));
    req.user = { id: user.id, role: user.role as Role, name: user.name, email: user.email };
    next();
  } catch (err) {
    next(err);
  }
}
