/** CSV export of results and training-dataset zip (Section 10.2). */
import fs from 'node:fs';
import path from 'node:path';
import archiver from 'archiver';
import type { Writable } from 'node:stream';
import { blindState, GRADE_KINDS, type GradeKind, type TestListQuery } from '@silkgrade/shared';
import { prisma } from '../lib/prisma.js';
import { toCsv } from '../utils/csv.js';
import { asArray, asObject } from '../utils/json.js';
import { effectiveGrade, isLabelled, sortGrades, testInclude, type FullTest, type Viewer } from './presenter.js';
import { getSettings } from './settingsService.js';
import { absPath, exists } from './storageService.js';
import { findPieceRef, listTests } from './testService.js';

export async function testsCsv(q: TestListQuery, viewer: Viewer): Promise<string> {
  const { items } = await listTests({ ...q, page: 1, pageSize: 200 }, viewer);
  const ids = items.map((i) => i.id);
  // fetch remaining pages too
  let page = 2;
  while (ids.length < 5000) {
    const more = await listTests({ ...q, page, pageSize: 200 }, viewer);
    if (!more.items.length) break;
    ids.push(...more.items.map((i) => i.id));
    page++;
  }
  const tests = await prisma.test.findMany({ where: { id: { in: ids } }, include: testInclude, orderBy: { createdAt: 'desc' } });
  const header = ['report_no', 'sample_id', 'batch', 'customer', 'fabric_type', 'wash_method', 'status', 'created_at', 'completed_at',
    'kind', 'label', 'app_grade', 'final_rating', 'ci_low', 'ci_high', 'confidence', 'decision', 'effective_grade', 'required', 'pass',
    'dE_ab', 'dE00', 'dL', 'dC', 'dH', 'engine_version', 'model_version'];
  const rows: unknown[][] = [];
  for (const t of tests) {
    const hidden = t.datasetMode && !isLabelled(t);
    for (const g of sortGrades(t.grades)) {
      const f = asObject<Record<string, unknown>>(g.features);
      const eff = hidden ? null : effectiveGrade(g, t.datasetMode);
      const req = g.kind.startsWith('CHANGE') ? t.reqGradeChange : t.reqGradeStain;
      rows.push([t.reportNo, t.sampleId, t.sample.batchId, t.sample.customer, t.sample.fabricType, t.washMethod, t.status,
        t.createdAt.toISOString(), t.completedAt?.toISOString(), g.kind, g.label,
        hidden ? '' : g.halfGrade, hidden ? '' : g.finalRating, hidden ? '' : g.ciLow, hidden ? '' : g.ciHigh,
        hidden ? '' : g.confidence, hidden ? '' : g.decision, eff, req,
        eff === null || req == null ? '' : eff >= req ? 'PASS' : 'FAIL',
        hidden ? '' : f.dE_ab, hidden ? '' : f.dE00, hidden ? '' : f.dL, hidden ? '' : f.dC, hidden ? '' : f.dH,
        g.engineVersion, g.modelVersion]);
    }
    if (!t.grades.length) rows.push([t.reportNo, t.sampleId, t.sample.batchId, t.sample.customer, t.sample.fabricType, t.washMethod, t.status, t.createdAt.toISOString()]);
  }
  return toCsv(header, rows);
}

const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, '_');

/** One record per completed, labelled test. */
export async function datasetTests(): Promise<FullTest[]> {
  const { blindDisagreementLimit: limit } = await getSettings();
  const tests = await prisma.test.findMany({ where: { status: 'COMPLETED' }, include: testInclude, orderBy: { createdAt: 'asc' } });
  return tests.filter((t) => t.grades.length && (t.datasetMode ? isLabelled(t, limit) : t.grades.some((g) => g.expertGrades.length)));
}

