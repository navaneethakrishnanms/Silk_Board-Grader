import type { DashboardDTO } from '@silkgrade/shared';
import { prisma } from '../lib/prisma.js';
import { effectiveGrade, isLabelled, summarize, testInclude, type Viewer } from './presenter.js';

export async function dashboard(viewer: Viewer): Promise<DashboardDTO> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const since30 = new Date(Date.now() - 30 * 86_400_000);
  const [pendingWash, needsReview, completedToday, testsToday, recentRows, completed30] = await Promise.all([
    prisma.test.count({ where: { status: 'PENDING_WASH' } }),
    prisma.test.count({ where: { status: 'NEEDS_REVIEW' } }),
    prisma.test.count({ where: { status: 'COMPLETED', completedAt: { gte: startOfDay } } }),
    prisma.test.count({ where: { createdAt: { gte: startOfDay } } }),
    prisma.test.findMany({ include: testInclude, orderBy: { createdAt: 'desc' }, take: 10 }),
    prisma.test.findMany({ where: { status: 'COMPLETED', completedAt: { gte: since30 } }, include: testInclude }),
  ]);
  const summaries = completed30.map((t) => summarize(t, viewer));
  const judged = summaries.filter((s) => s.overallPass !== null);
  const dist = new Map<number, { change: number; stain: number }>();
  for (const g of [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]) dist.set(g, { change: 0, stain: 0 });
  for (const t of completed30) {
    if (t.datasetMode && !isLabelled(t)) continue;
    for (const g of t.grades) {
      const e = effectiveGrade(g, t.datasetMode);
      if (e === null) continue;
      if (g.kind === 'CHANGE_OVERALL') dist.get(e)!.change++;
      if (g.kind === 'STAIN_WORST' || (g.kind === 'STAIN_ADJ1' && t.adjCount === 1)) dist.get(e)!.stain++;
    }
  }
  return {
    pendingWash, needsReview, completedToday, testsToday,
    passRate30d: judged.length ? judged.filter((s) => s.overallPass).length / judged.length : null,
    recent: recentRows.map((t) => summarize(t, viewer)),
    gradeDistribution: [...dist.entries()].map(([grade, v]) => ({ grade, ...v })),
  };
}
