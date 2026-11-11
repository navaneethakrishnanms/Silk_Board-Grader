/** Expert review: accept/override (normal mode) and blind labelling (dataset mode).
 *  A Grade row is never modified — every decision is a new ExpertGrade. */
import { blindState, type ExpertGradeInput } from '@silkgrade/shared';
import { prisma } from '../lib/prisma.js';
import { badRequest, conflict, notFound } from '../utils/httpError.js';
import { audit } from './auditService.js';
import { summarize, testInclude, type Viewer } from './presenter.js';
import { getConsensusPolicy } from './settingsService.js';
import { loadTest } from './testService.js';

export async function addExpertGrade(gradeId: string, input: ExpertGradeInput, user: Viewer) {
  const grade = await prisma.grade.findUnique({ where: { id: gradeId }, include: { test: true, expertGrades: true } });
  if (!grade) throw notFound('Grade');
  const test = grade.test;
  if (!['NEEDS_REVIEW', 'GRADED_AUTO'].includes(test.status)) throw conflict(`Cannot review a ${test.status} test`);
  const limit = await getConsensusPolicy();

  if (test.datasetMode) {
    const marks = grade.expertGrades.map((e) => ({ ...e, blind: true }));
    if (grade.expertGrades.some((e) => e.userId === user.id)) throw conflict('You have already labelled this grade');
    const st = blindState(marks, limit);
    if (st === 'LABELLED') throw conflict('This grade is already labelled');
    const eg = await prisma.expertGrade.create({
      data: { gradeId, userId: user.id, halfGrade: input.halfGrade, reason: input.reason ?? null, blind: true },
    });
    await audit(user.id, 'BLIND_LABEL', 'Grade', gradeId, { testId: test.id, step: st, expertGradeId: eg.id });
  } else {
    const override = input.halfGrade !== grade.halfGrade;
    if (override && !input.reason?.trim()) throw badRequest('A reason is required to override the app grade');
    const eg = await prisma.expertGrade.create({
      data: { gradeId, userId: user.id, halfGrade: input.halfGrade, reason: input.reason ?? null, blind: false },
    });
    await audit(user.id, override ? 'OVERRIDE' : 'ACCEPT', 'Grade', gradeId, {
      testId: test.id, appGrade: grade.halfGrade, expertGrade: input.halfGrade, reason: input.reason ?? null, expertGradeId: eg.id,
    });
  }
  return loadTest(test.id);
}

export async function reviewQueue(viewer: Viewer, filter: { reason?: string; kind?: string } = {}) {
  const limit = await getConsensusPolicy();
  const rows = await prisma.test.findMany({ where: { status: 'NEEDS_REVIEW' }, include: testInclude, orderBy: { createdAt: 'asc' } });
  let items = rows.map((t) => summarize(t, viewer, limit));
  if (filter.reason) items = items.filter((i) => i.reviewReasons?.includes(filter.reason!));
  if (filter.kind) items = items.filter((i) => i.reviewKinds?.includes(filter.kind as never));
  return items;
}
