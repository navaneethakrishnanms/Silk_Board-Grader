import { TestStatus } from './enums.js';

/** Allowed status transitions (Section 6 status machine). */
export const STATUS_TRANSITIONS: Record<TestStatus, TestStatus[]> = {
  DRAFT: ['PENDING_WASH', 'VOID'],
  PENDING_WASH: ['READY_TO_GRADE', 'VOID'],
  READY_TO_GRADE: ['GRADING', 'VOID'],
  GRADING: ['GRADED_AUTO', 'NEEDS_REVIEW', 'READY_TO_GRADE', 'VOID'], // READY_TO_GRADE = failed job, retry
  GRADED_AUTO: ['COMPLETED', 'NEEDS_REVIEW', 'VOID'],
  NEEDS_REVIEW: ['COMPLETED', 'VOID'],
  COMPLETED: [],
  VOID: [],
};

export function canTransition(from: TestStatus, to: TestStatus): boolean {
  return STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Test details may only be edited before washing. */
export const EDITABLE_STATUSES: TestStatus[] = ['DRAFT', 'PENDING_WASH'];
/** Images may be uploaded/deleted only before grading. */
export const UPLOAD_STATUSES: TestStatus[] = ['DRAFT', 'PENDING_WASH', 'READY_TO_GRADE'];
