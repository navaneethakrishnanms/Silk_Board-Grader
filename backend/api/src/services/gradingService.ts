/** Grading job (Section 12 Reliability): runs in-process after a 202 response;
 *  the UI polls GET /tests/:id. A failed job returns the test to READY_TO_GRADE
 *  with `gradingError` so it can be retried. Grade rows are insert-only. */
import type { Prisma } from '@prisma/client';
import type { GradeKind, Piece } from '@silkgrade/shared';
import { engineClient, type EngineGradeRequest } from '../clients/engineClient.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { badRequest } from '../utils/httpError.js';
import { asArray } from '../utils/json.js';
import { audit } from './auditService.js';
import { completeTest } from './completionService.js';
import { getSettings } from './settingsService.js';
import { mirror } from './storageService.js';
import { findPieceRef, loadTest, missingPieces, transition } from './testService.js';
import type { Viewer } from './presenter.js';

const running = new Set<string>();

export async function buildGradeRequest(testId: string): Promise<EngineGradeRequest> {
  const test = await loadTest(testId);
  const settings = await getSettings();
  const poly = (r: { polygon: unknown }) => asArray(r.polygon) as [number, number][];
  const pair = (piece: Piece) => {
    const b = findPieceRef(test, piece, 'before');
    const a = findPieceRef(test, piece, 'after');
    if (!b || !a) throw badRequest(`Missing ${piece} before/after region`);
    return { before: { path: b.image.path, polygon: poly(b.region) }, after: { path: a.image.path, polygon: poly(a.region) } };
  };
  const card = (side: 'before' | 'after') => {
    const r = findPieceRef(test, 'REF_CARD', side);
    return r ? { path: r.image.path, polygon: poly(r.region).slice(0, 4) } : null;
  };
  const pairs: EngineGradeRequest['pairs'] = { specimen: pair('SPECIMEN'), adj1: pair('ADJ1') };
  if (test.adjCount >= 2) pairs.adj2 = pair('ADJ2');

  const active = await prisma.modelVersion.findMany({ where: { active: true } });
  const models: Record<string, { path: string; version: string } | null> = {};
  for (const m of active) models[m.name] = { path: m.path, version: m.version };

  const mp = test.manualPoints as { before?: [number, number][]; after?: [number, number][] } | null;
  return {
    test_id: test.id,
    fabric_type: test.sample.fabricType,
    adj_count: test.adjCount,
    adj_fibres: [test.adj1Fibre, ...(test.adjCount >= 2 && test.adj2Fibre ? [test.adj2Fibre] : [])],
    required: { change: test.reqGradeChange, stain: test.reqGradeStain },
    pairs,
    ref_card: { before: card('before'), after: card('after') },
    options: {
      stain_statistic: settings.stainStatistic,
      change_rule: settings.changeRule,
      models,
      manual_points: mp?.before?.length === 2 && mp?.after?.length === 2 ? { before: mp.before, after: mp.after } : null,
    },
  };
}

export async function startGrading(testId: string, user: Viewer) {
  const test = await loadTest(testId);
  const missing = missingPieces(test, 'before').concat(missingPieces(test, 'after'));
  if (missing.length) throw badRequest(`Missing regions: ${[...new Set(missing)].join(', ')}`);
  await transition(testId, ['READY_TO_GRADE'], 'GRADING', { gradingError: null });
  setImmediate(() => void runJob(testId, user));
  return loadTest(testId);
}

export async function runJob(testId: string, user: Viewer): Promise<void> {
  if (running.has(testId)) return;
  running.add(testId);
  try {
    const req = await buildGradeRequest(testId);
    const res = await engineClient.grade(req);
    const test = await loadTest(testId);
    const anyReview = res.grades.some((g) => g.decision === 'REVIEW');
    const next = test.datasetMode || anyReview ? 'NEEDS_REVIEW' : 'GRADED_AUTO';
    await prisma.$transaction(async (tx) => {
      for (const g of res.grades) {
        await tx.grade.create({
          data: {
            testId, kind: g.kind as GradeKind, label: g.label, isoRating: g.iso_rating, modelRating: g.model_rating,
            finalRating: g.final_rating, halfGrade: g.half_grade, ciLow: g.ci[0], ciHigh: g.ci[1],
            confidence: g.confidence, decision: g.decision, pass: g.pass,
            features: g.features as Prisma.InputJsonValue, heatmapPath: g.heatmap_path,
            engineVersion: res.engine_version, modelVersion: g.model_version ?? res.model_version,
          },
        });
      }
      // per-region stats for traceability
      for (const [piece, sides] of Object.entries(res.pieces ?? {})) {
        for (const side of ['before', 'after'] as const) {
          const ref = findPieceRef(test, piece.toUpperCase() as Piece, side);
          if (ref && sides?.[side]) {
            await tx.region.update({ where: { id: ref.region.id }, data: { stats: sides[side] as Prisma.InputJsonValue } });
          }
        }
      }
      const upd = await tx.test.updateMany({
        where: { id: testId, status: 'GRADING' },
        data: {
          status: next,
          engineResult: {
            warnings: res.warnings, registration: res.registration, engine_version: res.engine_version,
            model_version: res.model_version, ref_card: res.ref_card, timings_ms: res.timings_ms,
          } as Prisma.InputJsonValue,
        },
      });
      if (upd.count !== 1) throw new Error('Test left GRADING during the job (voided?)');
      await audit(user.id, 'GRADE', 'Test', testId, {
        engineVersion: res.engine_version, modelVersion: res.model_version, grades: res.grades.length, status: next,
      }, tx);
    });
    for (const h of new Set(res.grades.map((g) => g.heatmap_path))) await mirror(h);
    const settings = await getSettings();
    if (next === 'GRADED_AUTO' && settings.autoCompleteAuto) await completeTest(testId, user);
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    logger.warn({ err, testId }, 'grading failed');
    await prisma.test.updateMany({ where: { id: testId, status: 'GRADING' }, data: { status: 'READY_TO_GRADE', gradingError: message } });
    await audit(user.id, 'GRADE_FAILED', 'Test', testId, { error: message });
  } finally {
    running.delete(testId);
  }
}

/** On boot: jobs interrupted by a restart go back to READY_TO_GRADE. */
export async function recoverInterruptedJobs(): Promise<number> {
  const r = await prisma.test.updateMany({
    where: { status: 'GRADING' },
    data: { status: 'READY_TO_GRADE', gradingError: 'Grading interrupted by a server restart — please retry.' },
  });
  return r.count;
}
