import type { NextFunction, Request, Response } from 'express';
import { hasRole, type Role } from '@silkgrade/shared';
import { forbidden, unauthorized } from '../utils/httpError.js';

/** Role-based access: `requireRole('EXPERT')` admits EXPERT and ADMIN. */
export const requireRole = (min: Role) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) return next(unauthorized());
  if (!hasRole(req.user.role, min)) return next(forbidden());
  next();
};
