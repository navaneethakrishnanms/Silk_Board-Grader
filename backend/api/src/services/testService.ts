/** Test workflow + status machine (Section 6). */
import type { Prisma } from '@prisma/client';
import {
  canTransition, type AlignmentInput, type CreateTestInput, type ImageRole, type Piece, type SaveRegionsInput,
  type Side, type TestListQuery, type TestStatus, type UpdateTestInput,
} from '@silkgrade/shared';
import { engineClient } from '../clients/engineClient.js';
import { prisma } from '../lib/prisma.js';
import { badRequest, conflict, notFound } from '../utils/httpError.js';
import { asArray } from '../utils/json.js';
import { audit } from './auditService.js';
import { summarize, testInclude, type FullTest, type Viewer } from './presenter.js';
import { storeOriginal } from './storageService.js';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

export function roleSide(role: ImageRole, status: TestStatus, requested?: Side | null): Side {
  if (role.endsWith('_BEFORE')) return 'before';
  if (role.endsWith('_AFTER')) return 'after';
  if (requested) return requested;
  return status === 'DRAFT' ? 'before' : 'after';
}

export function rolePiece(role: ImageRole): Piece | null {
  if (role.startsWith('SPECIMEN')) return 'SPECIMEN';
  if (role.startsWith('ADJ1')) return 'ADJ1';
  if (role.startsWith('ADJ2')) return 'ADJ2';
  if (role === 'REF_CARD') return 'REF_CARD';
  return null; // composite: all pieces
}

export function requiredPieces(adjCount: number): Piece[] {
  return adjCount >= 2 ? ['SPECIMEN', 'ADJ1', 'ADJ2'] : ['SPECIMEN', 'ADJ1'];
}

type TestWithImages = Prisma.TestGetPayload<{ include: { images: { include: { regions: true } } } }>;

/** Image + region holding `piece` on `side` (dedicated image preferred over composite). */
export function findPieceRef(test: TestWithImages, piece: Piece, side: Side) {
  const imgs = test.images.filter((i) => i.side === side);
  const ordered = [...imgs].sort((a, b) => Number(a.role.startsWith('COMPOSITE')) - Number(b.role.startsWith('COMPOSITE')));
  for (const img of ordered) {
    const reg = [...img.regions].reverse().find((r) => r.piece === piece);
    if (reg) return { image: img, region: reg };
  }
  return null;
}

/** Missing pieces (image + confirmed region) for one side. */
export function missingPieces(test: TestWithImages, side: Side): Piece[] {
  return requiredPieces(test.adjCount).filter((p) => !findPieceRef(test, p, side));
}

export async function loadTest(id: string): Promise<FullTest> {
  const t = await prisma.test.findUnique({ where: { id }, include: testInclude });
  if (!t) throw notFound('Test');
  return t;
}

/** Atomic status change; fails if the status changed concurrently. */
export async function transition(id: string, from: TestStatus[], to: TestStatus, data: Prisma.TestUpdateManyMutationInput = {}) {
  for (const f of from) if (!canTransition(f, to)) throw new Error(`illegal transition ${f} -> ${to}`);
  const r = await prisma.test.updateMany({ where: { id, status: { in: from } }, data: { ...data, status: to } });
  if (r.count !== 1) {
    const cur = await prisma.test.findUnique({ where: { id }, select: { status: true } });
    if (!cur) throw notFound('Test');
    throw conflict(`Test is ${cur.status}; expected ${from.join(' or ')}`);
  }
}