export async function writeDatasetZip(stream: Writable): Promise<number> {
  const { blindDisagreementLimit: limit } = await getSettings();
  const tests = await datasetTests();
  const zip = archiver('zip', { zlib: { level: 6 } });
  zip.pipe(stream);
  const metaHeader = ['test_id', 'sample_id', 'batch_id', 'fabric_type', 'construction', 'base_shade', 'dominant_hue', 'dye_class',
    'wash_method', 'adj1_fibre', 'adj2_fibre', 'device_before', 'device_after', 'ref_card', 'grade_change_overall',
    'grade_change_ground', 'grade_change_worst', 'grade_stain_adj1', 'grade_stain_adj2',
    ...['A', 'B', 'C'].flatMap((a) => ['change_overall', 'stain_adj1', 'stain_adj2'].map((k) => `assessor${a}_${k}`)),
    'engine_version'];
  const metaRows: unknown[][] = [];
  for (const t of tests) {
    const rec = `dataset/records/${safe(t.sampleId)}__${t.id}/`;
    const copy = (piece: 'SPECIMEN' | 'ADJ1' | 'ADJ2', side: 'before' | 'after') => {
      const r = findPieceRef(t, piece, side);
      if (r && exists(r.image.path)) {
        zip.file(absPath(r.image.path), { name: `${rec}${piece.toLowerCase()}_${side}${path.extname(r.image.path).toLowerCase()}` });
      }
      return r;
    };
    const sb = copy('SPECIMEN', 'before');
    const sa = copy('SPECIMEN', 'after');
    copy('ADJ1', 'before'); copy('ADJ1', 'after');
    if (t.adjCount > 1) { copy('ADJ2', 'before'); copy('ADJ2', 'after'); }
    const regions = t.images.map((i) => ({ image_role: i.role, side: i.side, sha256: i.sha256, width: i.width, height: i.height,
      regions: i.regions.map((r) => ({ piece: r.piece, polygon: asArray(r.polygon), auto_detected: r.autoDetected })) }));
    zip.append(JSON.stringify({ images: regions }, null, 2), { name: `${rec}regions.json` });
    const grades: Record<string, unknown> = {};
    const labels: Record<string, unknown> = {};
    for (const g of sortGrades(t.grades)) {
      const key = g.kind === 'CHANGE_MOTIF' ? `${g.kind}:${g.label ?? g.id}` : g.kind;
      grades[key] = {
        iso_rating: g.isoRating, model_rating: g.modelRating, final_rating: g.finalRating, half_grade: g.halfGrade,
        ci: [g.ciLow, g.ciHigh], confidence: g.confidence, decision: g.decision, label: g.label,
        fibre: g.kind === 'STAIN_ADJ1' ? t.adj1Fibre : g.kind === 'STAIN_ADJ2' ? t.adj2Fibre : t.sample.fibre,
        features: g.features, engine_version: g.engineVersion, model_version: g.modelVersion,
      };
      const ex = g.expertGrades;
      labels[key] = {
        assessor_A: ex[0]?.halfGrade ?? null, assessor_B: ex[1]?.halfGrade ?? null, assessor_C: ex[2]?.halfGrade ?? null,
        assessors: ex.map((e) => ({ user_id: e.userId, grade: e.halfGrade, blind: e.blind, reason: e.reason, at: e.createdAt })),
        consensus: effectiveGrade(g, t.datasetMode, limit),
        state: t.datasetMode ? blindState(ex.map((e) => ({ ...e, blind: true })), limit) : 'REVIEWED',
      };
    }
    zip.append(JSON.stringify({ test_id: t.id, fabric_type: t.sample.fabricType, grades }, null, 2), { name: `${rec}features.json` });
    zip.append(JSON.stringify({ test_id: t.id, grades: labels }, null, 2), { name: `${rec}labels.json` });

    const eff = (k: GradeKind) => { const g = t.grades.find((x) => x.kind === k); return g ? effectiveGrade(g, t.datasetMode, limit) : null; };
    const ass = (k: GradeKind, i: number) => t.grades.find((x) => x.kind === k)?.expertGrades[i]?.halfGrade ?? null;
    metaRows.push([t.id, t.sampleId, t.sample.batchId, t.sample.fabricType, t.sample.construction, t.sample.baseShade,
      t.sample.dominantHue, t.sample.dyeClass, t.washMethod, t.adj1Fibre, t.adj2Fibre, sb?.image.device, sa?.image.device,
      t.images.some((i) => i.role === 'REF_CARD') || !!findPieceRef(t, 'REF_CARD', 'before'),
      eff('CHANGE_OVERALL'), eff('CHANGE_GROUND'), eff('CHANGE_WORST'), eff('STAIN_ADJ1'), eff('STAIN_ADJ2'),
      ...[0, 1, 2].flatMap((i) => (['CHANGE_OVERALL', 'STAIN_ADJ1', 'STAIN_ADJ2'] as GradeKind[]).map((k) => ass(k, i))),
      t.grades[0]?.engineVersion]);
  }
  zip.append(toCsv(metaHeader, metaRows), { name: 'dataset/metadata.csv' });
  zip.append(toCsv(['test_id', 'split'], []), { name: 'dataset/splits.csv' });
  await zip.finalize();
  return tests.length;
}

export async function datasetStats() {
  const { blindDisagreementLimit: limit } = await getSettings();
  const all = await prisma.test.findMany({ where: { status: { not: 'VOID' }, grades: { some: {} } }, include: testInclude });
  const counts = new Map<string, number>();
  const agreement = new Map<string, { n: number; exact: number; within: number }>();
  let total = 0; let labelled = 0; let awaitingSecond = 0; let awaitingThird = 0;
  for (const t of all) {
    if (t.datasetMode) {
      total++;
      if (isLabelled(t, limit)) labelled++;
      const states = t.grades.map((g) => blindState(g.expertGrades.map((e) => ({ ...e, blind: true })), limit));
      if (states.includes('NEEDS_B')) awaitingSecond++;
      if (states.includes('NEEDS_C')) awaitingThird++;
    }
    for (const g of t.grades) {
      const eff = effectiveGrade(g, t.datasetMode, limit);
      if (eff !== null && g.expertGrades.length) {
        const key = `${g.kind}|${eff}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      if (g.expertGrades.length >= 2) {
        const [a, b] = g.expertGrades;
        const s = agreement.get(g.kind) ?? { n: 0, exact: 0, within: 0 };
        s.n++; if (a.halfGrade === b.halfGrade) s.exact++; if (Math.abs(a.halfGrade - b.halfGrade) <= 0.5) s.within++;
        agreement.set(g.kind, s);
      }
    }
  }
  return {
    counts: GRADE_KINDS.flatMap((kind) => [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5].map((grade) => ({ kind, grade, n: counts.get(`${kind}|${grade}`) ?? 0 }))),
    minPerGrade: 40,
    blind: { total, labelled, awaitingSecond, awaitingThird },
    agreement: [...agreement.entries()].map(([kind, s]) => ({ kind: kind as GradeKind, n: s.n, exact: s.exact / s.n, withinHalf: s.within / s.n })),
  };
}

export const fileExists = (p: string) => fs.existsSync(p);
