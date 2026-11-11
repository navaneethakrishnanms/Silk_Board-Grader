import { vi } from 'vitest';

/** Minimal in-memory Prisma mock: every model method is a vi.fn(). */
export function makePrismaMock() {
  const model = () => ({
    findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(async () => []),
    create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), upsert: vi.fn(), delete: vi.fn(), deleteMany: vi.fn(),
    count: vi.fn(async () => 0),
  });
  const m = {
    user: model(), sample: model(), test: model(), image: model(), region: model(), grade: model(),
    expertGrade: model(), modelVersion: model(), setting: model(), auditLog: model(),
    $transaction: vi.fn(),
    $connect: vi.fn(),
  };
  m.$transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: typeof m) => unknown)(m) : Promise.all(arg as Promise<unknown>[]));
  return m;
}

export type PrismaMock = ReturnType<typeof makePrismaMock>;

const now = new Date('2026-11-01T10:00:00Z');

export function fakeGrade(over: Record<string, unknown> = {}) {
  return {
    id: 'g1', testId: 't1', kind: 'CHANGE_OVERALL', label: null, isoRating: 4.31, modelRating: null, finalRating: 4.31,
    halfGrade: 4.5, ciLow: 4.12, ciHigh: 4.48, confidence: 'MEDIUM', decision: 'REVIEW', pass: true,
    features: { dE_ab: 1.2, review_reasons: ['BOUNDARY'] }, heatmapPath: 'derived/t1/heatmap_change.png',
    engineVersion: '1.0.0', modelVersion: 'formula-only', createdAt: now, expertGrades: [], ...over,
  };
}

export function fakeTest(over: Record<string, unknown> = {}) {
  return {
    id: 't1', reportNo: 'SG-2026-000001', sampleId: 'S1', washMethod: 'ISO 105-C10 A', washTempC: 40, washTimeMin: 30,
    adjCount: 2, adj1Fibre: 'silk', adj2Fibre: 'cotton', reqGradeChange: 4, reqGradeStain: 3.5, status: 'NEEDS_REVIEW',
    datasetMode: false, captureDevice: null, uploadMode: 'separate', createdById: 'u-tester', createdAt: now, completedAt: null,
    gradingError: null, engineResult: null, manualPoints: null, voidReason: null, reportPath: null,
    sample: { id: 'S1', batchId: 'B1', customer: 'C', fibre: 'silk', construction: null, fabricType: 'PLAIN', baseShade: null, dominantHue: null, dyeClass: null, notes: null },
    createdBy: { id: 'u-tester', name: 'Tester' },
    images: [], grades: [fakeGrade()], ...over,
  };
}

export const users = {
  admin: { id: 'u-admin', name: 'Admin', email: 'admin@x.io', role: 'ADMIN', active: true, passwordHash: '', createdAt: now },
  expert: { id: 'u-expert', name: 'Expert', email: 'expert@x.io', role: 'EXPERT', active: true, passwordHash: '', createdAt: now },
  tester: { id: 'u-tester', name: 'Tester', email: 'tester@x.io', role: 'TESTER', active: true, passwordHash: '', createdAt: now },
};
