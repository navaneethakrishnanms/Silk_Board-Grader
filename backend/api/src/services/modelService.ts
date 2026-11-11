/** Trained model versions (Section 10): upload JSON/ONNX, activate one per name. */
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Prisma } from '@prisma/client';
import { quadraticWeightedKappa, toHalfGrade, type ModelVersionDTO } from '@silkgrade/shared';
import { engineClient } from '../clients/engineClient.js';
import { effectiveGrade, testInclude } from './presenter.js';
import { getConsensusPolicy } from './settingsService.js';
import { prisma } from '../lib/prisma.js';
import { badRequest, notFound } from '../utils/httpError.js';
import { audit } from './auditService.js';
import { ensureDir, mirror, relPath, sha256File } from './storageService.js';
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
    const type = String(spec.type ?? 'linear');
    const required: Record<string, string[]> = {
      linear: ['features', 'coef', 'intercept'],
      ordinal_logistic: ['features', 'coef', 'theta', 'classes'],
      lgbm_regressor: ['features', 'onnx_b64'],
      lgbm_ordinal: ['features', 'classes', 'onnx_b64_list'],
    };
    if (!required[type]) throw badRequest(`Unknown model type "${type}"`);
    for (const k of ['name', 'version', ...required[type]]) if (!(k in spec)) throw badRequest(`Model JSON missing "${k}"`);
    name = String(spec.name); version = String(spec.version);
    metrics = { ...((spec.metrics as Record<string, unknown>) ?? {}), ...(spec.synthetic === true ? { synthetic: true } : {}) };
  }
  if (!name || !NAMES.includes(name)) throw badRequest(`Model name must be one of ${NAMES.join(', ')}`);
  if (!version) throw badRequest('Model version is required');
  const dir = await ensureDir('models');
  const dest = path.join(dir, `${name}-${version.replace(/[^A-Za-z0-9._-]/g, '_')}${ext}`);
  await fsp.copyFile(file.path, dest);
  await fsp.rm(file.path, { force: true });
  await mirror(relPath(dest));
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

const KINDS: Record<string, string[]> = {
  m1_change: ['CHANGE_OVERALL', 'CHANGE_GROUND', 'CHANGE_MOTIF', 'CHANGE_WORST'],
  m2_stain: ['STAIN_ADJ1', 'STAIN_ADJ2', 'STAIN_WORST'],
};

function agreement(expert: number[], rating: number[]) {
  const half = rating.map((r) => toHalfGrade(r));
  const n = expert.length;
  if (!n) return { n: 0, exact: null, withinHalf: null, qwk: null, mae: null };
  return {
    n,
    exact: half.filter((h, i) => h === expert[i]).length / n,
    withinHalf: half.filter((h, i) => Math.abs(h - expert[i]) <= 0.5).length / n,
    qwk: quadraticWeightedKappa(expert, half),
    mae: half.reduce((s, h, i) => s + Math.abs(h - expert[i]), 0) / n,
  };
}

/** Run a candidate model and the active one on every past expert-graded record, before activating. */
export async function compareModel(id: string) {
  const cand = await prisma.modelVersion.findUnique({ where: { id } });
  if (!cand) throw notFound('Model version');
  const active = await prisma.modelVersion.findFirst({ where: { name: cand.name, active: true } });
  const policy = await getConsensusPolicy();
  const tests = await prisma.test.findMany({ where: { status: { not: 'VOID' }, grades: { some: {} } }, include: testInclude });
  const records: { id: string; kind: string; iso_rating: number; features: Record<string, unknown>; context: Record<string, unknown>; expert: number }[] = [];
  for (const t of tests) {
    for (const g of t.grades) {
      if (!KINDS[cand.name].includes(g.kind) || !g.expertGrades.length) continue;
      const expert = effectiveGrade(g, t.datasetMode, policy);
      if (expert === null) continue;
      const fibre = g.kind === 'STAIN_ADJ1' ? t.adj1Fibre : g.kind.startsWith('STAIN') ? (t.adj2Fibre ?? t.adj1Fibre) : t.sample.fibre;
      records.push({
        id: g.id, kind: g.kind, iso_rating: g.isoRating, features: (g.features ?? {}) as Record<string, unknown>,
        context: { fibre, fabric_type: t.sample.fabricType }, expert,
      });
    }
  }
  const base = {
    model: cand.name, candidate: { id: cand.id, version: cand.version }, active: active ? { id: active.id, version: active.version } : null,
  };
  if (!records.length) return { ...base, records: 0, candidateAgreement: null, activeAgreement: null, formulaAgreement: null, byKind: [] };
  const res = await engineClient.compareModels({
    name: cand.name,
    candidate: { path: cand.path, version: cand.version },
    active: active && active.id !== cand.id ? { path: active.path, version: active.version } : null,
    records: records.map(({ expert: _e, ...r }) => r),
  });
  const byId = new Map(res.predictions.map((p) => [p.id, p]));
  const expert = records.map((r) => r.expert);
  const pick = (k: 'candidate' | 'active' | 'iso') => records.map((r) => byId.get(r.id)![k]);
  const kinds = [...new Set(records.map((r) => r.kind))];
  return {
    ...base,
    records: records.length,
    candidateAgreement: agreement(expert, pick('candidate')),
    activeAgreement: agreement(expert, pick('active')),
    formulaAgreement: agreement(expert, pick('iso')),
    byKind: kinds.map((k) => {
      const idx = records.map((r, i) => (r.kind === k ? i : -1)).filter((i) => i >= 0);
      const sub = (arr: number[]) => idx.map((i) => arr[i]);
      return { kind: k, candidate: agreement(sub(expert), sub(pick('candidate'))), active: agreement(sub(expert), sub(pick('active'))) };
    }),
  };
}
