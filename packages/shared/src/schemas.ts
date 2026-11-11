/** zod request schemas shared by the API (validation) and clients (forms). */
import { z } from 'zod';
import { GRADES } from './grades.js';
import { IMAGE_ROLES, PIECES, ROLES } from './enums.js';

const halfGrade = z
  .number()
  .refine((v) => (GRADES as readonly number[]).includes(v), { message: 'Grade must be 1–5 in half steps' });

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({ refreshToken: z.string().min(10) });

export const sampleSchema = z.object({
  id: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._\-/]+$/, 'Letters, digits, . _ - / only'),
  batchId: z.string().trim().max(64).optional().nullable(),
  customer: z.string().trim().max(120).optional().nullable(),
  fibre: z.string().trim().max(40).default('silk'),
  construction: z.string().trim().max(60).optional().nullable(),
  fabricType: z.enum(['PLAIN', 'PRINTED']),
  baseShade: z.enum(['light', 'medium', 'dark']).optional().nullable(),
  dominantHue: z.string().trim().max(40).optional().nullable(),
  dyeClass: z.string().trim().max(60).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});
export type SampleInput = z.infer<typeof sampleSchema>;

export const createTestSchema = z.object({
  sample: sampleSchema,
  washMethod: z.string().trim().min(1).max(80),
  washTempC: z.number().min(0).max(100).optional().nullable(),
  washTimeMin: z.number().min(0).max(1000).optional().nullable(),
  adjCount: z.union([z.literal(1), z.literal(2)]).default(2),
  adj1Fibre: z.string().trim().min(1).max(40).default('silk'),
  adj2Fibre: z.string().trim().max(40).optional().nullable(),
  reqGradeChange: halfGrade.optional().nullable(),
  reqGradeStain: halfGrade.optional().nullable(),
  datasetMode: z.boolean().default(false),
  captureDevice: z.string().trim().max(120).optional().nullable(),
  uploadMode: z.enum(['separate', 'single']).default('separate'),
});
export type CreateTestInput = z.infer<typeof createTestSchema>;

export const updateTestSchema = createTestSchema.omit({ sample: true }).partial().extend({
  sample: sampleSchema.partial().omit({ id: true }).optional(),
});
export type UpdateTestInput = z.infer<typeof updateTestSchema>;

export const uploadImageSchema = z.object({ role: z.enum(IMAGE_ROLES as [string, ...string[]]) });

const point = z.tuple([z.number(), z.number()]);
export const polygonSchema = z.array(point).min(3).max(64);

export const regionInputSchema = z.object({
  imageId: z.string().uuid(),
  piece: z.enum(PIECES as [string, ...string[]]),
  polygon: polygonSchema,
  edited: z.boolean().default(true),
});
export const saveRegionsSchema = z.object({ regions: z.array(regionInputSchema).min(1).max(20) });
export type SaveRegionsInput = z.infer<typeof saveRegionsSchema>;

export const detectRegionsSchema = z.object({ side: z.enum(['before', 'after']) });

export const alignmentSchema = z.object({
  before: z.array(point).length(2),
  after: z.array(point).length(2),
});
export type AlignmentInput = z.infer<typeof alignmentSchema>;

export const expertGradeSchema = z.object({
  halfGrade,
  reason: z.string().trim().max(1000).optional().nullable(),
});
export type ExpertGradeInput = z.infer<typeof expertGradeSchema>;

export const voidSchema = z.object({ reason: z.string().trim().min(3).max(500) });

export const userCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(8).max(200),
  role: z.enum(ROLES as [string, ...string[]]),
});
export const userUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  role: z.enum(ROLES as [string, ...string[]]).optional(),
  active: z.boolean().optional(),
  password: z.string().min(8).max(200).optional(),
});

export const requiredPresetSchema = z.object({
  name: z.string().trim().min(1).max(120),
  customer: z.string().trim().max(120).optional().nullable(),
  change: halfGrade.nullable(),
  stain: halfGrade.nullable(),
});
export type RequiredPreset = z.infer<typeof requiredPresetSchema>;

export const settingsSchema = z.object({
  labName: z.string().trim().max(160).optional(),
  washMethods: z.array(z.string().trim().min(1).max(80)).max(100).optional(),
  requiredPresets: z.array(requiredPresetSchema).max(200).optional(),
  captureGuideline: z.string().max(20000).optional(),
  stainStatistic: z.enum(['p90', 'median']).optional(),
  changeRule: z.enum(['area_weighted', 'worst']).optional(),
  autoCompleteAuto: z.boolean().optional(),
  blindDisagreementLimit: z.number().min(0).max(2).optional(),
});
export type SettingsInput = z.infer<typeof settingsSchema>;

export const testListQuerySchema = z.object({
  status: z.string().optional(),
  sampleId: z.string().optional(),
  batchId: z.string().optional(),
  customer: z.string().optional(),
  q: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  pass: z.enum(['pass', 'fail']).optional(),
  gradeMin: z.coerce.number().optional(),
  gradeMax: z.coerce.number().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});
export type TestListQuery = z.infer<typeof testListQuerySchema>;
