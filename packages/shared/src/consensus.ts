/** Expert-label consensus (design Section 15.7 / build brief Section 9.4).
 *
 *  Normal mode : the latest expert grade is the effective grade.
 *  Blind mode  : Expert A, then Expert B (who cannot see A). What happens when they differ
 *                is the lab's `consensusRule` (Settings):
 *    - third_assessor (default, per the design): ANY A ≠ B -> Expert C decides; the record is
 *      locked only when C has graded.
 *    - lower:            |A−B| ≤ limit -> the lower (more conservative) grade; otherwise C.
 *    - mean_round_down:  |A−B| ≤ limit -> mean rounded DOWN to a half grade; otherwise C.
 */

export type ConsensusRule = 'third_assessor' | 'lower' | 'mean_round_down';
export const CONSENSUS_RULES: ConsensusRule[] = ['third_assessor', 'lower', 'mean_round_down'];

export interface ConsensusPolicy {
  rule: ConsensusRule;
  /** max |A−B| accepted without a third assessor (ignored by third_assessor) */
  limit: number;
}

export const DEFAULT_CONSENSUS: ConsensusPolicy = { rule: 'third_assessor', limit: 0.5 };

export interface ExpertMark {
  userId: string;
  halfGrade: number;
  blind: boolean;
  createdAt: string | Date;
}

export type BlindState = 'NEEDS_A' | 'NEEDS_B' | 'NEEDS_C' | 'LABELLED';

export const BLIND_STATE_LABEL: Record<BlindState, string> = {
  NEEDS_A: 'Needs first assessor',
  NEEDS_B: 'Needs second assessor',
  NEEDS_C: 'Needs third assessor',
  LABELLED: 'Labelled',
};

function abAgree(a: number, b: number, p: ConsensusPolicy): boolean {
  if (p.rule === 'third_assessor') return a === b;
  return Math.abs(a - b) <= p.limit + 1e-9;
}

export function blindState(marks: ExpertMark[], policy: ConsensusPolicy = DEFAULT_CONSENSUS): BlindState {
  const m = sortMarks(marks.filter((x) => x.blind));
  if (m.length === 0) return 'NEEDS_A';
  if (m.length === 1) return 'NEEDS_B';
  if (abAgree(m[0].halfGrade, m[1].halfGrade, policy)) return 'LABELLED';
  return m.length >= 3 ? 'LABELLED' : 'NEEDS_C';
}

export function consensus(marks: ExpertMark[], blindMode: boolean, policy: ConsensusPolicy = DEFAULT_CONSENSUS): number | null {
  if (!marks.length) return null;
  if (!blindMode) return sortMarks(marks)[marks.length - 1].halfGrade;
  const m = sortMarks(marks.filter((x) => x.blind));
  if (blindState(m, policy) !== 'LABELLED') return null;
  const [a, b] = [m[0].halfGrade, m[1].halfGrade];
  if (a === b) return a;
  if (!abAgree(a, b, policy)) return m[2].halfGrade; // Expert C decides
  if (policy.rule === 'mean_round_down') return Math.floor(((a + b) / 2) * 2) / 2;
  return Math.min(a, b);
}

function sortMarks(m: ExpertMark[]): ExpertMark[] {
  return [...m].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

/** Quadratic weighted kappa between two raters on the 9-step half-grade scale. */
export function quadraticWeightedKappa(a: number[], b: number[]): number | null {
  const cats = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
  const k = cats.length;
  const n = Math.min(a.length, b.length);
  if (n === 0) return null;
  const O = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  for (let i = 0; i < n; i++) {
    const x = cats.indexOf(a[i]);
    const y = cats.indexOf(b[i]);
    if (x >= 0 && y >= 0) O[x][y]++;
  }
  const rows = O.map((r) => r.reduce((s, v) => s + v, 0));
  const cols = cats.map((_, j) => O.reduce((s, r) => s + r[j], 0));
  const tot = rows.reduce((s, v) => s + v, 0);
  let num = 0;
  let den = 0;
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      const w = (i - j) ** 2 / (k - 1) ** 2;
      num += w * O[i][j];
      den += w * ((rows[i] * cols[j]) / tot);
    }
  }
  return den === 0 ? 1 : 1 - num / den;
}
