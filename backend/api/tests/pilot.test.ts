/** WP7 pilot tools + WP6 model-bundle upload, on the in-memory database. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-pilot-'));
vi.stubEnv('DATA_MODE', 'memory');
vi.stubEnv('STORAGE_ROOT', storage);

const { prisma } = await import('../src/lib/prisma.js');
const pilot = await import('../src/services/pilotService.js');
const { uploadModel } = await import('../src/services/modelService.js');

async function gradedTest(sampleId: string, device: string, change: number, expert?: number) {
  const u = await prisma.user.upsert({ where: { email: 'p@x.io' }, create: { name: 'P', email: 'p@x.io', passwordHash: 'x', role: 'EXPERT' }, update: {} });
  await prisma.sample.upsert({ where: { id: sampleId }, create: { id: sampleId, fabricType: 'PLAIN' }, update: {} });
  const n = await prisma.test.count();
  const t = await prisma.test.create({ data: { reportNo: `SG-P-${n}`, sampleId, washMethod: 'W', createdById: u.id, status: 'COMPLETED', captureDevice: device } });
  await prisma.image.create({ data: { testId: t.id, role: 'SPECIMEN_BEFORE', side: 'before', path: 'x', sha256: 'h', width: 1, height: 1, device, warnings: {}, uploadedBy: u.id } });
  for (const [kind, r] of [['CHANGE_OVERALL', change], ['STAIN_ADJ1', 4.6]] as const) {
    const g = await prisma.grade.create({
      data: { testId: t.id, kind, isoRating: r, finalRating: r, halfGrade: Math.round(r * 2) / 2, ciLow: r - 0.1, ciHigh: r + 0.1, confidence: 'HIGH', decision: 'REVIEW', features: {}, engineVersion: '1', modelVersion: 'formula-only' },
    });
    if (expert !== undefined && kind === 'CHANGE_OVERALL') await prisma.expertGrade.create({ data: { gradeId: g.id, userId: u.id, halfGrade: expert } });
  }
  return t;
}

beforeAll(async () => {
  await gradedTest('REP-1', 'Pixel 8', 3.9, 4);
  await gradedTest('REP-1', 'Pixel 8', 4.1, 4);
  await gradedTest('REP-1', 'iPhone 15', 3.2, 3);
  await gradedTest('OTHER', 'Pixel 8', 5.0);
});

describe('pilot tools', () => {
  it('lists samples graded more than once', async () => {
    expect(await pilot.pilotSamples()).toEqual([{ sampleId: 'REP-1', tests: 3, devices: ['Pixel 8', 'iPhone 15'] }]);
  });

  it('repeatability: spread per grade kind', async () => {
    const r = await pilot.repeatability('REP-1');
    const ch = r.rows.find((x) => x!.kind === 'CHANGE_OVERALL')!;
    expect(ch).toMatchObject({ n: 3, min: 3.2, max: 4.1, range: 0.9, stable: false });
    expect(r.rows.find((x) => x!.kind === 'STAIN_ADJ1')).toMatchObject({ range: 0, stable: true });
  });

  it('device comparison warns when devices differ by more than 0.5', async () => {
    const d = await pilot.deviceComparison('REP-1');
    expect(d.devices).toEqual(['Pixel 8', 'iPhone 15']);
    const ch = d.rows.find((x) => x!.kind === 'CHANGE_OVERALL')!;
    expect(ch.perDevice).toEqual({ 'Pixel 8': 4, 'iPhone 15': 3.2 });
    expect(ch.warn).toBe(true);
    expect(d.rows.find((x) => x!.kind === 'STAIN_ADJ1')!.warn).toBe(false);
  });

  it('coverage counts labelled records per grade and highlights gaps', async () => {
    const c = await pilot.coverage();
    expect(c.labelledTests).toBe(3);
    const ch = c.table.find((r) => r.kind === 'CHANGE_OVERALL')!;
    expect(ch.counts.find((x) => x.grade === 4)).toEqual({ grade: 4, n: 2, low: true });
    expect(c.target).toEqual({ min: 400, max: 600 });
  });

  it('shadow report compares app and expert grades weekly', async () => {
    const s = await pilot.shadowReport();
    expect(s.weekly[0].n).toBe(3);
    expect(s.byKind).toEqual([{ kind: 'CHANGE_OVERALL', n: 3, exact: 1, withinHalf: 1 }]);
  });
});

describe('model bundle upload', () => {
  const up = (spec: Record<string, unknown>) => {
    const f = path.join(storage, `m-${Math.random()}.json`);
    fs.writeFileSync(f, JSON.stringify(spec));
    return uploadModel({ path: f, originalname: 'bundle.json' }, {}, { id: 'u', role: 'ADMIN' });
  };
  it('accepts every bundle type from training.run and keeps the synthetic flag', async () => {
    const m = await up({ name: 'm1_change', version: 'v-ord', type: 'ordinal_logistic', features: [], coef: [], theta: [], classes: [], synthetic: true, metrics: { validation: { qwk: 0.9 } } });
    expect(m.metrics).toMatchObject({ synthetic: true, validation: { qwk: 0.9 } });
    expect((await up({ name: 'm2_stain', version: 'v-lgbm', type: 'lgbm_ordinal', features: [], classes: [], onnx_b64_list: [] })).name).toBe('m2_stain');
  });
  it('rejects unknown types and incomplete bundles', async () => {
    await expect(up({ name: 'm1_change', version: 'x', type: 'mystery' })).rejects.toThrow(/Unknown model type/);
    await expect(up({ name: 'm1_change', version: 'y', type: 'lgbm_regressor', features: [] })).rejects.toThrow(/onnx_b64/);
  });
});
