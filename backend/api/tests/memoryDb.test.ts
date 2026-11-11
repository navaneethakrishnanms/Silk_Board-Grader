/** In-memory Prisma implementation used by DATA_MODE=memory. */
import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { createMemoryPrisma } from '../src/lib/memoryDb.js';

type P = Record<string, Record<string, (a?: unknown) => Promise<unknown>>> & { $transaction: (fn: (tx: P) => Promise<unknown>) => Promise<unknown> };
const make = () => createMemoryPrisma() as unknown as P;

async function seed(p: P) {
  const u = (await p.user.create({ data: { name: 'T', email: 't@x.io', passwordHash: 'x', role: 'TESTER' } })) as { id: string };
  await p.sample.create({ data: { id: 'S1', fabricType: 'PLAIN', customer: 'Acme' } });
  const t = (await p.test.create({ data: { reportNo: 'SG-1', sampleId: 'S1', washMethod: 'W', createdById: u.id } })) as { id: string };
  return { u, t };
}

describe('memoryDb', () => {
  it('applies schema defaults', async () => {
    const p = make();
    const { t } = await seed(p);
    const row = (await p.test.findUnique({ where: { id: t.id } })) as Record<string, unknown>;
    expect(row).toMatchObject({ status: 'DRAFT', adjCount: 2, adj1Fibre: 'silk', adj2Fibre: 'cotton', datasetMode: false, uploadMode: 'separate', gradingError: null });
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it('creates nested has-many rows and resolves include/select/orderBy', async () => {
    const p = make();
    const { t, u } = await seed(p);
    await p.image.create({
      data: { testId: t.id, role: 'SPECIMEN_BEFORE', path: 'a', sha256: 'h', width: 1, height: 1, warnings: {}, uploadedBy: u.id,
        regions: { create: [{ piece: 'SPECIMEN', polygon: [[0, 0]] }, { piece: 'ADJ1', polygon: [[1, 1]] }] } },
    });
    const full = (await p.test.findUnique({
      where: { id: t.id },
      include: { sample: true, createdBy: { select: { name: true } }, images: { include: { regions: true }, orderBy: { uploadedAt: 'asc' } } },
    })) as { sample: { customer: string }; createdBy: Record<string, unknown>; images: { regions: unknown[] }[] };
    expect(full.sample.customer).toBe('Acme');
    expect(full.createdBy).toEqual({ name: 'T' });
    expect(full.images[0].regions).toHaveLength(2);
    const sel = await p.test.findUnique({ where: { id: t.id }, select: { status: true } });
    expect(sel).toEqual({ status: 'DRAFT' });
  });

  it('supports where operators, relation filters, OR and pagination', async () => {
    const p = make();
    const { u } = await seed(p);
    await p.sample.create({ data: { id: 'S2', fabricType: 'PRINTED', customer: 'Beta' } });
    for (let i = 2; i <= 5; i++) await p.test.create({ data: { reportNo: `SG-${i}`, sampleId: i % 2 ? 'S1' : 'S2', washMethod: 'W', createdById: u.id, status: i > 3 ? 'COMPLETED' : 'DRAFT' } });
    expect(await p.test.count({ where: { status: { in: ['COMPLETED'] } } })).toBe(2);
    expect(await p.test.count({ where: { status: { not: 'DRAFT' } } })).toBe(2);
    expect(await p.test.count({ where: { sample: { customer: { contains: 'bet' } } } })).toBe(2);
    expect(await p.test.count({ where: { OR: [{ reportNo: { startsWith: 'SG-5' } }, { sampleId: 'S2' }] } })).toBe(3);
    const page = (await p.test.findMany({ orderBy: { reportNo: 'desc' }, skip: 1, take: 2 })) as { reportNo: string }[];
    expect(page.map((x) => x.reportNo)).toEqual(['SG-4', 'SG-3']);
    expect(await p.test.count({ where: { createdAt: { gte: new Date(Date.now() - 60_000) } } })).toBe(5);
  });

  it('raises Prisma-compatible unique and not-found errors', async () => {
    const p = make();
    await seed(p);
    await expect(p.user.create({ data: { name: 'X', email: 't@x.io', passwordHash: 'x', role: 'ADMIN' } })).rejects.toMatchObject({ code: 'P2002' });
    await expect(p.user.update({ where: { id: 'nope' }, data: { name: 'y' } })).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });

  it('rolls back a failed transaction', async () => {
    const p = make();
    const { t } = await seed(p);
    await expect(p.$transaction(async (tx: P) => {
      await tx.test.update({ where: { id: t.id }, data: { status: 'VOID' } });
      throw new Error('boom');
    })).rejects.toThrow('boom');
    expect(((await p.test.findUnique({ where: { id: t.id } })) as { status: string }).status).toBe('DRAFT');
  });

  it('cascades region deletion with the image and supports updateMany/upsert/autoincrement', async () => {
    const p = make();
    const { t, u } = await seed(p);
    const img = (await p.image.create({ data: { testId: t.id, role: 'ADJ1_BEFORE', path: 'a', sha256: 'h', width: 1, height: 1, warnings: {}, uploadedBy: u.id, regions: { create: { piece: 'ADJ1', polygon: [] } } } })) as { id: string };
    await p.image.delete({ where: { id: img.id } });
    expect(await p.region.count()).toBe(0);
    expect(await p.test.updateMany({ where: { id: t.id, status: 'PENDING_WASH' }, data: { status: 'READY_TO_GRADE' } })).toEqual({ count: 0 });
    await p.setting.upsert({ where: { key: 'k' }, create: { key: 'k', value: 1 }, update: { value: 2 } });
    await p.setting.upsert({ where: { key: 'k' }, create: { key: 'k', value: 1 }, update: { value: 2 } });
    expect(((await p.setting.findUnique({ where: { key: 'k' } })) as { value: number }).value).toBe(2);
    const a1 = (await p.auditLog.create({ data: { action: 'X', entity: 'E', entityId: '1' } })) as { id: bigint };
    const a2 = (await p.auditLog.create({ data: { action: 'X', entity: 'E', entityId: '2' } })) as { id: bigint };
    expect(a2.id).toBe(a1.id + 1n);
  });

  it('returns copies, so callers cannot mutate stored rows', async () => {
    const p = make();
    const { t } = await seed(p);
    const row = (await p.test.findUnique({ where: { id: t.id } })) as { status: string };
    row.status = 'VOID';
    expect(((await p.test.findUnique({ where: { id: t.id } })) as { status: string }).status).toBe('DRAFT');
  });
});
