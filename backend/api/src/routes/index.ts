/** `/api/v1` routes (Section 6). RBAC on every route. */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as admin from '../controllers/adminController.js';
import * as auth from '../controllers/authController.js';
import * as tests from '../controllers/testController.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { imageUpload, modelUpload } from '../middleware/upload.js';

export function buildRouter(opts: { authRateLimit?: number } = {}) {
  const r = Router();
  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: opts.authRateLimit ?? 50, standardHeaders: 'draft-7', legacyHeaders: false });

  // public
  r.post('/auth/login', authLimiter, auth.postLogin);
  r.post('/auth/refresh', authLimiter, auth.postRefresh);
  r.get('/files/:token', admin.getFile); // signed URL
  r.get('/health', (_req, res) => { res.json({ ok: true, service: 'silkgrade-api' }); });

  r.use(requireAuth);
  const tester = requireRole('TESTER');
  const expert = requireRole('EXPERT');
  const adminOnly = requireRole('ADMIN');

  r.get('/me', auth.getMe);
  r.get('/dashboard', admin.getDashboard);
  r.get('/settings/public', admin.getPublic);

  r.post('/samples', tester, tests.upsertSample);
  r.get('/samples/:id', tests.getSample);

  r.post('/tests', tester, tests.create);
  r.get('/tests', tests.list);
  r.get('/tests/:id', tests.get);
  r.patch('/tests/:id', tester, tests.patch);
  r.post('/tests/:id/images', tester, imageUpload.single('file'), tests.uploadImage);
  r.delete('/tests/:id/images/:imageId', tester, tests.deleteImage);
  r.post('/tests/:id/regions/detect', tester, tests.detectRegions);
  r.put('/tests/:id/regions', tester, tests.saveRegions);
  r.post('/tests/:id/mark-before-done', tester, tests.markBeforeDone);
  r.post('/tests/:id/mark-after-done', tester, tests.markAfterDone);
  r.post('/tests/:id/alignment/check', tester, tests.checkAlignment);
  r.put('/tests/:id/alignment', tester, tests.setAlignment);
  r.post('/tests/:id/grade', tester, tests.grade);
  r.post('/tests/:id/send-to-review', tester, tests.sendToReview);
  r.post('/tests/:id/complete', tester, tests.complete); // service enforces expert for NEEDS_REVIEW
  r.post('/tests/:id/void', adminOnly, tests.voidTest);
  r.get('/tests/:id/report.pdf', tests.reportPdf);

  r.get('/review', expert, admin.getReview);
  r.post('/grades/:gradeId/expert', expert, admin.postExpertGrade);

  r.get('/export/tests.csv', expert, admin.exportCsv);
  r.get('/export/dataset.zip', adminOnly, admin.exportDataset);
  r.get('/dataset/stats', expert, admin.getDatasetStats);

  r.get('/settings', adminOnly, admin.getAllSettings);
  r.put('/settings', adminOnly, admin.putSettings);
  r.get('/users', adminOnly, admin.listUsers);
  r.post('/users', adminOnly, admin.createUser);
  r.patch('/users/:id', adminOnly, admin.updateUser);
  r.get('/models', adminOnly, admin.getModels);
  r.post('/models', adminOnly, modelUpload.single('file'), admin.postModel);
  r.post('/models/:id/activate', adminOnly, admin.activateModel);
  r.post('/models/:id/deactivate', adminOnly, admin.deactivateModel);
  r.get('/engine/health', adminOnly, admin.engineHealth);
  return r;
}
