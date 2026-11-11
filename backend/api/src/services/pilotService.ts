/** WP7 pilot-readiness tools: repeatability, device comparison, data coverage, shadow-mode report. */
import { GRADE_KINDS, type GradeKind } from '@silkgrade/shared';
import { prisma } from '../lib/prisma.js';
import { effectiveGrade, testInclude, type FullTest } from './presenter.js';
import { getConsensusPolicy } from './settingsService.js';

const KIND_ORDER = GRADE_KINDS;
export const COVERAGE_MIN_PER_GRADE = 40;
export const COVERAGE_TARGET = { min: 400, max: 600 };
export const DEVICE_WARN_DIFF = 0.5;

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sd = (xs: number[]) => (xs.length > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - mean(xs)) ** 2, 0) / (xs.length - 1)) : 0);
const r3 = (x: number) => Math.round(x * 1000) / 1000;

function gradedTests(tests: FullTest[]) {
  return tests.filter((t) => t.status !== 'VOID' && t.grades.length > 0);
}

/** Device of a test: EXIF device of the specimen before-wash image, else the declared capture device. */
export function testDevice(t: FullTest): string {
  const img = t.images.find((i) => i.role === 'SPECIMEN_BEFORE' || i.role === 'COMPOSITE_BEFORE');
  return img?.device || t.captureDevice || 'unknown';
}

export async function pilotSamples() {
  const tests = gradedTests(await prisma.test.findMany({ include: testInclude }));
  const by = new Map<string, { sampleId: string; tests: number; devices: Set<string> }>();
  for (const t of tests) {
    const e = by.get(t.sampleId) ?? { sampleId: t.sampleId, tests: 0, devices: new Set<string>() };
    e.tests++;
    e.devices.add(testDevice(t));
    by.set(t.sampleId, e);
  }
  return [...by.values()].filter((s) => s.tests >= 2).map((s) => ({ sampleId: s.sampleId, tests: s.tests, devices: [...s.devices] }));
}

/** Same composite graded N times -> spread of each grade kind. */
export async function repeatability(sampleId: string) {
  const tests = gradedTests(await prisma.test.findMany({ where: { sampleId }, include: testInclude, orderBy: { createdAt: 'asc' } }));
  const rows = KIND_ORDER.map((kind) => {
    const gs = tests.flatMap((t) => t.grades.filter((g) => g.kind === kind));
    if (!gs.length) return null;
    const ratings = gs.map((g) => g.finalRating);
    const halves = gs.map((g) => g.halfGrade);
    return {
      kind, n: gs.length,
      min: r3(Math.min(...ratings)), max: r3(Math.max(...ratings)), range: r3(Math.max(...ratings) - Math.min(...ratings)),
      mean: r3(mean(ratings)), sd: r3(sd(ratings)),
      halfGrades: halves, distinctHalfGrades: new Set(halves).size,
      stable: Math.max(...halves) - Math.min(...halves) <= 0.5,
    };
  }).filter(Boolean);
  return { sampleId, tests: tests.map((t) => ({ id: t.id, reportNo: t.reportNo, device: testDevice(t), createdAt: t.createdAt })), rows };
}

/** Same composite from two (or more) devices -> difference per grade kind; warn if > 0.5. */
export async function deviceComparison(sampleId: string) {
  const tests = gradedTests(await prisma.test.findMany({ where: { sampleId }, include: testInclude }));
  const devices = [...new Set(tests.map(testDevice))].sort();
  const rows = KIND_ORDER.map((kind) => {
    const perDevice: Record<string, number | null> = {};
    for (const d of devices) {
      const rs = tests.filter((t) => testDevice(t) === d).flatMap((t) => t.grades.filter((g) => g.kind === kind).map((g) => g.finalRating));
      perDevice[d] = rs.length ? r3(mean(rs)) : null;
    }
    const vals = Object.values(perDevice).filter((v): v is number => v !== null);
    if (vals.length < 1) return null;
    const diff = vals.length > 1 ? r3(Math.max(...vals) - Math.min(...vals)) : null;
    return { kind, perDevice, maxDiff: diff, warn: diff !== null && diff > DEVICE_WARN_DIFF };
  }).filter(Boolean);
  return { sampleId, devices, rows, warnThreshold: DEVICE_WARN_DIFF };
}

/** Labelled records per grade per grade kind, with gaps and progress to the 400-600 target. */
export async function coverage() {
  const limit = await getConsensusPolicy();
  const tests = gradedTests(await prisma.test.findMany({ include: testInclude }));
  const counts = new Map<string, number>();
  let labelledTests = 0;
  for (const t of tests) {
    let any = false;
    for (const g of t.grades) {
      if (!g.expertGrades.length) continue;
      const e = effectiveGrade(g, t.datasetMode, limit);
      if (e === null) continue;
      any = true;
      counts.set(`${g.kind}|${e}`, (counts.get(`${g.kind}|${e}`) ?? 0) + 1);
    }
    if (any) labelledTests++;
  }
  const grades = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
  const table = KIND_ORDER.map((kind) => ({
    kind,
    counts: grades.map((grade) => ({ grade, n: counts.get(`${kind}|${grade}`) ?? 0, low: (counts.get(`${kind}|${grade}`) ?? 0) < COVERAGE_MIN_PER_GRADE })),
  }));
  return {
    minPerGrade: COVERAGE_MIN_PER_GRADE, target: COVERAGE_TARGET, labelledTests,
    progress: Math.min(1, labelledTests / COVERAGE_TARGET.min), table,
  };
}

function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const w = Math.ceil(((t.getTime() - y0.getTime()) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(w).padStart(2, '0')}`;
}

/** Live tests: app grade vs expert grade over time (weekly). */
export async function shadowReport() {
  const limit = await getConsensusPolicy();
  const tests = gradedTests(await prisma.test.findMany({ include: testInclude }));
  const weeks = new Map<string, { n: number; exact: number; within: number; diffs: number[] }>();
  const byKind = new Map<GradeKind, { n: number; exact: number; within: number }>();
  for (const t of tests) {
    for (const g of t.grades) {
      if (!g.expertGrades.length) continue;
      const e = effectiveGrade(g, t.datasetMode, limit);
      if (e === null) continue;
      const week = isoWeek(g.expertGrades[g.expertGrades.length - 1].createdAt);
      const w = weeks.get(week) ?? { n: 0, exact: 0, within: 0, diffs: [] };
      const k = byKind.get(g.kind as GradeKind) ?? { n: 0, exact: 0, within: 0 };
      for (const s of [w, k]) {
        s.n++;
        if (g.halfGrade === e) s.exact++;
        if (Math.abs(g.halfGrade - e) <= 0.5) s.within++;
      }
      w.diffs.push(g.halfGrade - e);
      weeks.set(week, w);
      byKind.set(g.kind as GradeKind, k);
    }
  }
  return {
    weekly: [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, s]) => ({
      week, n: s.n, exact: r3(s.exact / s.n), withinHalf: r3(s.within / s.n), meanDiff: r3(mean(s.diffs)),
    })),
    byKind: [...byKind.entries()].map(([kind, s]) => ({ kind, n: s.n, exact: r3(s.exact / s.n), withinHalf: r3(s.within / s.n) })),
  };
}
