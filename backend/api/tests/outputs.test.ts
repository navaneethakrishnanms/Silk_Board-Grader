/** WP3: real PDF, CSV and dataset zip generated from the in-memory database. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import AdmZip from 'adm-zip';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { beforeAll, describe, expect, it, vi } from 'vitest';

/** Extract text (pages joined by newlines) with pdf.js. */
async function pdfParse(buf: Buffer): Promise<{ text: string; numpages: number }> {
  const doc = await getDocument({ data: new Uint8Array(buf), useSystemFonts: false, isEvalSupported: false }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const c = await (await doc.getPage(i)).getTextContent();
    let line = '';
    let lastY: number | null = null;
    const out: string[] = [];
    for (const it of c.items as { str: string; transform: number[]; hasEOL?: boolean }[]) {
      const y = it.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 2) { out.push(line); line = ''; }
      line += (line && !line.endsWith(' ') && it.str && !it.str.startsWith(' ') ? ' ' : '') + it.str;
      lastY = y;
    }
    out.push(line);
    pages.push(out.join(String.fromCharCode(10)));
  }
  return { text: pages.join(String.fromCharCode(10)), numpages: doc.numPages };
}

const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-out-'));
vi.stubEnv('DATA_MODE', 'memory');
vi.stubEnv('STORAGE_ROOT', storage);

const { prisma } = await import('../src/lib/prisma.js');
const { loadTest } = await import('../src/services/testService.js');
const { generateReport, pdfSafe } = await import('../src/services/reportService.js');
const { testsCsv, writeDatasetZip } = await import('../src/services/exportService.js');
const { buildCompletedTest } = await import('./memoryFixture.js');

let ids: Awaited<ReturnType<typeof buildCompletedTest>>;
beforeAll(async () => {
  ids = await buildCompletedTest(prisma, storage);
});

describe('PDF report (Section 13)', () => {
  it('contains every required item', async () => {
    const test = await loadTest(ids.test.id);
    const rel = await generateReport(test, { completedAt: new Date('2026-11-01T10:00:00Z'), final: true });
    const buf = fs.readFileSync(path.join(storage, rel));
    const { text, numpages } = await pdfParse(buf);
    // 1 header
    expect(text).toContain('Bangalore Silk Board');
    expect(text).toContain('SG-2026-000123');
    expect(text).toContain('2026-11-01');
    expect(text).toMatch(/SilkGrade v\d+\.\d+\.\d+/);
    // 2 sample and test details
    for (const s of ['BSB-2026-00123', 'silk', 'satin', 'PLAIN', 'ISO 105-C10 A', '40 deg', '30 min', 'silk + cotton']) expect(text).toContain(s);
    // 3 thumbnails (captions) + images embedded
    for (const s of ['specimen before', 'specimen after', 'adj1 before', 'adj2 after']) expect(text.toLowerCase()).toContain(s);
    const imageObjects = (buf.toString('latin1').match(/\/Subtype \/Image/g) ?? []).length;
    expect(imageObjects).toBeGreaterThanOrEqual(6 + 3);
    // 4 grades table G1, G5-G7 with required, pass/fail, decision, reviewer
    for (const s of ['G1', 'G5', 'G6', 'G7', 'PASS', 'FAIL', 'Review', 'Alice Expert']) expect(text).toContain(s);
    // 5 heat-maps
    expect(text).toContain('Heat-maps');
    expect(text).toContain('Staining adjacent 1 (silk)');
    // 6 measurements
    expect(text).toContain('Measurements');
    expect(text).toMatch(/dE\*ab 3\.40\s+dE00 3\.37/);
    // 7 traceability: versions, hashes, users, timestamps
    expect(text).toContain('Engine version');
    expect(text).toContain('formula-only');
    expect(text).toContain('specimenbefore'.padEnd(64, '0'));
    expect(text).toContain('Tess Tester');
    expect(text).toContain('Bob Expert');
    for (const s of ['Created', 'Graded', 'Completed 2026-11-01T10:00:00.000Z']) expect(text).toContain(s);
    // 8 footer on every page, with correct page numbering
    expect(text.match(/Instrument-assisted grading\. Provisional until the laboratory completes method validation\./g)?.length).toBe(numpages);
    expect(text).toContain(`page ${numpages}/${numpages}`);
    expect(text).not.toContain('�');
  });

  it('maps unsupported glyphs to safe text', () => {
    expect(pdfSafe('ΔE — 40 °C · ok')).toBe('dE - 40 deg C | ok');
  });
});

describe('CSV export', () => {
  it('has one row per grade with effective grade and pass/fail', async () => {
    const csv = await testsCsv({ page: 1, pageSize: 25 }, { id: ids.a.id, role: 'EXPERT' });
    const lines = csv.trim().split('\r\n');
    expect(lines[0].split(',')).toEqual(expect.arrayContaining(['report_no', 'kind', 'app_grade', 'effective_grade', 'required', 'pass', 'engine_version', 'model_version']));
    expect(lines).toHaveLength(1 + 4);
    expect(lines.find((l) => l.includes('CHANGE_OVERALL'))).toContain('FAIL');
  });
});

describe('dataset zip (Section 10.2)', () => {
  async function zipEntries() {
    const out = new PassThrough();
    const chunks: Buffer[] = [];
    out.on('data', (c) => chunks.push(c));
    const done = new Promise((r) => out.on('end', r));
    const n = await writeDatasetZip(out);
    await done;
    return { n, zip: new AdmZip(Buffer.concat(chunks)) };
  }

  it('matches the documented layout exactly', async () => {
    const { n, zip } = await zipEntries();
    expect(n).toBe(1);
    const rec = `dataset/records/BSB-2026-00123__${ids.test.id}/`;
    const names = zip.getEntries().map((e) => e.entryName).sort();
    expect(names).toEqual([
      'dataset/metadata.csv',
      `${rec}adj1_after.jpg`, `${rec}adj1_before.jpg`, `${rec}adj2_after.jpg`, `${rec}adj2_before.jpg`,
      `${rec}features.json`, `${rec}labels.json`, `${rec}regions.json`,
      `${rec}specimen_after.jpg`, `${rec}specimen_before.jpg`,
      'dataset/splits.csv',
    ].sort());
    const labels = JSON.parse(zip.readAsText(`${rec}labels.json`));
    expect(labels.grades.CHANGE_OVERALL).toMatchObject({ assessor_A: 3, assessor_B: 3, consensus: 3 });
    const regions = JSON.parse(zip.readAsText(`${rec}regions.json`));
    expect(regions.images).toHaveLength(6);
  });

  it('metadata.csv has every listed column', async () => {
    const { zip } = await zipEntries();
    const header = zip.readAsText('dataset/metadata.csv').split('\r\n')[0].split(',');
    const required = ['test_id', 'sample_id', 'batch_id', 'fabric_type', 'construction', 'base_shade', 'dominant_hue', 'dye_class',
      'wash_method', 'adj1_fibre', 'adj2_fibre', 'device_before', 'device_after', 'ref_card', 'grade_change_overall',
      'grade_change_ground', 'grade_change_worst', 'grade_stain_adj1', 'grade_stain_adj2', 'engine_version'];
    expect(header).toEqual(expect.arrayContaining(required));
    for (const a of ['A', 'B', 'C']) expect(header.some((h) => h.startsWith(`assessor${a}_`))).toBe(true);
  });
});
