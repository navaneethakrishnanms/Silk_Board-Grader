/** Enums mirrored from the Prisma schema (Section 5). */

export const Role = { TESTER: 'TESTER', EXPERT: 'EXPERT', ADMIN: 'ADMIN' } as const;
export type Role = (typeof Role)[keyof typeof Role];
export const ROLES = Object.values(Role);

export const TestStatus = {
  DRAFT: 'DRAFT',
  PENDING_WASH: 'PENDING_WASH',
  READY_TO_GRADE: 'READY_TO_GRADE',
  GRADING: 'GRADING',
  GRADED_AUTO: 'GRADED_AUTO',
  NEEDS_REVIEW: 'NEEDS_REVIEW',
  COMPLETED: 'COMPLETED',
  VOID: 'VOID',
} as const;
export type TestStatus = (typeof TestStatus)[keyof typeof TestStatus];
export const TEST_STATUSES = Object.values(TestStatus);

export const ImageRole = {
  SPECIMEN_BEFORE: 'SPECIMEN_BEFORE',
  SPECIMEN_AFTER: 'SPECIMEN_AFTER',
  ADJ1_BEFORE: 'ADJ1_BEFORE',
  ADJ1_AFTER: 'ADJ1_AFTER',
  ADJ2_BEFORE: 'ADJ2_BEFORE',
  ADJ2_AFTER: 'ADJ2_AFTER',
  COMPOSITE_BEFORE: 'COMPOSITE_BEFORE',
  COMPOSITE_AFTER: 'COMPOSITE_AFTER',
  REF_CARD: 'REF_CARD',
} as const;
export type ImageRole = (typeof ImageRole)[keyof typeof ImageRole];
export const IMAGE_ROLES = Object.values(ImageRole);

export const Piece = { SPECIMEN: 'SPECIMEN', ADJ1: 'ADJ1', ADJ2: 'ADJ2', REF_CARD: 'REF_CARD' } as const;
export type Piece = (typeof Piece)[keyof typeof Piece];
export const PIECES = Object.values(Piece);

export const GradeKind = {
  CHANGE_OVERALL: 'CHANGE_OVERALL',
  CHANGE_GROUND: 'CHANGE_GROUND',
  CHANGE_MOTIF: 'CHANGE_MOTIF',
  CHANGE_WORST: 'CHANGE_WORST',
  STAIN_ADJ1: 'STAIN_ADJ1',
  STAIN_ADJ2: 'STAIN_ADJ2',
  STAIN_WORST: 'STAIN_WORST',
} as const;
export type GradeKind = (typeof GradeKind)[keyof typeof GradeKind];
export const GRADE_KINDS = Object.values(GradeKind);

export const Decision = { AUTO: 'AUTO', REVIEW: 'REVIEW' } as const;
export type Decision = (typeof Decision)[keyof typeof Decision];

export const FabricType = { PLAIN: 'PLAIN', PRINTED: 'PRINTED' } as const;
export type FabricType = (typeof FabricType)[keyof typeof FabricType];

export const Confidence = { HIGH: 'HIGH', MEDIUM: 'MEDIUM', LOW: 'LOW' } as const;
export type Confidence = (typeof Confidence)[keyof typeof Confidence];

export type Side = 'before' | 'after';
export type UploadMode = 'separate' | 'single';

export const ROLE_RANK: Record<Role, number> = { TESTER: 1, EXPERT: 2, ADMIN: 3 };
export const hasRole = (role: Role | undefined | null, min: Role): boolean =>
  !!role && ROLE_RANK[role] >= ROLE_RANK[min];

/** Grade code (Section 1.2) for each kind. */
export const GRADE_CODE: Record<GradeKind, string> = {
  CHANGE_OVERALL: 'G1',
  CHANGE_GROUND: 'G2',
  CHANGE_MOTIF: 'G3',
  CHANGE_WORST: 'G4',
  STAIN_ADJ1: 'G5',
  STAIN_ADJ2: 'G6',
  STAIN_WORST: 'G7',
};

export const GRADE_KIND_LABEL: Record<GradeKind, string> = {
  CHANGE_OVERALL: 'Colour change — overall',
  CHANGE_GROUND: 'Colour change — ground',
  CHANGE_MOTIF: 'Colour change — print colour',
  CHANGE_WORST: 'Colour change — worst colour',
  STAIN_ADJ1: 'Staining — adjacent 1',
  STAIN_ADJ2: 'Staining — adjacent 2',
  STAIN_WORST: 'Staining — worst',
};

export const isChangeKind = (k: GradeKind) => k.startsWith('CHANGE_');
export const isStainKind = (k: GradeKind) => k.startsWith('STAIN_');

export const STATUS_LABEL: Record<TestStatus, string> = {
  DRAFT: 'Draft',
  PENDING_WASH: 'Pending wash',
  READY_TO_GRADE: 'Ready to grade',
  GRADING: 'Grading',
  GRADED_AUTO: 'Graded (auto)',
  NEEDS_REVIEW: 'Needs review',
  COMPLETED: 'Completed',
  VOID: 'Void',
};
