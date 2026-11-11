import bcrypt from 'bcryptjs';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeGrade, fakeTest, makePrismaMock, users, type PrismaMock } from './helpers.js';

const prismaMock: PrismaMock = makePrismaMock();
vi.mock('../src/lib/prisma.js', () => ({ prisma: prismaMock }));

const { createApp } = await import('../src/app.js');
const { issueTokens } = await import('../src/services/authService.js');
const { presentTest } = await import('../src/services/presenter.js');
const { fileUrl, verifyToken, signPath } = await import('../src/services/fileService.js');
const { csvEscape } = await import('../src/utils/csv.js');
const { transition, missingPieces } = await import('../src/services/testService.js');

const app = createApp({ authRateLimit: 1000 });
const bearer = (u: { id: string; role: string }) => `Bearer ${issueTokens(u as never).accessToken}`;

beforeAll(async () => {
  (users.admin as { passwordHash: string }).passwordHash = await bcrypt.hash('Admin@12345', 4);
});

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.user.findUnique.mockImplementation(async ({ where }: { where: { id?: string; email?: string } }) =>
    Object.values(users).find((u) => u.id === where.id || u.email === where.email) ?? null);
  prismaMock.setting.findMany.mockResolvedValue([]);
});

describe('auth', () => {
  it('logs in, returns tokens and writes an audit row', async () => {
    const r = await request(app).post('/api/v1/auth/login').send({ email: 'admin@x.io', password: 'Admin@12345' });
    expect(r.status).toBe(200);
    expect(r.body.accessToken).toBeTruthy();
    expect(r.body.user.role).toBe('ADMIN');
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'LOGIN', userId: 'u-admin' }) }));
  });

  it('rejects a wrong password and audits the failure', async () => {
    const r = await request(app).post('/api/v1/auth/login').send({ email: 'admin@x.io', password: 'nope' });
    expect(r.status).toBe(401);
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'LOGIN_FAILED' }) }));
  });

  it('requires a token for /me and refuses a refresh token as access token', async () => {
    expect((await request(app).get('/api/v1/me')).status).toBe(401);
    const { refreshToken } = issueTokens(users.admin as never);
    expect((await request(app).get('/api/v1/me').set('Authorization', `Bearer ${refreshToken}`)).status).toBe(401);
    const ok = await request(app).get('/api/v1/me').set('Authorization', bearer(users.admin));
    expect(ok.status).toBe(200);
    expect(ok.body.email).toBe('admin@x.io');
  });

  it('refreshes tokens', async () => {
    const { refreshToken } = issueTokens(users.tester as never);
    const r = await request(app).post('/api/v1/auth/refresh').send({ refreshToken });
    expect(r.status).toBe(200);
    expect(r.body.user.id).toBe('u-tester');
  });
});

describe('RBAC', () => {
  it('blocks a tester from settings, users and dataset export', async () => {
    for (const path of ['/api/v1/settings', '/api/v1/users', '/api/v1/export/dataset.zip', '/api/v1/review']) {
      const r = await request(app).get(path).set('Authorization', bearer(users.tester));
      expect(r.status, path).toBe(403);
    }
  });
  it('lets an admin read settings and a tester read public settings', async () => {
    expect((await request(app).get('/api/v1/settings').set('Authorization', bearer(users.admin))).status).toBe(200);
    const pub = await request(app).get('/api/v1/settings/public').set('Authorization', bearer(users.tester));
    expect(pub.status).toBe(200);
    expect(pub.body.washMethods.length).toBeGreaterThan(0);
  });
  it('only admins can void', async () => {
    const r = await request(app).post('/api/v1/tests/t1/void').set('Authorization', bearer(users.expert)).send({ reason: 'mistake' });
    expect(r.status).toBe(403);
  });
});

describe('upload validation', () => {
  it('rejects non-image files', async () => {
    const r = await request(app).post('/api/v1/tests/t1/images').set('Authorization', bearer(users.tester))
      .field('role', 'SPECIMEN_BEFORE').attach('file', Buffer.from('hello'), { filename: 'evil.exe', contentType: 'application/octet-stream' });
    expect(r.status).toBe(400);
  });
  it('rejects an unknown image role', async () => {
    const r = await request(app).post('/api/v1/tests/t1/images').set('Authorization', bearer(users.tester))
      .field('role', 'NOT_A_ROLE').attach('file', Buffer.from([0xff, 0xd8, 0xff]), { filename: 'a.jpg', contentType: 'image/jpeg' });
    expect(r.status).toBe(400);
  });
});

describe('status machine', () => {
  it('refuses illegal transitions and concurrent changes', async () => {
    await expect(transition('t1', ['DRAFT'], 'COMPLETED')).rejects.toThrow(/illegal/);
    prismaMock.test.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.test.findUnique.mockResolvedValue({ status: 'PENDING_WASH' });
    await expect(transition('t1', ['DRAFT'], 'PENDING_WASH')).rejects.toMatchObject({ status: 409 });
  });
  it('requires an image + region for every piece before leaving DRAFT', () => {
    const img = (role: string, side: string, piece: string) => ({ id: role, role, side, regions: [{ id: `r-${role}`, piece, polygon: [] }] });
    const t = { adjCount: 2, images: [img('SPECIMEN_BEFORE', 'before', 'SPECIMEN'), img('ADJ1_BEFORE', 'before', 'ADJ1')] };
    expect(missingPieces(t as never, 'before')).toEqual(['ADJ2']);
    expect(missingPieces({ ...t, adjCount: 1 } as never, 'before')).toEqual([]);
    expect(missingPieces(t as never, 'after')).toEqual(['SPECIMEN', 'ADJ1', 'ADJ2']);
  });
  it('POST /mark-before-done returns 400 with the missing pieces', async () => {
    prismaMock.test.findUnique.mockResolvedValue(fakeTest({ status: 'DRAFT', grades: [] }));
    const r = await request(app).post('/api/v1/tests/t1/mark-before-done').set('Authorization', bearer(users.tester));
    expect(r.status).toBe(400);
    expect(r.body.error.details.missing).toEqual(['SPECIMEN', 'ADJ1', 'ADJ2']);
  });
});

