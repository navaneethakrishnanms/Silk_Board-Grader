/** WP8: grading job state survives a restart (interrupted GRADING -> READY_TO_GRADE with an error). */
import { describe, expect, it, vi } from 'vitest';

vi.stubEnv('DATA_MODE', 'memory');
const { prisma } = await import('../src/lib/prisma.js');
const { recoverInterruptedJobs } = await import('../src/services/gradingService.js');

describe('recoverInterruptedJobs', () => {
  it('resets only GRADING tests and records why', async () => {
    const u = await prisma.user.create({ data: { name: 'T', email: 'j@x.io', passwordHash: 'x', role: 'TESTER' } });
    await prisma.sample.create({ data: { id: 'J1', fabricType: 'PLAIN' } });
    const a = await prisma.test.create({ data: { reportNo: 'SG-J-1', sampleId: 'J1', washMethod: 'W', createdById: u.id, status: 'GRADING' } });
    const b = await prisma.test.create({ data: { reportNo: 'SG-J-2', sampleId: 'J1', washMethod: 'W', createdById: u.id, status: 'COMPLETED' } });
    expect(await recoverInterruptedJobs()).toBe(1);
    const ra = await prisma.test.findUniqueOrThrow({ where: { id: a.id } });
    expect(ra.status).toBe('READY_TO_GRADE');
    expect(ra.gradingError).toMatch(/interrupted/);
    expect((await prisma.test.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('COMPLETED');
  });
});
