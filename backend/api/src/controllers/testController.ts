import type { Request, Response } from 'express';
import {
  alignmentSchema, createTestSchema, detectRegionsSchema, saveRegionsSchema, sampleSchema, testListQuerySchema,
  updateTestSchema, uploadImageSchema, voidSchema, type ImageRole, type Side,
} from '@silkgrade/shared';
import { prisma } from '../lib/prisma.js';
import { parse } from '../middleware/validate.js';
import { audit } from '../services/auditService.js';
import { completeTest, ensurePreviewReport } from '../services/completionService.js';
import { startGrading } from '../services/gradingService.js';
import { presentTest, summarize, testInclude } from '../services/presenter.js';
import { getConsensusPolicy } from '../services/settingsService.js';
import { absPath } from '../services/storageService.js';
import * as svc from '../services/testService.js';
import { badRequest, notFound } from '../utils/httpError.js';

const id = (req: Request) => String(req.params.id);

async function send(req: Request, res: Response, testId: string, status = 200) {
  const blindDisagreementLimit = await getConsensusPolicy();
  const t = await svc.loadTest(testId);
  res.status(status).json(presentTest(t, req.user!, blindDisagreementLimit));
}

export async function upsertSample(req: Request, res: Response) {
  const s = parse(sampleSchema, req.body);
  const sample = await prisma.sample.upsert({ where: { id: s.id }, create: s, update: { ...s, id: undefined } });
  await audit(req.user!.id, 'CREATE_SAMPLE', 'Sample', s.id);
  res.json(sample);
}

export async function getSample(req: Request, res: Response) {
  const sample = await prisma.sample.findUnique({ where: { id: id(req) } });
  if (!sample) throw notFound('Sample');
  const tests = await prisma.test.findMany({ where: { sampleId: sample.id }, include: testInclude, orderBy: { createdAt: 'desc' } });
  res.json({ ...sample, tests: tests.map((t) => summarize(t, req.user!)) });
}

export async function create(req: Request, res: Response) {
  const input = parse(createTestSchema, req.body);
  const t = await svc.createTest(input, req.user!);
  await send(req, res, t.id, 201);
}

export async function list(req: Request, res: Response) {
  const q = parse(testListQuerySchema, req.query);
  const blindDisagreementLimit = await getConsensusPolicy();
  res.json(await svc.listTests(q, req.user!, blindDisagreementLimit));
}

export const get = (req: Request, res: Response) => send(req, res, id(req));

export async function patch(req: Request, res: Response) {
  await svc.updateTest(id(req), parse(updateTestSchema, req.body), req.user!);
  await send(req, res, id(req));
}

export async function uploadImage(req: Request, res: Response) {
  const { role } = parse(uploadImageSchema, req.body);
  if (!req.file) throw badRequest('No file uploaded (field "file")');
  const side = req.body.side === 'before' || req.body.side === 'after' ? (req.body.side as Side) : undefined;
  await svc.uploadImage(id(req), role as ImageRole, req.file, req.user!, side);
  await send(req, res, id(req), 201);
}

export async function deleteImage(req: Request, res: Response) {
  await svc.deleteImage(id(req), String(req.params.imageId), req.user!);
  await send(req, res, id(req));
}

export async function detectRegions(req: Request, res: Response) {
  const { side } = parse(detectRegionsSchema, req.body);
  await svc.detectRegions(id(req), side, req.user!);
  await send(req, res, id(req));
}

export async function saveRegions(req: Request, res: Response) {
  await svc.saveRegions(id(req), parse(saveRegionsSchema, req.body), req.user!);
  await send(req, res, id(req));
}

export async function markBeforeDone(req: Request, res: Response) {
  await svc.markBeforeDone(id(req), req.user!);
  await send(req, res, id(req));
}

export async function markAfterDone(req: Request, res: Response) {
  await svc.markAfterDone(id(req), req.user!);
  await send(req, res, id(req));
}

export async function checkAlignment(req: Request, res: Response) {
  res.json(await svc.checkAlignment(id(req)));
}

export async function setAlignment(req: Request, res: Response) {
  const body = req.body?.clear ? null : parse(alignmentSchema, req.body);
  await svc.setAlignment(id(req), body, req.user!);
  await send(req, res, id(req));
}

export async function grade(req: Request, res: Response) {
  await startGrading(id(req), req.user!);
  await send(req, res, id(req), 202);
}

export async function sendToReview(req: Request, res: Response) {
  await svc.sendToReview(id(req), req.user!);
  await send(req, res, id(req));
}

export async function complete(req: Request, res: Response) {
  await completeTest(id(req), req.user!);
  await send(req, res, id(req));
}

export async function voidTest(req: Request, res: Response) {
  const { reason } = parse(voidSchema, req.body);
  await svc.voidTest(id(req), reason, req.user!);
  await send(req, res, id(req));
}

export async function reportPdf(req: Request, res: Response) {
  const rel = await ensurePreviewReport(id(req));
  const t = await svc.loadTest(id(req));
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${t.reportNo}.pdf"`);
  res.sendFile(absPath(rel));
}
