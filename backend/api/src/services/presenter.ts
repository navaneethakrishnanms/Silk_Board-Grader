/** DB rows -> API DTOs. Applies blind-mode hiding (Section 6/9.4), effective
 *  grades (expert consensus over engine grade) and signed file URLs. */
import type { Prisma } from '@prisma/client';
import {
  blindState, consensus, DEFAULT_CONSENSUS, hasRole, type ConsensusPolicy, isChangeKind, type GradeDTO, type GradeKind, type ImageDTO, type Role,
  type TestDTO, type TestSummaryDTO,
} from '@silkgrade/shared';
import { asArray, asObject, iso } from '../utils/json.js';
import { fileUrl } from './fileService.js';

export const testInclude = {
  sample: true,
  createdBy: { select: { id: true, name: true } },
  images: { include: { regions: true }, orderBy: { uploadedAt: 'asc' } },
  grades: {
    include: { expertGrades: { include: { user: { select: { name: true } } }, orderBy: { createdAt: 'asc' } } },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.TestInclude;

export type FullTest = Prisma.TestGetPayload<{ include: typeof testInclude }>;
type FullGrade = FullTest['grades'][number];

export interface Viewer {
  id: string;
  role: Role;
}

const KIND_ORDER: GradeKind[] = ['CHANGE_OVERALL', 'CHANGE_GROUND', 'CHANGE_MOTIF', 'CHANGE_WORST', 'STAIN_ADJ1', 'STAIN_ADJ2', 'STAIN_WORST'];

export function isLabelled(test: Pick<FullTest, 'grades'>, limit: ConsensusPolicy = DEFAULT_CONSENSUS): boolean {
  return test.grades.length > 0 && test.grades.every((g) => blindState(marks(g), limit) === 'LABELLED');
}

const marks = (g: FullGrade) =>
  g.expertGrades.map((e) => ({ userId: e.userId, halfGrade: e.halfGrade, blind: e.blind, createdAt: e.createdAt }));

export function effectiveGrade(g: FullGrade, datasetMode: boolean, limit: ConsensusPolicy = DEFAULT_CONSENSUS): number | null {
  const c = consensus(marks(g), datasetMode, limit);
  if (c !== null) return c;
  return datasetMode ? null : g.halfGrade;
}

export function isReviewed(g: FullGrade, datasetMode: boolean, limit: ConsensusPolicy = DEFAULT_CONSENSUS): boolean {
  if (datasetMode) return blindState(marks(g), limit) === 'LABELLED';
  return g.decision === 'AUTO' || g.expertGrades.length > 0;
}

function requiredFor(test: FullTest, kind: GradeKind): number | null {
  return isChangeKind(kind) ? test.reqGradeChange : test.reqGradeStain;
}

export function presentGrade(test: FullTest, g: FullGrade, viewer: Viewer, hidden: boolean, limit: ConsensusPolicy = DEFAULT_CONSENSUS): GradeDTO {
  const eff = effectiveGrade(g, test.datasetMode, limit);
  const req = requiredFor(test, g.kind as GradeKind);
  const labelled = !hidden;
  const visibleExperts = g.expertGrades.filter((e) => labelled || !test.datasetMode || e.userId === viewer.id);
  return {
    id: g.id,
    kind: g.kind as GradeKind,
    label: g.label,
    isoRating: hidden ? null : g.isoRating,
    modelRating: hidden ? null : g.modelRating,
    finalRating: hidden ? null : g.finalRating,
    halfGrade: hidden ? null : g.halfGrade,
    ciLow: hidden ? null : g.ciLow,
    ciHigh: hidden ? null : g.ciHigh,
    confidence: hidden ? null : (g.confidence as GradeDTO['confidence']),
    decision: hidden ? null : g.decision,
    pass: hidden ? null : g.pass,
    features: hidden ? null : (asObject(g.features) as GradeDTO['features']),
    heatmapUrl: hidden ? null : fileUrl(g.heatmapPath),
    engineVersion: g.engineVersion,
    modelVersion: g.modelVersion,
    createdAt: g.createdAt.toISOString(),
    expertGrades: visibleExperts.map((e) => ({
      id: e.id,
      userId: e.userId,
      userName: e.user?.name,
      halfGrade: e.halfGrade,
      reason: e.reason,
      blind: e.blind,
      createdAt: e.createdAt.toISOString(),
    })),
    effectiveGrade: hidden ? null : eff,
    effectivePass: hidden || eff === null ? null : req === null || req === undefined ? g.pass : eff >= req,
    reviewed: isReviewed(g, test.datasetMode, limit),
    hidden,
    blindState: test.datasetMode ? blindState(marks(g), limit) : undefined,
  };
}

function presentImage(img: FullTest['images'][number]): ImageDTO {
  return {
    id: img.id,
    role: img.role,
    side: (img.side as ImageDTO['side']) ?? null,
    fileName: img.fileName,
    sizeBytes: img.sizeBytes,
    sha256: img.sha256,
    width: img.width,
    height: img.height,
    device: img.device,
    warnings: asObject(img.warnings),
    uploadedBy: img.uploadedBy,
    uploadedAt: img.uploadedAt.toISOString(),
    previewUrl: fileUrl(img.previewPath),
    originalUrl: fileUrl(img.path)!,
    regions: img.regions.map((r) => ({
      id: r.id,
      imageId: r.imageId,
      piece: r.piece,
      polygon: asArray(r.polygon) as [number, number][],
      autoDetected: r.autoDetected,
      editedBy: r.editedBy,
      stats: (r.stats as Record<string, unknown>) ?? null,
      confidence: (asObject<{ confidence?: number }>(r.stats).confidence as number | undefined) ?? undefined,
    })),
  };
}

export function summarize(test: FullTest, viewer: Viewer, limit: ConsensusPolicy = DEFAULT_CONSENSUS): TestSummaryDTO {
  const hidden = test.datasetMode && !isLabelled(test, limit);
  const grades = sortGrades(test.grades).map((g) => presentGrade(test, g, viewer, hidden, limit));
  const passes = grades.map((g) => g.effectivePass).filter((p): p is boolean => p !== null);
  const find = (k: GradeKind) => grades.find((g) => g.kind === k)?.effectiveGrade ?? null;
  const reviewGrades = test.grades.filter((g) => g.decision === 'REVIEW' && !isReviewed(g, test.datasetMode, limit));
  const reasons = new Set<string>();
  for (const g of reviewGrades) for (const r of asArray<string>(asObject(g.features).review_reasons)) reasons.add(r);
  if (hidden) reasons.add('DATASET');
  if (test.datasetMode && test.grades.some((g) => blindState(marks(g), limit) === 'NEEDS_C')) reasons.add('NEEDS_THIRD');
  return {
    id: test.id,
    reportNo: test.reportNo,
    sampleId: test.sampleId,
    batchId: test.sample.batchId,
    customer: test.sample.customer,
    fabricType: test.sample.fabricType,
    washMethod: test.washMethod,
    status: test.status,
    datasetMode: test.datasetMode,
    createdAt: test.createdAt.toISOString(),
    completedAt: iso(test.completedAt),
    createdByName: test.createdBy?.name ?? null,
    overallPass: hidden || passes.length === 0 ? null : passes.every(Boolean),
    changeGrade: hidden ? null : find('CHANGE_OVERALL'),
    stainGrade: hidden ? null : (find('STAIN_WORST') ?? find('STAIN_ADJ1')),
    reviewKinds: [...new Set(reviewGrades.map((g) => g.kind as GradeKind))],
    reviewReasons: [...reasons],
    ageDays: Math.floor((Date.now() - test.createdAt.getTime()) / 86_400_000),
  };
}

export function canComplete(test: FullTest, viewer: Viewer, limit: ConsensusPolicy = DEFAULT_CONSENSUS): boolean {
  if (test.status === 'GRADED_AUTO') return !test.datasetMode || isLabelled(test, limit);
  if (test.status !== 'NEEDS_REVIEW' || !hasRole(viewer.role, 'EXPERT')) return false;
  if (test.datasetMode) return isLabelled(test, limit);
  return test.grades.every((g) => isReviewed(g, false, limit));
}

export function presentTest(test: FullTest, viewer: Viewer, limit: ConsensusPolicy = DEFAULT_CONSENSUS): TestDTO {
  const hidden = test.datasetMode && !isLabelled(test, limit);
  const er = asObject<Record<string, unknown>>(test.engineResult);
  return {
    ...summarize(test, viewer, limit),
    sample: {
      id: test.sample.id,
      batchId: test.sample.batchId,
      customer: test.sample.customer,
      fibre: test.sample.fibre,
      construction: test.sample.construction,
      fabricType: test.sample.fabricType,
      baseShade: test.sample.baseShade,
      dominantHue: test.sample.dominantHue,
      dyeClass: test.sample.dyeClass,
      notes: test.sample.notes,
    },
    washTempC: test.washTempC,
    washTimeMin: test.washTimeMin,
    adjCount: test.adjCount,
    adj1Fibre: test.adj1Fibre,
    adj2Fibre: test.adj2Fibre,
    reqGradeChange: test.reqGradeChange,
    reqGradeStain: test.reqGradeStain,
    captureDevice: test.captureDevice,
    uploadMode: (test.uploadMode as TestDTO['uploadMode']) ?? 'separate',
    gradingError: test.gradingError,
    voidReason: test.voidReason,
    manualPoints: (test.manualPoints as TestDTO['manualPoints']) ?? null,
    engineResult: test.engineResult
      ? {
          warnings: asArray<string>(er.warnings),
          registration: (er.registration as NonNullable<TestDTO['engineResult']>['registration']) ?? null,
          engineVersion: (er.engine_version as string) ?? null,
          modelVersion: (er.model_version as string) ?? null,
        }
      : null,
    images: test.images.map(presentImage),
    grades: sortGrades(test.grades).map((g) => presentGrade(test, g, viewer, hidden, limit)),
    gradesHidden: hidden,
    labelled: test.datasetMode ? !hidden : true,
    reportUrl: test.reportPath ? fileUrl(test.reportPath) : null,
    canComplete: canComplete(test, viewer, limit),
  };
}

export function sortGrades<T extends { kind: string; createdAt: Date }>(grades: T[]): T[] {
  return [...grades].sort(
    (a, b) => KIND_ORDER.indexOf(a.kind as GradeKind) - KIND_ORDER.indexOf(b.kind as GradeKind) ||
      a.createdAt.getTime() - b.createdAt.getTime(),
  );
}
