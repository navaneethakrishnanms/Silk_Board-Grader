/** Builds a realistic completed, blind-labelled test in the in-memory database,
 *  with real (tiny) image files on disk, for PDF / CSV / dataset-zip tests. */
import fs from 'node:fs';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';

const FIX = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'fixtures');

export async function buildCompletedTest(prisma: PrismaClient, storageRoot: string, opts: { sampleId?: string; datasetMode?: boolean } = {}) {
  const tester = await prisma.user.create({ data: { name: 'Tess Tester', email: `t${Date.now()}@x.io`, passwordHash: 'x', role: 'TESTER' } });
  const a = await prisma.user.create({ data: { name: 'Alice Expert', email: `a${Date.now()}@x.io`, passwordHash: 'x', role: 'EXPERT' } });
  const b = await prisma.user.create({ data: { name: 'Bob Expert', email: `b${Date.now()}@x.io`, passwordHash: 'x', role: 'EXPERT' } });
  const sampleId = opts.sampleId ?? 'BSB-2026-00123';
  await prisma.sample.create({ data: { id: sampleId, batchId: 'B7', customer: 'Acme Silks', fabricType: 'PLAIN', construction: 'satin', baseShade: 'medium', dominantHue: 'red', dyeClass: 'acid' } });
  const test = await prisma.test.create({
    data: {
      reportNo: 'SG-2026-000123', sampleId, washMethod: 'ISO 105-C10 A', washTempC: 40, washTimeMin: 30, adjCount: 2,
      adj1Fibre: 'silk', adj2Fibre: 'cotton', reqGradeChange: 4, reqGradeStain: 3.5, status: 'COMPLETED',
      datasetMode: opts.datasetMode ?? true, createdById: tester.id, completedAt: new Date(),
      engineResult: { engine_version: '1.0.0', model_version: 'formula-only', warnings: ['noRefCard'], registration: { method: 'SIFT', inliers: 900, ok: true } },
    },
  });
  const dir = path.join(storageRoot, 'originals', test.id);
  const derived = path.join(storageRoot, 'derived', test.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(derived, { recursive: true });
  for (const piece of ['SPECIMEN', 'ADJ1', 'ADJ2']) {
    for (const side of ['BEFORE', 'AFTER']) {
      const name = `${piece.toLowerCase()}_${side.toLowerCase()}.jpg`;
      fs.copyFileSync(path.join(FIX, 'tiny.jpg'), path.join(dir, name));
      fs.copyFileSync(path.join(FIX, 'tiny.jpg'), path.join(derived, `prev_${name}`));
      await prisma.image.create({
        data: {
          testId: test.id, role: `${piece}_${side}` as 'SPECIMEN_BEFORE', side: side.toLowerCase(), path: `originals/${test.id}/${name}`,
          previewPath: `derived/${test.id}/prev_${name}`, fileName: name, sizeBytes: 690, sha256: `${piece}${side}`.toLowerCase().padEnd(64, '0'),
          width: 32, height: 24, device: side === 'BEFORE' ? 'Pixel 8' : 'Pixel 8', warnings: { noRefCard: true }, uploadedBy: tester.id,
          regions: { create: [{ piece: piece as 'SPECIMEN', polygon: [[1, 1], [30, 1], [30, 22], [1, 22]], autoDetected: true }] },
        },
      });
    }
  }
  for (const h of ['heatmap_change.jpg', 'heatmap_stain_adj1.jpg', 'heatmap_stain_adj2.jpg']) fs.copyFileSync(path.join(FIX, 'tiny.jpg'), path.join(derived, h));
  const grades: [string, string | null, number, string][] = [
    ['CHANGE_OVERALL', null, 3.0, 'heatmap_change.jpg'],
    ['STAIN_ADJ1', 'silk', 4.5, 'heatmap_stain_adj1.jpg'],
    ['STAIN_ADJ2', 'cotton', 4.0, 'heatmap_stain_adj2.jpg'],
    ['STAIN_WORST', 'worst (cotton)', 4.0, 'heatmap_stain_adj2.jpg'],
  ];
  const t0 = Date.now();
  for (const [i, [kind, label, half, heat]] of grades.entries()) {
    const g = await prisma.grade.create({
      data: {
        testId: test.id, kind: kind as 'CHANGE_OVERALL', label, isoRating: half + 0.02, finalRating: half + 0.02, halfGrade: half,
        ciLow: half - 0.1, ciHigh: half + 0.1, confidence: 'HIGH', decision: 'REVIEW', pass: true,
        features: { dE_ab: 3.4, dE00: 3.37, dE_F: 3.37, dE_F_is_placeholder: true, dL: 3.4, dC: 0, dH: 0, p10: 3.3, p50: 3.36, p90: 3.38, area_share: 1, review_reasons: ['PROVISIONAL'] },
        heatmapPath: `derived/${test.id}/${heat}`, engineVersion: '1.0.0', modelVersion: 'formula-only',
      },
    });
    await prisma.expertGrade.create({ data: { gradeId: g.id, userId: a.id, halfGrade: half, blind: true, createdAt: new Date(t0 + i * 10) } });
    await prisma.expertGrade.create({ data: { gradeId: g.id, userId: b.id, halfGrade: half, blind: true, createdAt: new Date(t0 + i * 10 + 5) } });
  }
  return { test, tester, a, b };
}
