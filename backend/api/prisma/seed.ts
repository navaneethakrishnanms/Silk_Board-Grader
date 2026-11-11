/**
 * Seed: admin + expert + tester users, default settings, and 3 synthetic demo tests.
 *
 * Demo images come from the engine generator:
 *   cd backend/engine && python tools/make_synthetic.py --out ../../storage/demo --cases demo
 * If the engine service is running, the demo tests are inspected and graded;
 * otherwise they are left READY_TO_GRADE (grade them from the UI later).
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Piece } from '@silkgrade/shared';
import { env } from '../src/config/env.js';
import { prisma } from '../src/lib/prisma.js';
import { engineClient } from '../src/clients/engineClient.js';
import { hashPassword } from '../src/services/authService.js';
import { DEFAULT_SETTINGS } from '../src/services/settingsService.js';
import { ensureDir, relPath, sha256File } from '../src/services/storageService.js';

const USERS = [
  { name: 'Lab Admin', email: env.SEED_ADMIN_EMAIL, password: env.SEED_ADMIN_PASSWORD, role: 'ADMIN' as const },
  { name: 'Expert Assessor', email: 'expert@silkgrade.local', password: 'Expert@12345', role: 'EXPERT' as const },
  { name: 'Expert Assessor B', email: 'expert2@silkgrade.local', password: 'Expert@12345', role: 'EXPERT' as const },
  { name: 'Lab Tester', email: 'tester@silkgrade.local', password: 'Tester@12345', role: 'TESTER' as const },
];

function pngSize(file: string): { width: number; height: number } {
  const b = Buffer.alloc(24);
  const fd = fs.openSync(file, 'r');
  fs.readSync(fd, b, 0, 24, 0);
  fs.closeSync(fd);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

async function seedUsers() {
  for (const u of USERS) {
    await prisma.user.upsert({
      where: { email: u.email },
      create: { name: u.name, email: u.email, role: u.role, passwordHash: await hashPassword(u.password) },
      update: {},
    });
  }
  console.log(`users: ${USERS.map((u) => `${u.email} (${u.role})`).join(', ')}`);
}

async function seedSettings() {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await prisma.setting.upsert({ where: { key }, create: { key, value: value as never }, update: {} });
  }
}

async function seedDemo() {
  const demoDir = path.join(env.storageRoot, 'demo');
  const manifestPath = path.join(demoDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.log(`no demo images at ${manifestPath} — run: python backend/engine/tools/make_synthetic.py --out storage/demo --cases demo`);
    return;
  }
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: env.SEED_ADMIN_EMAIL } });
  const tester = await prisma.user.findUnique({ where: { email: 'tester@silkgrade.local' } });
  const owner = tester ?? admin;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
    cases: { name: string; description: string; request: { fabric_type: 'PLAIN' | 'PRINTED'; adj_count: number; pairs: Record<string, Record<'before' | 'after', { path: string; polygon: [number, number][] }>> } }[];
  };
  let engineUp = false;
  try { await engineClient.health(); engineUp = true; } catch { /* engine offline */ }

  for (const [i, c] of manifest.cases.entries()) {
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
        reportNo: `SG-${year}-${String(count + 1).padStart(6, '0')}`, sampleId, washMethod: 'ISO 105-C10 A (40 °C, 30 min)',
        washTempC: 40, washTimeMin: 30, adjCount: c.request.adj_count, adj1Fibre: 'silk', adj2Fibre: c.request.adj_count > 1 ? 'cotton' : null,
        reqGradeChange: 4, reqGradeStain: 3.5, status: 'READY_TO_GRADE', createdById: owner.id, captureDevice: 'synthetic',
      },
    });
    await ensureDir(`originals/${test.id}`);
    for (const [pair, sides] of Object.entries(c.request.pairs)) {
      for (const side of ['before', 'after'] as const) {
        const src = path.join(demoDir, sides[side].path);
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
          warnings = info.warnings; previewPath = info.preview_path; device = info.device;
        }
        await prisma.image.create({
          data: {
            testId: test.id, role, side, path: rel, previewPath, fileName: path.basename(src), sizeBytes: fs.statSync(dest).size,
            sha256: await sha256File(dest), width, height, device, warnings, uploadedBy: owner.id,
            regions: { create: [{ piece: pair.toUpperCase() as Piece, polygon: sides[side].polygon, autoDetected: false, editedBy: owner.id }] },
          },
        });
      }
    }
    if (engineUp) {
      const { runJob } = await import('../src/services/gradingService.js');
      await prisma.test.update({ where: { id: test.id }, data: { status: 'GRADING' } });
      await runJob(test.id, { id: owner.id, role: owner.role });
    }
    const after = await prisma.test.findUniqueOrThrow({ where: { id: test.id } });
    console.log(`demo test ${after.reportNo} (${c.name}) -> ${after.status}${after.gradingError ? ` (${after.gradingError})` : ''}`);
  }
  if (!engineUp) console.log('engine-svc not reachable: demo tests left READY_TO_GRADE');
}

async function main() {
  await Promise.all(['originals', 'derived', 'reports', 'models'].map((d) => ensureDir(d)));
  await seedUsers();
  await seedSettings();
  if (env.SEED_DEMO === 'true') await seedDemo();
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
