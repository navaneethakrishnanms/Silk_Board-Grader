/** API response types (`/api/v1`). Shared by the web app and the future mobile app. */
import type {
  Confidence, Decision, FabricType, GradeKind, ImageRole, Piece, Role, Side, TestStatus, UploadMode,
} from './enums.js';

export interface UserDTO {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  createdAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: UserDTO;
}

export interface SampleDTO {
  id: string;
  batchId: string | null;
  customer: string | null;
  fibre: string;
  construction: string | null;
  fabricType: FabricType;
  baseShade: string | null;
  dominantHue: string | null;
  dyeClass: string | null;
  notes: string | null;
}

export interface ImageWarnings {
  blur?: boolean;
  clipping?: boolean;
  glare?: boolean;
  lowRes?: boolean;
  noRefCard?: boolean;
  [k: string]: boolean | undefined;
}

export interface RegionDTO {
  id: string;
  imageId: string;
  piece: Piece;
  polygon: [number, number][];
  autoDetected: boolean;
  editedBy: string | null;
  stats: Record<string, unknown> | null;
  confidence?: number;
}

export interface ImageDTO {
  id: string;
  role: ImageRole;
  side: Side | null;
  fileName: string | null;
  sizeBytes: number | null;
  sha256: string;
  width: number;
  height: number;
  device: string | null;
  warnings: ImageWarnings;
  uploadedBy: string;
  uploadedAt: string;
  previewUrl: string | null;
  originalUrl: string;
  regions: RegionDTO[];
}

export interface ExpertGradeDTO {
  id: string;
  userId: string;
  userName?: string;
  halfGrade: number;
  reason: string | null;
  blind: boolean;
  createdAt: string;
}

export interface GradeFeatures {
  dE_ab?: number;
  dE00?: number;
  dE_F?: number;
  dE_F_is_placeholder?: boolean;
  dL?: number;
  dC?: number;
  dH?: number;
  p10?: number;
  p50?: number;
  p90?: number;
  std?: number;
  area_share?: number;
  lab_before?: number[];
  lab_after?: number[];
  swatch_before?: number[];
  swatch_after?: number[];
  review_reasons?: string[];
  warnings?: string[];
  [k: string]: unknown;
}

export interface GradeDTO {
  id: string;
  kind: GradeKind;
  label: string | null;
  /** null while hidden in dataset (blind) mode */
  isoRating: number | null;
  modelRating: number | null;
  finalRating: number | null;
  halfGrade: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  confidence: Confidence | null;
  decision: Decision | null;
  pass: boolean | null;
  features: GradeFeatures | null;
  heatmapUrl: string | null;
  engineVersion: string;
  modelVersion: string;
  createdAt: string;
  expertGrades: ExpertGradeDTO[];
  /** effective grade = consensus expert grade if any, else engine half grade */
  effectiveGrade: number | null;
  effectivePass: boolean | null;
  reviewed: boolean;
  hidden: boolean;
}

export interface TestSummaryDTO {
  id: string;
  reportNo: string;
  sampleId: string;
  batchId: string | null;
  customer: string | null;
  fabricType: FabricType;
  washMethod: string;
  status: TestStatus;
  datasetMode: boolean;
  createdAt: string;
  completedAt: string | null;
  createdByName: string | null;
  overallPass: boolean | null;
  changeGrade: number | null;
  stainGrade: number | null;
  reviewKinds?: GradeKind[];
  reviewReasons?: string[];
  ageDays: number;
}

export interface TestDTO extends TestSummaryDTO {
  sample: SampleDTO;
  washTempC: number | null;
  washTimeMin: number | null;
  adjCount: number;
  adj1Fibre: string;
  adj2Fibre: string | null;
  reqGradeChange: number | null;
  reqGradeStain: number | null;
  captureDevice: string | null;
  uploadMode: UploadMode;
  gradingError: string | null;
  voidReason: string | null;
  manualPoints: { before: [number, number][]; after: [number, number][] } | null;
  engineResult: {
    warnings: string[];
    registration: { method: string; inliers: number; ok: boolean } | null;
    engineVersion: string | null;
    modelVersion: string | null;
  } | null;
  images: ImageDTO[];
  grades: GradeDTO[];
  gradesHidden: boolean;
  labelled: boolean;
  reportUrl: string | null;
  canComplete: boolean;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DashboardDTO {
  pendingWash: number;
  needsReview: number;
  completedToday: number;
  testsToday: number;
  passRate30d: number | null;
  recent: TestSummaryDTO[];
  gradeDistribution: { grade: number; change: number; stain: number }[];
}

export interface PublicSettingsDTO {
  labName: string;
  washMethods: string[];
  requiredPresets: { name: string; customer?: string | null; change: number | null; stain: number | null }[];
  captureGuideline: string;
  stainStatistic: 'p90' | 'median';
  changeRule: 'area_weighted' | 'worst';
  dE_F_verified: boolean;
}

export interface SettingsDTO extends PublicSettingsDTO {
  autoCompleteAuto: boolean;
  blindDisagreementLimit: number;
}

export interface ModelVersionDTO {
  id: string;
  name: string;
  version: string;
  sha256: string;
  metrics: Record<string, unknown>;
  active: boolean;
  createdAt: string;
}

export interface EngineHealthDTO {
  ok: boolean;
  engine_version?: string;
  model_versions?: Record<string, string>;
  dE_F_verified?: boolean;
  error?: string;
}

export interface DatasetStatsDTO {
  counts: { kind: GradeKind; grade: number; n: number }[];
  minPerGrade: number;
  blind: { total: number; labelled: number; awaitingSecond: number; awaitingThird: number };
  agreement: { kind: GradeKind; n: number; exact: number; withinHalf: number }[];
}

export interface AlignmentCheckDTO {
  ok: boolean;
  method: string;
  inliers: number;
  message?: string;
}

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}