async function nextReportNo(tx: Prisma.TransactionClient): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `SG-${year}-`;
  const last = await tx.test.findFirst({ where: { reportNo: { startsWith: prefix } }, orderBy: { reportNo: 'desc' }, select: { reportNo: true } });
  const n = last ? Number(last.reportNo.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(n).padStart(6, '0')}`;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function createTest(input: CreateTestInput, user: Viewer) {
  const { sample, uploadMode, ...t } = input;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const created = await prisma.$transaction(async (tx) => {
        await tx.sample.upsert({
          where: { id: sample.id },
          create: { ...sample },
          update: { ...sample, id: undefined },
        });
        const reportNo = await nextReportNo(tx);
        const test = await tx.test.create({
          data: {
            ...t,
            adj2Fibre: t.adjCount === 2 ? (t.adj2Fibre ?? 'cotton') : null,
            uploadMode,
            reportNo,
            sampleId: sample.id,
            createdById: user.id,
          },
        });
        await audit(user.id, 'CREATE_TEST', 'Test', test.id, { reportNo, sampleId: sample.id }, tx);
        return test;
      });
      return loadTest(created.id);
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002' && attempt < 4) continue; // reportNo race
      throw err;
    }
  }
  throw conflict('Could not allocate a report number');
}

export async function updateTest(id: string, input: UpdateTestInput, user: Viewer) {
  const test = await loadTest(id);
  if (!['DRAFT', 'PENDING_WASH'].includes(test.status)) throw conflict('Test details can only be edited before washing');
  const { sample, ...t } = input;
  if (t.adjCount === 1 && test.images.some((i) => i.role.startsWith('ADJ2'))) throw conflict('Delete adjacent-2 images first');
  if (t.uploadMode && t.uploadMode !== test.uploadMode && test.images.length) throw conflict('Delete images before changing upload mode');
  await prisma.$transaction(async (tx) => {
    if (sample && Object.keys(sample).length) await tx.sample.update({ where: { id: test.sampleId }, data: sample });
    await tx.test.update({ where: { id }, data: { ...t, ...(t.adjCount === 1 ? { adj2Fibre: null } : {}) } });
    await audit(user.id, 'UPDATE_TEST', 'Test', id, { fields: Object.keys(input) }, tx);
  });
  return loadTest(id);
}

export async function listTests(q: TestListQuery, viewer: Viewer, limit = 0.5) {
  const where: Prisma.TestWhereInput = {};
  if (q.status) where.status = { in: q.status.split(',') as TestStatus[] };
  if (q.sampleId) where.sampleId = { contains: q.sampleId };
  const sampleWhere: Prisma.SampleWhereInput = {};
  if (q.batchId) sampleWhere.batchId = { contains: q.batchId };
  if (q.customer) sampleWhere.customer = { contains: q.customer };
  if (Object.keys(sampleWhere).length) where.sample = sampleWhere;
  if (q.q) where.OR = [{ reportNo: { contains: q.q } }, { sampleId: { contains: q.q } }, { sample: { customer: { contains: q.q } } }];
  if (q.from || q.to) {
    where.createdAt = {};
    if (q.from) where.createdAt.gte = new Date(q.from);
    if (q.to) where.createdAt.lte = new Date(new Date(q.to).getTime() + 86_399_999);
  }
  const needsMemoryFilter = !!q.pass || q.gradeMin !== undefined || q.gradeMax !== undefined;
  const rows = await prisma.test.findMany({
    where, include: testInclude, orderBy: { createdAt: 'desc' },
    skip: needsMemoryFilter ? 0 : (q.page - 1) * q.pageSize,
    take: needsMemoryFilter ? 2000 : q.pageSize,
  });
  let items = rows.map((t) => summarize(t, viewer, limit));
  if (needsMemoryFilter) {
    if (q.pass) items = items.filter((i) => i.overallPass === (q.pass === 'pass'));
    if (q.gradeMin !== undefined) items = items.filter((i) => i.changeGrade !== null && i.changeGrade >= q.gradeMin!);
    if (q.gradeMax !== undefined) items = items.filter((i) => i.changeGrade !== null && i.changeGrade <= q.gradeMax!);
    const total = items.length;
    return { items: items.slice((q.page - 1) * q.pageSize, q.page * q.pageSize), total, page: q.page, pageSize: q.pageSize };
  }
  const total = await prisma.test.count({ where });
  return { items, total, page: q.page, pageSize: q.pageSize };
}

// ---------------------------------------------------------------------------
// images
// ---------------------------------------------------------------------------

export async function uploadImage(
  id: string, role: ImageRole, file: { path: string; originalname: string; size: number }, user: Viewer, requestedSide?: Side,
) {
  const test = await loadTest(id);
  const side = roleSide(role, test.status, requestedSide);
  if (side === 'before' && test.status !== 'DRAFT') throw conflict('Before-wash images can only be uploaded while the test is a draft');
  if (side === 'after' && !['PENDING_WASH', 'READY_TO_GRADE'].includes(test.status)) {
    throw conflict('After-wash images can be uploaded once the before-wash set is saved');
  }
  if (role.startsWith('ADJ2') && test.adjCount < 2) throw badRequest('This test has only one adjacent fabric');
  if (role.startsWith('COMPOSITE') && test.uploadMode !== 'single') throw badRequest('Composite images need upload mode "single"');
  if (/^(SPECIMEN|ADJ)/.test(role) && test.uploadMode === 'single') throw badRequest('Upload mode is "single": use the composite slot');

  const stored = await storeOriginal(file.path, id, role, file.originalname);
  const info = await engineClient.inspect(stored.rel, role.startsWith('ADJ'));

  const replaced = test.images.filter((i) => i.role === role && i.side === side);
  const image = await prisma.$transaction(async (tx) => {
    for (const old of replaced) {
      await tx.region.deleteMany({ where: { imageId: old.id } });
      await tx.image.delete({ where: { id: old.id } }); // original file stays on disk
    }
    const img = await tx.image.create({
      data: {
        testId: id, role, side, path: stored.rel, previewPath: info.preview_path, fileName: file.originalname,
        sizeBytes: stored.size, sha256: stored.sha256, width: info.width, height: info.height, device: info.device,
        warnings: info.warnings, uploadedBy: user.id,
      },
    });
    if (side === 'after' && test.status === 'READY_TO_GRADE') {
      await tx.test.update({ where: { id }, data: { status: 'PENDING_WASH' } });
    }
    await audit(user.id, 'UPLOAD', 'Image', img.id, { testId: id, role, side, sha256: stored.sha256, replaced: replaced.map((r) => r.id) }, tx);
    return img;
  });
  if (info.sha256 && info.sha256 !== stored.sha256) throw conflict('Hash mismatch between API and engine');
  return image;
}

export async function deleteImage(id: string, imageId: string, user: Viewer) {
  const test = await loadTest(id);
  const img = test.images.find((i) => i.id === imageId);
  if (!img) throw notFound('Image');
  const editable = img.side === 'before' ? test.status === 'DRAFT' : ['PENDING_WASH', 'READY_TO_GRADE'].includes(test.status);
  if (!editable) throw conflict('Images can only be deleted before grading, on the side currently being edited');
  await prisma.$transaction(async (tx) => {
    await tx.region.deleteMany({ where: { imageId } });
    await tx.image.delete({ where: { id: imageId } });
    if (img.side === 'after' && test.status === 'READY_TO_GRADE') await tx.test.update({ where: { id }, data: { status: 'PENDING_WASH' } });
    await audit(user.id, 'DELETE_IMAGE', 'Image', imageId, { testId: id, role: img.role }, tx);
  });
}

// ---------------------------------------------------------------------------
// regions
// ---------------------------------------------------------------------------

function sideEditable(status: TestStatus, side: Side) {
  return side === 'before' ? status === 'DRAFT' : ['PENDING_WASH', 'READY_TO_GRADE'].includes(status);
}

export async function detectRegions(id: string, side: Side, user: Viewer) {
  const test = await loadTest(id);
  if (!sideEditable(test.status, side)) throw conflict(`Cannot edit ${side}-wash regions in status ${test.status}`);
  const imgs = test.images.filter((i) => i.side === side);
  if (!imgs.length) throw badRequest(`Upload ${side}-wash images first`);
  const results: { img: (typeof imgs)[number]; regions: Awaited<ReturnType<typeof engineClient.detectRegions>>['regions'] }[] = [];
  for (const img of imgs) {
    const piece = rolePiece(img.role);
    const expected = piece ? [piece] : requiredPieces(test.adjCount);
    const det = await engineClient.detectRegions(img.path, expected);
    results.push({ img, regions: det.regions });
  }
  await prisma.$transaction(async (tx) => {
    for (const { img, regions } of results) {
      await tx.region.deleteMany({ where: { imageId: img.id } });
      for (const r of regions) {
        await tx.region.create({
          data: { imageId: img.id, piece: r.piece_guess, polygon: r.polygon, autoDetected: true, stats: { confidence: r.confidence } },
        });
      }
    }
    await audit(user.id, 'DETECT_REGIONS', 'Test', id, { side, images: imgs.length }, tx);
  });
  return loadTest(id);
}

export async function saveRegions(id: string, input: SaveRegionsInput, user: Viewer) {
  const test = await loadTest(id);
  const byId = new Map(test.images.map((i) => [i.id, i]));
  for (const r of input.regions) {
    const img = byId.get(r.imageId);
    if (!img) throw badRequest(`Image ${r.imageId} does not belong to this test`);
    if (!sideEditable(test.status, img.side as Side)) throw conflict(`Cannot edit ${img.side}-wash regions in status ${test.status}`);
    for (const [x, y] of r.polygon) {
      if (x < -1 || y < -1 || x > img.width + 1 || y > img.height + 1) throw badRequest('Polygon point outside the image');
    }
    const fixed = rolePiece(img.role);
    if (fixed && fixed !== r.piece && img.role !== 'REF_CARD') throw badRequest(`Image ${img.role} can only hold piece ${fixed}`);
  }
  const imageIds = [...new Set(input.regions.map((r) => r.imageId))];
  await prisma.$transaction(async (tx) => {
    await tx.region.deleteMany({ where: { imageId: { in: imageIds } } });
    for (const r of input.regions) {
      await tx.region.create({
        data: { imageId: r.imageId, piece: r.piece as Piece, polygon: r.polygon, autoDetected: !r.edited, editedBy: r.edited ? user.id : null },
      });
    }
    await audit(user.id, 'SAVE_REGIONS', 'Test', id, { images: imageIds, count: input.regions.length }, tx);
  });
  return loadTest(id);
}

// ---------------------------------------------------------------------------
// status steps
// ---------------------------------------------------------------------------

export async function markBeforeDone(id: string, user: Viewer) {
  const test = await loadTest(id);
  const missing = missingPieces(test, 'before');
  if (missing.length) throw unprocessableMissing('before', missing);
  await transition(id, ['DRAFT'], 'PENDING_WASH');
  await audit(user.id, 'MARK_BEFORE_DONE', 'Test', id);
  return loadTest(id);
}

export async function markAfterDone(id: string, user: Viewer) {
  const test = await loadTest(id);
  const missing = missingPieces(test, 'after');
  if (missing.length) throw unprocessableMissing('after', missing);
  await transition(id, ['PENDING_WASH'], 'READY_TO_GRADE', { gradingError: null });
  await audit(user.id, 'MARK_AFTER_DONE', 'Test', id);
  return loadTest(id);
}

function unprocessableMissing(side: Side, missing: Piece[]) {
  return badRequest(`Missing ${side}-wash image or confirmed region for: ${missing.join(', ')}`, { missing });
}

export async function checkAlignment(id: string) {
  const test = await loadTest(id);
  const b = findPieceRef(test, 'SPECIMEN', 'before');
  const a = findPieceRef(test, 'SPECIMEN', 'after');
  if (!b || !a) throw badRequest('Specimen before and after regions are required');
  return engineClient.register(
    { path: b.image.path, polygon: asArray(b.region.polygon) as [number, number][] },
    { path: a.image.path, polygon: asArray(a.region.polygon) as [number, number][] },
  );
}

export async function setAlignment(id: string, input: AlignmentInput | null, user: Viewer) {
  const test = await loadTest(id);
  if (!['PENDING_WASH', 'READY_TO_GRADE'].includes(test.status)) throw conflict('Alignment can be set only before grading');
  await prisma.test.update({ where: { id }, data: { manualPoints: input ?? undefined } });
  await audit(user.id, 'SET_ALIGNMENT', 'Test', id, { manual: !!input });
  return loadTest(id);
}

export async function voidTest(id: string, reason: string, user: Viewer) {
  const test = await loadTest(id);
  if (test.status === 'COMPLETED' || test.status === 'VOID') throw conflict(`A ${test.status} test cannot be voided`);
  await transition(id, [test.status], 'VOID', { voidReason: reason });
  await audit(user.id, 'VOID', 'Test', id, { reason, from: test.status });
  return loadTest(id);
}

/** GRADED_AUTO -> NEEDS_REVIEW (tester asks for an expert look). */
export async function sendToReview(id: string, user: Viewer) {
  await transition(id, ['GRADED_AUTO'], 'NEEDS_REVIEW');
  await audit(user.id, 'UPDATE_TEST', 'Test', id, { action: 'SEND_TO_REVIEW' });
  return loadTest(id);
}
