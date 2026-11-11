/** Insert-only audit log (Section 12). Never updates or deletes rows. */
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';

export type AuditAction =
  | 'LOGIN' | 'LOGIN_FAILED' | 'CREATE_TEST' | 'UPDATE_TEST' | 'UPLOAD' | 'DELETE_IMAGE' | 'DETECT_REGIONS'
  | 'SAVE_REGIONS' | 'MARK_BEFORE_DONE' | 'MARK_AFTER_DONE' | 'SET_ALIGNMENT' | 'GRADE' | 'GRADE_FAILED'
  | 'ACCEPT' | 'OVERRIDE' | 'BLIND_LABEL' | 'COMPLETE' | 'VOID' | 'EXPORT' | 'UPDATE_SETTINGS'
  | 'CREATE_USER' | 'UPDATE_USER' | 'UPLOAD_MODEL' | 'ACTIVATE_MODEL' | 'DEACTIVATE_MODEL' | 'CREATE_SAMPLE';

export async function audit(
  userId: string | null | undefined,
  action: AuditAction,
  entity: string,
  entityId: string,
  details?: Record<string, unknown>,
  tx: Prisma.TransactionClient = prisma,
): Promise<void> {
  try {
    await tx.auditLog.create({
      data: { userId: userId ?? null, action, entity, entityId, details: (details ?? undefined) as Prisma.InputJsonValue },
    });
  } catch (err) {
    // audit must never break the request; log loudly
    logger.error({ err, action, entity, entityId }, 'audit write failed');
  }
}
