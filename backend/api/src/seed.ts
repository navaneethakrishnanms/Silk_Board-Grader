/**
 * Seed data: users, default settings, and demo tests built from the synthetic generator.
 * Used by `npm run seed` (MySQL) and automatically on start in DATA_MODE=memory.
 *
 * Demo images: python backend/engine/tools/make_synthetic.py --out storage/demo --cases demo
 * Demo tests: plain (graded), printed (graded), stained (left PENDING_WASH — before images only).
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Piece } from '@silkgrade/shared';
import { engineClient } from './clients/engineClient.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { hashPassword } from './services/authService.js';
import { DEFAULT_SETTINGS } from './services/settingsService.js';
import { ensureDir, relPath, sha256File } from './services/storageService.js';

export const DEMO_USERS = [
  { name: 'Lab Admin', email: env.SEED_ADMIN_EMAIL, password: env.SEED_ADMIN_PASSWORD, role: 'ADMIN' as const },
  { name: 'Expert Assessor A', email: 'expert@silkgrade.local', password: 'Expert@12345', role: 'EXPERT' as const },
  { name: 'Expert Assessor B', email: 'expert2@silkgrade.local', password: 'Expert@12345', role: 'EXPERT' as const },
  { name: 'Lab Tester', email: 'tester@silkgrade.local', password: 'Tester@12345', role: 'TESTER' as const },
];

interface DemoCase {
  name: string;
  description: string;
  request: {
    fabric_type: 'PLAIN' | 'PRINTED';
    adj_count: number;
    pairs: Record<string, Record<'before' | 'after', { path: string; polygon: [number, number][] }>>;
  };
}

/** Which demo case becomes which kind of demo test. */
const DEMO_PLAN: Record<string, 'graded' | 'pending'> = {
  plain_shift_3_4: 'graded',
  printed_motif_fade: 'graded',
  stained_white_8_5: 'pending',
};

function pngSize(file: string): { width: number; height: number } {
  const b = Buffer.alloc(24);
  const fd = fs.openSync(file, 'r');
  fs.readSync(fd, b, 0, 24, 0);
  fs.closeSync(fd);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

export async function waitForEngine(timeoutMs: number): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      await engineClient.health();
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  return false;
}

async function seedUsers() {
  for (const u of DEMO_USERS) {
    await prisma.user.upsert({
      where: { email: u.email },
      create: { name: u.name, email: u.email, role: u.role, passwordHash: await hashPassword(u.password) },
      update: {},
    });
  }
}

async function seedSettings() {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await prisma.setting.upsert({ where: { key }, create: { key, value: value as never }, update: {} });
  }
}

async function seedDemo(engineUp: boolean) {
  const demoDir = path.join(env.storageRoot, 'demo');
  const manifestPath = path.join(demoDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    logger.warn(`no demo images at ${manifestPath} — run: python backend/engine/tools/make_synthetic.py --out storage/demo --cases demo`);
    return;
  }
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: 'tester@silkgrade.local' } });
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { cases: DemoCase[] };
  const cases = manifest.cases.filter((c) => DEMO_PLAN[c.name]);

  for (const [i, c] of cases.entries()) {
    const plan = DEMO_PLAN[c.name];
    const sampleId = `DEMO-${String(i + 1).padStart(3, '0')}`;
    if (await prisma.test.findFirst({ where: { sampleId } })) continue;
    await prisma.sample.upsert({
      where: { id: sampleId },
      create: { id: sampleId, batchId: 'DEMO', customer: 'Synthetic demo', fabricType: c.request.fabric_type, construction: 'satin', notes: c.description },
      update: {},
    });
    const year = new Date().getFullYear();
    const count = await prisma.test.count({ where: { reportNo: { startsWith: `SG-${year}-` } } });
    const test = await prisma.test.create({
      data: {
        reportNo: `SG-${year}-${String(count + 1).padStart(6, '0')}`, sampleId, washMethod: DEFAULT_SETTINGS.washMethods[0],
        washTempC: 40, washTimeMin: 30, adjCount: c.request.adj_count, adj1Fibre: 'silk',
        adj2Fibre: c.request.adj_count > 1 ? 'cotton' : null, reqGradeChange: 4, reqGradeStain: 3.5,
        status: plan === 'pending' ? 'PENDING_WASH' : 'READY_TO_GRADE', createdById: owner.id, captureDevice: 'synthetic',
      },
    });
    await ensureDir(`originals/${test.id}`);
    const sides = plan === 'pending' ? (['before'] as const) : (['before', 'after'] as const);
    for (const [pair, refs] of Object.entries(c.request.pairs)) {
      for (const side of sides) {
        const src = path.join(demoDir, refs[side].path);
        const role = `${pair.toUpperCase()}_${side.toUpperCase()}` as 'SPECIMEN_BEFORE';
        const dest = path.join(env.storageRoot, 'originals', test.id, `${role.toLowerCase()}-demo.png`);
        fs.copyFileSync(src, dest);
        const rel = relPath(dest);
        let { width, height } = pngSize(dest);
        let warnings: Record<string, boolean> = {};
        let previewPath: string | null = null;
        let device: string | null = null;
        if (engineUp) {
          const info = await engineClient.inspect(rel, pair.startsWith('adj'));
          ({ width, height } = info);
          warnings = info.warnings;
          previewPath = info.preview_path;
          device = info.device;
        }
        await prisma.image.create({
          data: {
            testId: test.id, role, side, path: rel, previewPath, fileName: path.basename(src), sizeBytes: fs.statSync(dest).size,
            sha256: await sha256File(dest), width, height, device, warnings, uploadedBy: owner.id,
            regions: { create: [{ piece: pair.toUpperCase() as Piece, polygon: refs[side].polygon, autoDetected: false, editedBy: owner.id }] },
          },
        });
      }
    }
    if (engineUp && plan === 'graded') {
      const { runJob } = await import('./services/gradingService.js');
      await prisma.test.update({ where: { id: test.id }, data: { status: 'GRADING' } });
      await runJob(test.id, { id: owner.id, role: owner.role });
    }
    const after = await prisma.test.findUniqueOrThrow({ where: { id: test.id } });
    logger.info(`demo test ${after.reportNo} (${c.name}) -> ${after.status}${after.gradingError ? ` (${after.gradingError})` : ''}`);
  }
  if (!engineUp) logger.warn('engine-svc not reachable: demo tests were not graded');
}

export async function runSeed(opts: { demo: boolean; engineWaitMs?: number }) {
  await Promise.all(['originals', 'derived', 'reports', 'models'].map((d) => ensureDir(d)));
  await seedUsers();
  await seedSettings();
  if (opts.demo) {
    const engineUp = await waitForEngine(opts.engineWaitMs ?? 2000);
    await seedDemo(engineUp);
  }
}