describe('review: grades are immutable', () => {
  it('an override creates an ExpertGrade and never updates the Grade', async () => {
    prismaMock.grade.findUnique.mockResolvedValue({ ...fakeGrade(), test: fakeTest(), expertGrades: [] });
    prismaMock.expertGrade.create.mockResolvedValue({ id: 'e1' });
    prismaMock.test.findUnique.mockResolvedValue(fakeTest());
    const r = await request(app).post('/api/v1/grades/g1/expert').set('Authorization', bearer(users.expert)).send({ halfGrade: 4, reason: 'visible bleeding at edge' });
    expect(r.status).toBe(201);
    expect(prismaMock.expertGrade.create).toHaveBeenCalledWith({ data: expect.objectContaining({ gradeId: 'g1', halfGrade: 4, blind: false }) });
    expect(prismaMock.grade.update).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'OVERRIDE' }) }));
  });
  it('an override without a reason is rejected', async () => {
    prismaMock.grade.findUnique.mockResolvedValue({ ...fakeGrade(), test: fakeTest(), expertGrades: [] });
    const r = await request(app).post('/api/v1/grades/g1/expert').set('Authorization', bearer(users.expert)).send({ halfGrade: 3 });
    expect(r.status).toBe(400);
    expect(prismaMock.expertGrade.create).not.toHaveBeenCalled();
  });
  it('testers cannot add expert grades', async () => {
    const r = await request(app).post('/api/v1/grades/g1/expert').set('Authorization', bearer(users.tester)).send({ halfGrade: 4.5 });
    expect(r.status).toBe(403);
  });
});

describe('blind (dataset) mode', () => {
  const viewer = { id: 'u-expert', role: 'EXPERT' as const };
  it('hides engine grades until every grade is labelled', () => {
    const t = fakeTest({ datasetMode: true, grades: [fakeGrade({ expertGrades: [{ id: 'e1', userId: 'u-other', halfGrade: 4, blind: true, reason: null, createdAt: new Date(), user: { name: 'A' } }] })] });
    const dto = presentTest(t as never, viewer);
    expect(dto.gradesHidden).toBe(true);
    expect(dto.grades[0].halfGrade).toBeNull();
    expect(dto.grades[0].features).toBeNull();
    expect(dto.grades[0].heatmapUrl).toBeNull();
    expect(dto.grades[0].expertGrades).toHaveLength(0); // cannot see assessor A
    expect(dto.changeGrade).toBeNull();
  });
  it('reveals grades once A and B agree within 0.5', () => {
    const eg = (u: string, g: number, t: number) => ({ id: u, userId: u, halfGrade: g, blind: true, reason: null, createdAt: new Date(t), user: { name: u } });
    const t = fakeTest({ datasetMode: true, grades: [fakeGrade({ expertGrades: [eg('a', 4, 1), eg('b', 4.5, 2)] })] });
    const dto = presentTest(t as never, viewer);
    expect(dto.gradesHidden).toBe(false);
    expect(dto.grades[0].halfGrade).toBe(4.5);
    expect(dto.grades[0].effectiveGrade).toBe(4);
    expect(dto.labelled).toBe(true);
  });
});

describe('effective grade and pass/fail', () => {
  it('uses the expert override for pass/fail', () => {
    const t = fakeTest({ grades: [fakeGrade({ expertGrades: [{ id: 'e', userId: 'x', halfGrade: 3.5, blind: false, reason: 'r', createdAt: new Date(), user: { name: 'X' } }] })] });
    const dto = presentTest(t as never, { id: 'x', role: 'EXPERT' });
    expect(dto.grades[0].effectiveGrade).toBe(3.5);
    expect(dto.grades[0].effectivePass).toBe(false); // required 4
    expect(dto.overallPass).toBe(false);
    expect(dto.canComplete).toBe(true);
  });
});

describe('signed file URLs', () => {
  it('round-trips and rejects tampering or expiry', () => {
    const url = fileUrl('derived/t1/heatmap.png')!;
    const token = url.split('/files/')[1];
    expect(verifyToken(token)).toBe('derived/t1/heatmap.png');
    expect(verifyToken(token.slice(0, -2) + 'xx')).toBeNull();
    expect(verifyToken(signPath('a.png', -10))).toBeNull();
  });
  it('GET /files with a bad token is 404', async () => {
    expect((await request(app).get('/api/v1/files/garbage.token')).status).toBe(404);
  });
});

describe('csv', () => {
  it('escapes quotes and neutralises formulas', () => {
    expect(csvEscape('a,"b"')).toBe('"a,""b"""');
    expect(csvEscape('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvEscape(-3.5)).toBe('-3.5');
  });
});
