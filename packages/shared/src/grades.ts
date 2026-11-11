/** Grade tables (Section 8.1) and display helpers. Engine config.py is the
 * source of truth for grading maths; these mirror it for the UI. */

export const GRADES = [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0] as const;
export type HalfGrade = (typeof GRADES)[number];

export const GRADE_LABEL: Record<string, string> = {
  '5': '5', '4.5': '4-5', '4': '4', '3.5': '3-4', '3': '3', '2.5': '2-3', '2': '2', '1.5': '1-2', '1': '1',
};

/** Nominal CIELAB ΔE per grey-scale step — VERIFY (ISO 105-A02 / A03). */
export const CHANGE_SCALE_DE: Record<string, number> = {
  '5': 0.0, '4.5': 0.8, '4': 1.7, '3.5': 2.5, '3': 3.4, '2.5': 4.8, '2': 6.8, '1.5': 9.6, '1': 13.6,
};
export const STAIN_SCALE_DE: Record<string, number> = {
  '5': 0.0, '4.5': 2.2, '4': 4.3, '3.5': 6.0, '3': 8.5, '2.5': 12.0, '2': 16.9, '1.5': 24.0, '1': 34.1,
};

/** Half-up rounding to the nearest half grade, clamped to 1..5. */
export function toHalfGrade(rating: number): number {
  return Math.min(5, Math.max(1, Math.floor(rating * 2 + 0.5) / 2));
}

export function gradeLabel(g: number | null | undefined): string {
  if (g === null || g === undefined || Number.isNaN(g)) return '—';
  return GRADE_LABEL[String(toHalfGrade(g))] ?? String(g);
}

export type GradeTone = 'green' | 'lime' | 'amber' | 'orange' | 'red';

/** Chip colour per Section 9.1. */
export function gradeTone(g: number): GradeTone {
  const h = toHalfGrade(g);
  if (h >= 4.5) return 'green';
  if (h >= 3.5) return 'lime';
  if (h >= 2.5) return 'amber';
  if (h >= 1.5) return 'orange';
  return 'red';
}

/** Rounding boundaries x.25 / x.75 between half grades. */
export const HALF_GRADE_BOUNDARIES = [1.25, 1.75, 2.25, 2.75, 3.25, 3.75, 4.25, 4.75];

export const WARNING_LABEL: Record<string, string> = {
  blur: 'Blur',
  clipping: 'Clipped whites',
  glare: 'Glare',
  lowRes: 'Low resolution',
  noRefCard: 'No reference card',
  DIFFERENT_DEVICE_BEFORE_AFTER: 'Different device before/after',
  REGISTRATION_FAILED: 'Alignment failed',
  LOW_VALID_AREA: 'Small measurable area',
};

export const REVIEW_REASON_LABEL: Record<string, string> = {
  BOUNDARY: 'Interval crosses a half-grade boundary',
  WARNING: 'Image warning',
  NEAR_LIMIT: 'Near the required grade',
  REGISTRATION: 'Alignment failed',
  PROVISIONAL: 'Provisional formula (ΔE_F placeholder)',
  DATASET: 'Dataset mode — blind labelling',
  NEEDS_THIRD: 'Assessors disagree — needs third assessor',
  MODEL_UNCERTAIN: 'Model prediction close to a grade boundary',
};

/** Capture guideline C1–C10 (design doc Section 11). Default text; admins can edit it in Settings. */
export const CAPTURE_GUIDELINE: { code: string; rule: string; why: string }[] = [
  { code: 'C1', rule: 'Take before and after images with the same device', why: 'Different cameras render colour differently' },
  { code: 'C2', rule: 'Use the same lighting for before and after (ideally a D65 viewing booth)', why: 'A lighting change looks like a colour change' },
  { code: 'C3', rule: 'Turn auto-enhancement, HDR, beauty and filters OFF; scanner auto-levels OFF', why: 'Processing alters colour and clips whites' },
  { code: 'C4', rule: 'No clipped whites on the white adjacent fabric', why: 'Faint staining is lost when whites clip' },
  { code: 'C5', rule: 'Lay the fabric flat — no folds, no shadows', why: 'Folds change the measured colour' },
  { code: 'C6', rule: 'Use a neutral grey or black background', why: 'A white background confuses white fabric' },
  { code: 'C7', rule: 'Recommended: include a small colour reference card in every image', why: 'Lets the app correct small lighting and device differences' },
  { code: 'C8', rule: 'Recommended: image an unwashed piece of each adjacent fabric with the after-wash set', why: 'It is the staining baseline' },
  { code: 'C9', rule: 'At least 3 MP of fabric area; JPEG (max quality), PNG, TIFF or DNG', why: 'Enough pixels to average texture' },
  { code: 'C10', rule: 'One image per piece, or all pieces in one image with clear gaps', why: 'Both are supported' },
];
