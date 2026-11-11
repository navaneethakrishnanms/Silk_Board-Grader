/** PDF report (Section 13), generated with pdfkit into storage/reports/<testId>/. */
import fs from 'node:fs';
import PDFDocument from 'pdfkit';
import { GRADE_CODE, GRADE_KIND_LABEL, gradeLabel, isChangeKind, type GradeKind } from '@silkgrade/shared';
import { asObject } from '../utils/json.js';
import { effectiveGrade, sortGrades, type FullTest } from './presenter.js';
import { getSettings } from './settingsService.js';
import { absPath, ensureDir, exists, mirror } from './storageService.js';

const APP_VERSION = '1.0.0';

/** The built-in PDF fonts (Helvetica, WinAnsi) cannot show every Unicode character;
 *  map the few we use to safe equivalents so nothing renders as a replacement glyph. */
export function pdfSafe(s: string): string {
  return s
    .replace(/[\u2014\u2013]/g, '-')
    .replace(/\u00b7/g, '|')
    .replace(/\u0394/g, 'd')
    .replace(/\s?\u00b0/g, ' deg ')
    .replace(/\u2026/g, '...')
    .replace(/[^\t\n\r\x20-\x7e\u00a0-\u00ff]/g, '?');
}

const GREY = '#555555';

export async function generateReport(test: FullTest, opts: { completedAt: Date | null; final: boolean }): Promise<string> {
  const settings = await getSettings();
  const dir = `reports/${test.id}`;
  await ensureDir(dir);
  const rel = `${dir}/${test.reportNo}${opts.final ? '' : '-preview'}.pdf`;
  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true, info: { Title: `SilkGrade report ${test.reportNo}` } });
  const rawText = doc.text.bind(doc) as (...a: unknown[]) => PDFKit.PDFDocument;
  (doc as unknown as { text: (...a: unknown[]) => PDFKit.PDFDocument }).text = (t: unknown, ...rest: unknown[]) =>
    rawText(typeof t === 'string' ? pdfSafe(t) : t, ...rest);
  const out = fs.createWriteStream(absPath(rel));
  doc.pipe(out);
  const W = doc.page.width - 80;
  const hidden = test.datasetMode && !opts.final && test.grades.some((g) => g.expertGrades.length === 0);

  // 1. header
  doc.fontSize(15).fillColor('#111').text(settings.labName, { width: W });
  doc.fontSize(10).fillColor(GREY)
    .text(`Colour fastness to washing — instrument-assisted grading`)
    .text(`Report no. ${test.reportNo}   ·   Date ${(opts.completedAt ?? new Date()).toISOString().slice(0, 10)}   ·   SilkGrade v${APP_VERSION}`);
  if (!opts.final) doc.fillColor('#b45309').text('PREVIEW — not a final report');
  doc.moveDown(0.6).moveTo(40, doc.y).lineTo(40 + W, doc.y).strokeColor('#ccc').stroke().moveDown(0.6);

  // 2. sample and test details
  section(doc, 'Sample and test');
  const s = test.sample;
  kv(doc, [
    ['Sample ID', s.id], ['Batch', s.batchId], ['Customer', s.customer], ['Fibre', s.fibre],
    ['Construction', s.construction], ['Fabric type', s.fabricType], ['Wash method', test.washMethod],
    ['Temperature', test.washTempC != null ? `${test.washTempC} °C` : null], ['Time', test.washTimeMin != null ? `${test.washTimeMin} min` : null],
    ['Adjacent fabrics', [test.adj1Fibre, test.adjCount > 1 ? test.adj2Fibre : null].filter(Boolean).join(' + ')],
    ['Required grade', `change ${gradeLabel(test.reqGradeChange)} · staining ${gradeLabel(test.reqGradeStain)}`],
  ]);

  // 3. thumbnails
  section(doc, 'Images');
  const thumbs = test.images.filter((i) => i.previewPath && exists(i.previewPath));
  let x = 40;
  let y = doc.y;
  const tw = 120;
  const th = 80;
  for (const img of thumbs) {
    if (x + tw > 40 + W) { x = 40; y += th + 22; }
    if (y + th + 22 > doc.page.height - 60) { doc.addPage(); x = 40; y = doc.y; }
    try { doc.image(absPath(img.previewPath!), x, y, { fit: [tw, th] }); } catch { /* unreadable preview */ }
    doc.fontSize(7).fillColor(GREY).text(`${img.role.replace('_', ' ').toLowerCase()}`, x, y + th + 2, { width: tw });
    x += tw + 10;
  }
  doc.x = 40;
  doc.y = y + th + 26;

  // 4. grades table
  section(doc, 'Grades');
  const cols = [40, 70, 250, 300, 350, 400, 460];
  const head = ['Code', 'Grade', 'App', 'Final', 'Req.', 'Pass', 'Decision / reviewer'];
  doc.fontSize(8).fillColor(GREY);
  head.forEach((h, i) => doc.text(h, cols[i] + (i === 1 ? 0 : 0), doc.y, { continued: false, lineBreak: false, width: 120 }));
  doc.moveDown(0.9);
  for (const g of sortGrades(test.grades)) {
    const eff = hidden ? null : effectiveGrade(g, test.datasetMode);
    const req = isChangeKind(g.kind as GradeKind) ? test.reqGradeChange : test.reqGradeStain;
    const pass = eff === null || req == null ? null : eff >= req;
    const reviewer = g.expertGrades.length ? g.expertGrades.map((e) => e.user?.name ?? e.userId).join(', ') : '';
    const rowY = doc.y;
    const cells = [
      GRADE_CODE[g.kind as GradeKind],
      `${GRADE_KIND_LABEL[g.kind as GradeKind]}${g.label ? ` (${g.label})` : ''}`,
      hidden ? '—' : `${gradeLabel(g.halfGrade)} (${g.finalRating.toFixed(2)})`,
      gradeLabel(eff),
      gradeLabel(req),
      pass === null ? '—' : pass ? 'PASS' : 'FAIL',
      `${g.decision === 'AUTO' ? 'Auto' : 'Review'}${reviewer ? ` · ${reviewer}` : ''}`,
    ];
    doc.fontSize(8).fillColor('#111');
    cells.forEach((c, i) => doc.text(c, cols[i], rowY, { width: (cols[i + 1] ?? 40 + W) - cols[i] - 4 }));
    doc.y = Math.max(doc.y, rowY + 12);
    doc.x = 40;
  }

  // 5. heat-maps
  const heatSources = test.grades.filter((g) => g.heatmapPath && exists(g.heatmapPath) && !g.kind.endsWith('_WORST'));
  const heat = [...new Map(heatSources.reverse().map((g) => [g.heatmapPath!, g])).values()].reverse();
  if (heat.length && !hidden) {
    section(doc, 'Heat-maps (per-pixel dE)');
    let hx = 40;
    let hy = doc.y;
    if (hy + 150 > doc.page.height - 60) { doc.addPage(); hy = doc.y; }
    for (const g of heat) {
      if (hx + 165 > 40 + W) { hx = 40; hy += 160; }
      try { doc.image(absPath(g.heatmapPath!), hx, hy, { fit: [160, 130] }); } catch { /* ignore */ }
      doc.fontSize(7).fillColor(GREY).text(isChangeKind(g.kind as GradeKind) ? 'Colour change' : `Staining ${g.kind === 'STAIN_ADJ1' ? 'adjacent 1' : 'adjacent 2'} (${g.label ?? ''})`, hx, hy + 132, { width: 160 });
      hx += 170;
    }
    doc.x = 40;
    doc.y = hy + 150;
  }

  // 6. measurements appendix
  doc.addPage();
  section(doc, 'Measurements');
  doc.fontSize(7.5).fillColor('#111');
  for (const g of sortGrades(test.grades)) {
    const f = asObject<Record<string, unknown>>(g.features);
    const n = (k: string) => (typeof f[k] === 'number' ? (f[k] as number).toFixed(2) : '—');
    doc.text(
      `${GRADE_CODE[g.kind as GradeKind]} ${g.label ?? ''}  dE*ab ${n('dE_ab')}  dE00 ${n('dE00')}  dL ${n('dL')}  dC ${n('dC')}  dH ${n('dH')}  p50 ${n('p50')}  p90 ${n('p90')}  CI [${g.ciLow.toFixed(2)}, ${g.ciHigh.toFixed(2)}] ${g.confidence}${f.dE_F_is_placeholder ? '  (provisional dE_F)' : ''}`,
      { width: W },
    );
  }

  // 7. traceability
  section(doc, 'Traceability');
  const er = asObject<Record<string, unknown>>(test.engineResult);
  const reviewers = [...new Set(test.grades.flatMap((g) => g.expertGrades.map((e) => e.user?.name ?? e.userId)))];
  kv(doc, [
    ['Engine version', (er.engine_version as string) ?? test.grades[0]?.engineVersion ?? '—'],
    ['Model version', (er.model_version as string) ?? test.grades[0]?.modelVersion ?? '—'],
    ['Tester', test.createdBy?.name ?? test.createdById],
    ['Reviewer(s)', reviewers.join(', ') || '—'],
    ['Created', test.createdAt.toISOString()],
    ['Graded', test.grades[0]?.createdAt.toISOString() ?? '—'],
    ['Completed', opts.completedAt?.toISOString() ?? '—'],
  ]);
  doc.fontSize(7).fillColor(GREY);
  for (const img of test.images) doc.text(`${img.role} ${img.side ?? ''}  sha256 ${img.sha256}  ${img.device ?? ''}`, { width: W });

  // 8. footer on every page
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0; // writing inside the margin must not create a new page
    doc.fontSize(7).fillColor(GREY).text(
      `Instrument-assisted grading. Provisional until the laboratory completes method validation.   ·   ${test.reportNo}   ·   page ${i + 1}/${range.count}`,
      40, doc.page.height - 30, { width: W, align: 'center', lineBreak: false },
    );
    doc.page.margins.bottom = bottom;
  }
  doc.end();
  await new Promise<void>((resolve, reject) => { out.on('finish', () => resolve()); out.on('error', reject); });
  if (opts.final) await mirror(rel);
  return rel;
}

function section(doc: PDFKit.PDFDocument, title: string) {
  if (doc.y > doc.page.height - 120) doc.addPage();
  doc.moveDown(0.5).fontSize(11).fillColor('#111').text(title, 40).moveDown(0.3);
}

function kv(doc: PDFKit.PDFDocument, rows: [string, string | null | undefined][]) {
  doc.fontSize(9);
  for (const [k, v] of rows) {
    const y = doc.y;
    doc.fillColor(GREY).text(k, 40, y, { width: 120 });
    doc.fillColor('#111').text(v || '—', 165, y, { width: 360 });
    doc.x = 40;
  }
}
