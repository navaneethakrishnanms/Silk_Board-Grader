import { describe, expect, it } from 'vitest';
import {
  blindState, canTransition, consensus, quadraticWeightedKappa, createTestSchema, expertGradeSchema, gradeLabel, gradeTone,
  hasRole, toHalfGrade,
} from './index.js';

describe('grades', () => {
  it('rounds half-up to half grades', () => {
    expect(toHalfGrade(4.25)).toBe(4.5);
    expect(toHalfGrade(4.24)).toBe(4);
    expect(toHalfGrade(0.3)).toBe(1);
    expect(gradeLabel(4.5)).toBe('4-5');
    expect(gradeLabel(null)).toBe('—');
  });
  it('maps grade chip colours', () => {
    expect(gradeTone(5)).toBe('green');
    expect(gradeTone(3.5)).toBe('lime');
    expect(gradeTone(2.5)).toBe('amber');
    expect(gradeTone(1.5)).toBe('orange');
    expect(gradeTone(1)).toBe('red');
  });
});

describe('status machine', () => {
  it('allows only the documented transitions', () => {
    expect(canTransition('DRAFT', 'PENDING_WASH')).toBe(true);
    expect(canTransition('DRAFT', 'READY_TO_GRADE')).toBe(false);
    expect(canTransition('COMPLETED', 'VOID')).toBe(false);
    expect(canTransition('NEEDS_REVIEW', 'COMPLETED')).toBe(true);
  });
});

describe('roles', () => {
  it('ranks roles', () => {
    expect(hasRole('ADMIN', 'EXPERT')).toBe(true);
    expect(hasRole('TESTER', 'EXPERT')).toBe(false);
  });
});

describe('schemas', () => {
  it('validates half grades', () => {
    expect(expertGradeSchema.safeParse({ halfGrade: 3.5 }).success).toBe(true);
    expect(expertGradeSchema.safeParse({ halfGrade: 3.7 }).success).toBe(false);
  });
  it('applies defaults to a new test', () => {
    const t = createTestSchema.parse({ sample: { id: 'BSB-2026-1', fabricType: 'PLAIN' }, washMethod: 'ISO 105-C10 A' });
    expect(t.adjCount).toBe(2);
    expect(t.uploadMode).toBe('separate');
  });
});

describe('blind consensus', () => {
  const m = (u: string, g: number, t: number) => ({ userId: u, halfGrade: g, blind: true, createdAt: new Date(t) });
  it('default rule: a third assessor decides ANY disagreement', () => {
    expect(blindState([])).toBe('NEEDS_A');
    expect(blindState([m('a', 4, 1)])).toBe('NEEDS_B');
    expect(blindState([m('a', 4, 1), m('b', 4, 2)])).toBe('LABELLED');
    expect(consensus([m('a', 4, 1), m('b', 4, 2)], true)).toBe(4);
    expect(blindState([m('a', 4, 1), m('b', 4.5, 2)])).toBe('NEEDS_C');
    expect(consensus([m('a', 4, 1), m('b', 4.5, 2)], true)).toBeNull();
    expect(consensus([m('a', 4, 1), m('b', 4.5, 2), m('c', 4.5, 3)], true)).toBe(4.5);
    expect(consensus([m('a', 4, 1), m('b', 3, 2), m('c', 3.5, 3)], true)).toBe(3.5);
  });
  it('lower and mean_round_down rules accept small differences', () => {
    const lower = { rule: 'lower' as const, limit: 0.5 };
    const mean = { rule: 'mean_round_down' as const, limit: 0.5 };
    expect(consensus([m('a', 4, 1), m('b', 4.5, 2)], true, lower)).toBe(4);
    expect(consensus([m('a', 4, 1), m('b', 4.5, 2)], true, mean)).toBe(4);
    expect(consensus([m('a', 3, 1), m('b', 4, 2)], true, { rule: 'mean_round_down', limit: 1 })).toBe(3.5);
    expect(blindState([m('a', 4, 1), m('b', 3, 2)], lower)).toBe('NEEDS_C');
  });
  it('computes quadratic weighted kappa', () => {
    expect(quadraticWeightedKappa([4, 4.5, 3, 2], [4, 4.5, 3, 2])).toBeCloseTo(1);
    expect(quadraticWeightedKappa([5, 5, 1, 1], [1, 1, 5, 5])!).toBeLessThan(0);
    expect(quadraticWeightedKappa([], [])).toBeNull();
  });
});
