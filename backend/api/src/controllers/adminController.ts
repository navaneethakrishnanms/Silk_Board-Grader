/** Dashboard, review, export, settings, users, models, files, engine health. */
import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response } from 'express';
import { expertGradeSchema, settingsSchema, testListQuerySchema, userCreateSchema, userUpdateSchema, type Role } from '@silkgrade/shared';
import { engineClient } from '../clients/engineClient.js';
import { prisma } from '../lib/prisma.js';
import { parse } from '../middleware/validate.js';
import { audit } from '../services/auditService.js';
import { hashPassword, toUserDTO } from '../services/authService.js';
import { dashboard } from '../services/dashboardService.js';
import { datasetStats, testsCsv, writeDatasetZip } from '../services/exportService.js';
import { verifyToken } from '../services/fileService.js';
import * as models from '../services/modelService.js';
import { presentTest } from '../services/presenter.js';
import { addExpertGrade, reviewQueue } from '../services/reviewService.js';
import { getPublicSettings, getSettings, updateSettings } from '../services/settingsService.js';
import { absPath } from '../services/storageService.js';
import { badRequest, conflict, notFound } from '../utils/httpError.js';

export const getDashboard = async (req: Request, res: Response) => { res.json(await dashboard(req.user!)); };

export async function getReview(req: Request, res: Response) {
  res.json(await reviewQueue(req.user!, { reason: req.query.reason as string | undefined, kind: req.query.kind as string | undefined }));
}

export async function postExpertGrade(req: Request, res: Response) {
  const t = await addExpertGrade(String(req.params.gradeId), parse(expertGradeSchema, req.body), req.user!);
  const { blindDisagreementLimit } = await getSettings();
  res.status(201).json(presentTest(t, req.user!, blindDisagreementLimit));
}

export async function exportCsv(req: Request, res: Response) {
  const q = parse(testListQuerySchema, req.query);
  const csv = await testsCsv(q, req.user!);
  await audit(req.user!.id, 'EXPORT', 'Export', 'tests.csv', { filters: req.query });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="silkgrade-tests-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send('﻿' + csv);
}

export async function exportDataset(req: Request, res: Response) {
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="silkgrade-dataset-${new Date().toISOString().slice(0, 10)}.zip"`);
  const n = await writeDatasetZip(res);
  await audit(req.user!.id, 'EXPORT', 'Export', 'dataset.zip', { records: n });
}

export const getDatasetStats = async (_req: Request, res: Response) => { res.json(await datasetStats()); };

export const getPublic = async (_req: Request, res: Response) => { res.json(await getPublicSettings()); };
export const getAllSettings = async (_req: Request, res: Response) => { res.json(await getSettings()); };
export async function putSettings(req: Request, res: Response) {
  const input = parse(settingsSchema, req.body);
  const s = await updateSettings(input);
  await audit(req.user!.id, 'UPDATE_SETTINGS', 'Setting', '*', { keys: Object.keys(input) });
  res.json(s);
}

export async function listUsers(_req: Request, res: Response) {
  res.json((await prisma.user.findMany({ orderBy: { createdAt: 'asc' } })).map(toUserDTO));
}

export async function createUser(req: Request, res: Response) {
  const u = parse(userCreateSchema, req.body);
  const email = u.email.toLowerCase();
  if (await prisma.user.findUnique({ where: { email } })) throw conflict('A user with this email already exists');
  const user = await prisma.user.create({ data: { name: u.name, email, role: u.role as Role, passwordHash: await hashPassword(u.password) } });
  await audit(req.user!.id, 'CREATE_USER', 'User', user.id, { email, role: u.role });
  res.status(201).json(toUserDTO(user));
}

export async function updateUser(req: Request, res: Response) {
  const u = parse(userUpdateSchema, req.body);
  const uid = String(req.params.id);
  if (uid === req.user!.id && (u.active === false || (u.role && u.role !== 'ADMIN'))) throw badRequest('You cannot demote or deactivate yourself');
  const user = await prisma.user.update({
    where: { id: uid },
    data: { name: u.name, role: u.role as Role | undefined, active: u.active, ...(u.password ? { passwordHash: await hashPassword(u.password) } : {}) },
  });
  await audit(req.user!.id, 'UPDATE_USER', 'User', uid, { fields: Object.keys(u).filter((k) => k !== 'password'), passwordReset: !!u.password });
  res.json(toUserDTO(user));
}

export const getModels = async (_req: Request, res: Response) => { res.json(await models.listModels()); };
export async function postModel(req: Request, res: Response) {
  if (!req.file) throw badRequest('No model file uploaded (field "file")');
  res.status(201).json(await models.uploadModel(req.file, { name: req.body.name, version: req.body.version }, req.user!));
}
export const activateModel = async (req: Request, res: Response) => { res.json(await models.setActive(String(req.params.id), true, req.user!)); };
export const deactivateModel = async (req: Request, res: Response) => { res.json(await models.setActive(String(req.params.id), false, req.user!)); };

export async function engineHealth(_req: Request, res: Response) {
  try {
    res.json({ ok: true, ...(await engineClient.health()) });
  } catch (err) {
    res.json({ ok: false, error: (err as Error).message });
  }
}

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.tif': 'image/tiff', '.tiff': 'image/tiff',
  '.heic': 'image/heic', '.heif': 'image/heif', '.pdf': 'application/pdf', '.json': 'application/json',
};

/** Signed file access (no Authorization header needed; token expires). */
export function getFile(req: Request, res: Response) {
  const rel = verifyToken(String(req.params.token));
  if (!rel) throw notFound('File');
  const abs = absPath(rel);
  if (!fs.existsSync(abs)) throw notFound('File');
  res.setHeader('Content-Type', MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream');
  res.setHeader('Cache-Control', 'private, max-age=600');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(abs);
}
