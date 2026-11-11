/** Typed API client for `/api/v1` with transparent access-token refresh. */
import type {
  AlignmentCheckDTO, AuthTokens, DashboardDTO, DatasetStatsDTO, EngineHealthDTO, ModelVersionDTO, Paged,
  PublicSettingsDTO, SettingsDTO, TestDTO, TestSummaryDTO, UserDTO,
} from '@silkgrade/shared';
import { useAuth } from './auth';

export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';
export const API = `${API_BASE}/api/v1`;

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

/** Signed file URLs from the API are root-relative ("/api/v1/files/..."). */
export const fileSrc = (u: string | null | undefined) => (u ? `${API_BASE}${u}` : undefined);

let refreshing: Promise<boolean> | null = null;

async function refresh(): Promise<boolean> {
  const rt = useAuth.getState().refreshToken;
  if (!rt) return false;
  refreshing ??= fetch(`${API}/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken: rt }),
  })
    .then(async (r) => {
      if (!r.ok) return false;
      useAuth.getState().setSession((await r.json()) as AuthTokens);
      return true;
    })
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export async function request<T>(path: string, init: RequestInit & { json?: unknown; raw?: boolean } = {}, retry = true): Promise<T> {
  const headers = new Headers(init.headers);
  const token = useAuth.getState().accessToken;
  if (token) headers.set('authorization', `Bearer ${token}`);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(init.json);
  }
  const res = await fetch(`${API}${path}`, { ...init, headers, body });
  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    if (await refresh()) return request<T>(path, init, false);
    useAuth.getState().logout();
  }
  if (!res.ok) {
    let data: { error?: { code?: string; message?: string; details?: unknown } } = {};
    try {
      data = await res.json();
    } catch {
      /* not json */
    }
    throw new ApiError(res.status, data.error?.code ?? 'HTTP_ERROR', data.error?.message ?? res.statusText, data.error?.details);
  }
  if (init.raw) return res as unknown as T;
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Download a file through the authenticated API (CSV / zip / PDF). */
export async function download(path: string, fallbackName: string) {
  const res = await request<Response>(path, { raw: true });
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const qs = (o: Record<string, unknown>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const api = {
  login: (email: string, password: string) => request<AuthTokens>('/auth/login', { method: 'POST', json: { email, password } }),
  me: () => request<UserDTO>('/me'),
  dashboard: () => request<DashboardDTO>('/dashboard'),
  publicSettings: () => request<PublicSettingsDTO>('/settings/public'),
  settings: () => request<SettingsDTO>('/settings'),
  saveSettings: (s: Partial<SettingsDTO>) => request<SettingsDTO>('/settings', { method: 'PUT', json: s }),

  tests: (q: Record<string, unknown>) => request<Paged<TestSummaryDTO>>(`/tests${qs(q)}`),
  test: (id: string) => request<TestDTO>(`/tests/${id}`),
  createTest: (body: unknown) => request<TestDTO>('/tests', { method: 'POST', json: body }),
  updateTest: (id: string, body: unknown) => request<TestDTO>(`/tests/${id}`, { method: 'PATCH', json: body }),
  uploadImage: (id: string, role: string, file: File, side?: 'before' | 'after') => {
    const fd = new FormData();
    fd.set('role', role);
    if (side) fd.set('side', side);
    fd.set('file', file);
    return request<TestDTO>(`/tests/${id}/images`, { method: 'POST', body: fd });
  },
  deleteImage: (id: string, imageId: string) => request<TestDTO>(`/tests/${id}/images/${imageId}`, { method: 'DELETE' }),
  detectRegions: (id: string, side: 'before' | 'after') => request<TestDTO>(`/tests/${id}/regions/detect`, { method: 'POST', json: { side } }),
  saveRegions: (id: string, regions: unknown[]) => request<TestDTO>(`/tests/${id}/regions`, { method: 'PUT', json: { regions } }),
  markBeforeDone: (id: string) => request<TestDTO>(`/tests/${id}/mark-before-done`, { method: 'POST' }),
  markAfterDone: (id: string) => request<TestDTO>(`/tests/${id}/mark-after-done`, { method: 'POST' }),
  checkAlignment: (id: string) => request<AlignmentCheckDTO>(`/tests/${id}/alignment/check`, { method: 'POST' }),
  setAlignment: (id: string, body: unknown) => request<TestDTO>(`/tests/${id}/alignment`, { method: 'PUT', json: body }),
  grade: (id: string) => request<TestDTO>(`/tests/${id}/grade`, { method: 'POST' }),
  sendToReview: (id: string) => request<TestDTO>(`/tests/${id}/send-to-review`, { method: 'POST' }),
  complete: (id: string) => request<TestDTO>(`/tests/${id}/complete`, { method: 'POST' }),
  voidTest: (id: string, reason: string) => request<TestDTO>(`/tests/${id}/void`, { method: 'POST', json: { reason } }),
  expertGrade: (gradeId: string, halfGrade: number, reason?: string) =>
    request<TestDTO>(`/grades/${gradeId}/expert`, { method: 'POST', json: { halfGrade, reason } }),
  review: (q: Record<string, unknown> = {}) => request<TestSummaryDTO[]>(`/review${qs(q)}`),

  datasetStats: () => request<DatasetStatsDTO>('/dataset/stats'),
  users: () => request<UserDTO[]>('/users'),
  createUser: (b: unknown) => request<UserDTO>('/users', { method: 'POST', json: b }),
  updateUser: (id: string, b: unknown) => request<UserDTO>(`/users/${id}`, { method: 'PATCH', json: b }),
  models: () => request<ModelVersionDTO[]>('/models'),
  uploadModel: (file: File) => {
    const fd = new FormData();
    fd.set('file', file);
    return request<ModelVersionDTO>('/models', { method: 'POST', body: fd });
  },
  activateModel: (id: string, on: boolean) => request<ModelVersionDTO[]>(`/models/${id}/${on ? 'activate' : 'deactivate'}`, { method: 'POST' }),
  engineHealth: () => request<EngineHealthDTO>('/engine/health'),
  csvPath: (q: Record<string, unknown>) => `/export/tests.csv${qs(q)}`,
};
