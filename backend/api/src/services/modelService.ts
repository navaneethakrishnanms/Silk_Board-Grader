/** Trained model versions (Section 10): upload JSON/ONNX, activate one per name. */
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Prisma } from '@prisma/client';
import type { ModelVersionDTO } from '@silkgrade/shared';
import { prisma } from '../lib/prisma.js';
import { badRequest, notFound } from '../utils/httpError.js';
import { audit } from './auditService.js';
import { ensureDir, relPath, sha256File } from './storageService.js';
import type { Viewer } from './presenter.js';

const NAMES = ['m1_change', 'm2_stain'];

export const toDTO = (m: Prisma.ModelVersionGetPayload<object>): ModelVersionDTO => ({
  id: m.id, name: m.name, version: m.version, sha256: m.sha256,
  metrics: (m.metrics as Record<string, unknown>) ?? {}, active: m.active, createdAt: m.createdAt.toISOString(),
});

export async function uploadModel(file: { path: string; originalname: string }, meta: { name?: string; version?: string }, user: Viewer) {
  const ext = path.extname(file.originalname).toLowerCase();
  let name = meta.name;
  let version = meta.version;
  let metrics: Record<string, unknown> = {};
  if (ext === '.json') {
    let spec: Record<string, unknown>;
    try { spec = JSON.parse(await fsp.readFile(file.path, 'utf8')); } catch { throw badRequest('Model file is not valid JSON'); }
    for (const k of ['name', 'version', 'features', 'coef', 'intercept']) if (!(k in spec)) throw badRequest(`Model JSON missing "${k}"`);
    name = String(spec.name); version = String(spec.version);
    metrics = (spec.metrics as Record<string, unknown>) ?? {};
  }
  if (!name || !NAMES.includes(name)) throw badRequest(`Model name must be one of ${NAMES.join(', ')}`);
  if (!version) throw badRequest('Model version is required');
  const dir = await ensureDir('models');
  const dest = path.join(dir, `${name}-${version.replace(/[^A-Za-z0-9._-]/g, '_')}${ext}`);
  await fsp.copyFile(file.path, dest);
  await fsp.rm(file.path, { force: true });
  const m = await prisma.modelVersion.create({
    data: { name, version, path: relPath(dest), sha256: await sha256File(dest), metrics: metrics as Prisma.InputJsonValue },
  });
  await audit(user.id, 'UPLOAD_MODEL', 'ModelVersion', m.id, { name, version });
  return toDTO(m);
}

export async function setActive(id: string, active: boolean, user: Viewer) {
  const m = await prisma.modelVersion.findUnique({ where: { id } });
  if (!m) throw notFound('Model version');
  await prisma.$transaction([
    ...(active ? [prisma.modelVersion.updateMany({ where: { name: m.name }, data: { active: false } })] : []),
    prisma.modelVersion.update({ where: { id }, data: { active } }),
  ]);
  await audit(user.id, active ? 'ACTIVATE_MODEL' : 'DEACTIVATE_MODEL', 'ModelVersion', id, { name: m.name, version: m.version });
  return listModels();
}

export async function listModels() {
  return (await prisma.modelVersion.findMany({ orderBy: [{ name: 'asc' }, { createdAt: 'desc' }] })).map(toDTO);
}
