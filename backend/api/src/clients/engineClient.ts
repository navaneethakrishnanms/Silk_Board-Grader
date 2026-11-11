/** HTTP client for the internal engine-svc (Section 7). All paths are storage-relative. */
import { env } from '../config/env.js';
import { badGateway } from '../utils/httpError.js';

export interface EngineInspectResult {
  width: number;
  height: number;
  device: string | null;
  bit_depth: number;
  sha256: string;
  warnings: Record<string, boolean>;
  metrics: Record<string, number>;
  preview_path: string | null;
}

export interface EngineRegion {
  piece_guess: 'SPECIMEN' | 'ADJ1' | 'ADJ2' | 'REF_CARD';
  polygon: [number, number][];
  confidence: number;
}

export interface EngineImageRef {
  path: string;
  polygon: [number, number][] | null;
}

export interface EngineGradeRequest {
  test_id: string;
  fabric_type: 'PLAIN' | 'PRINTED';
  adj_count: number;
  adj_fibres: string[];
  required: { change: number | null; stain: number | null };
  pairs: Record<string, { before: EngineImageRef; after: EngineImageRef }>;
  ref_card: { before: EngineImageRef | null; after: EngineImageRef | null } | null;
  options: {
    stain_statistic: 'p90' | 'median';
    change_rule: 'area_weighted' | 'worst';
    models?: Record<string, { path: string; version: string } | null>;
    manual_points?: { before: [number, number][]; after: [number, number][] } | null;
  };
}

export interface EngineGrade {
  kind: string;
  label: string | null;
  iso_rating: number;
  model_rating: number | null;
  final_rating: number;
  half_grade: number;
  ci: [number, number];
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  decision: 'AUTO' | 'REVIEW';
  pass: boolean | null;
  features: Record<string, unknown>;
  heatmap_path: string | null;
  model_version: string;
}

export interface EngineGradeResponse {
  engine_version: string;
  model_version: string;
  grades: EngineGrade[];
  warnings: string[];
  registration: { method: string; inliers: number; ok: boolean; message?: string };
  ref_card: { residual_dE00: number } | null;
  pieces: Record<string, { before: Record<string, unknown>; after: Record<string, unknown> }>;
  timings_ms: Record<string, number>;
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown, timeoutMs = env.ENGINE_TIMEOUT_MS): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${env.ENGINE_URL}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(env.ENGINE_INTERNAL_TOKEN ? { 'x-engine-token': env.ENGINE_INTERNAL_TOKEN } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) throw badGateway(`Engine ${path} failed (${res.status}): ${data?.detail ?? text}`, data);
    return data as T;
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw badGateway(`Engine ${path} timed out`);
    if ((err as { status?: number }).status) throw err;
    throw badGateway(`Engine unavailable at ${env.ENGINE_URL}: ${(err as Error).message}`);
  } finally {
    clearTimeout(t);
  }
}

export const engineClient = {
  health: () => call<Record<string, unknown>>('GET', '/health', undefined, 5000),
  inspect: (path: string, expectWhite = false) =>
    call<EngineInspectResult>('POST', '/inspect', { path, expect_white: expectWhite }),
  detectRegions: (path: string, expectedPieces: string[]) =>
    call<{ regions: EngineRegion[]; width: number; height: number }>('POST', '/detect-regions', {
      path,
      expected_pieces: expectedPieces,
    }),
  register: (before: EngineImageRef, after: EngineImageRef) =>
    call<{ ok: boolean; method: string; inliers: number; message?: string }>('POST', '/register', { before, after }),
  grade: (req: EngineGradeRequest) => call<EngineGradeResponse>('POST', '/grade', req),
};
