/** Expert-label consensus (Section 9.4 blind protocol).
 *
 *  Normal mode : the latest expert grade is the effective grade.
 *  Blind mode  : Expert A, then Expert B (cannot see A). If |A−B| ≤ limit (0.5)
 *                the consensus is the lower (more conservative) of the two —
 *                TODO VERIFY with the lab; otherwise Expert C decides.
 */

export interface ExpertMark {
  userId: string;
  halfGrade: number;
  blind: boolean;
  createdAt: string | Date;
}

export type BlindState = 'NEEDS_A' | 'NEEDS_B' | 'NEEDS_C' | 'LABELLED';

export function blindState(marks: ExpertMark[], limit = 0.5): BlindState {
  const m = sortMarks(marks.filter((x) => x.blind));
  if (m.length === 0) return 'NEEDS_A';
  if (m.length === 1) return 'NEEDS_B';
  if (Math.abs(m[0].halfGrade - m[1].halfGrade) <= limit + 1e-9) return 'LABELLED';
  return m.length >= 3 ? 'LABELLED' : 'NEEDS_C';
}

export function consensus(marks: ExpertMark[], blindMode: boolean, limit = 0.5): number | null {
  if (!marks.length) return null;
  if (!blindMode) return sortMarks(marks)[marks.length - 1].halfGrade;
  const m = sortMarks(marks.filter((x) => x.blind));
  const st = blindState(m, limit);
  if (st !== 'LABELLED') return null;
  if (m.length >= 3) return m[2].halfGrade; // Expert C decides
  return Math.min(m[0].halfGrade, m[1].halfGrade);
}

function sortMarks(m: ExpertMark[]): ExpertMark[] {
  return [...m].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}
