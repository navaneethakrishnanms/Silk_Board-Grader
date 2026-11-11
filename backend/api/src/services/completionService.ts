import { conflict, forbidden } from '../utils/httpError.js';
import { audit } from './auditService.js';
import { canComplete, type Viewer } from './presenter.js';
import { generateReport } from './reportService.js';
import { consensusPolicy, getSettings } from './settingsService.js';
import { ensureLocal } from './storageService.js';
import { loadTest, transition } from './testService.js';

/** Lock the test, generate the PDF, -> COMPLETED. */
export async function completeTest(id: string, user: Viewer) {
  const settings = await getSettings();
  const test = await loadTest(id);
  if (!['GRADED_AUTO', 'NEEDS_REVIEW'].includes(test.status)) throw conflict(`A ${test.status} test cannot be completed`);
  if (!canComplete(test, user, consensusPolicy(settings))) {
    if (test.status === 'NEEDS_REVIEW' && user.role === 'TESTER') throw forbidden('An expert must review this test');
    throw conflict(test.datasetMode ? 'All grades need blind expert labels first' : 'Every REVIEW grade needs an expert decision first');
  }
  const completedAt = new Date();
  const reportPath = await generateReport(test, { completedAt, final: true });
  await transition(id, [test.status], 'COMPLETED', { completedAt, reportPath });
  await audit(user.id, 'COMPLETE', 'Test', id, { reportPath, from: test.status });
  return loadTest(id);
}

export async function ensurePreviewReport(id: string) {
  const test = await loadTest(id);
  if (test.status === 'COMPLETED' && test.reportPath && (await ensureLocal(test.reportPath))) return test.reportPath;
  return generateReport(test, { completedAt: null, final: false });
}

