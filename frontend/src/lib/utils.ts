import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { create } from 'zustand';

export const cn = (...v: ClassValue[]) => twMerge(clsx(v));

export const fmt = (n: number | null | undefined, d = 2) => (n === null || n === undefined || Number.isNaN(n) ? '—' : n.toFixed(d));
export const fmtDate = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
export const fmtDateTime = (s: string | null | undefined) => (s ? new Date(s).toLocaleString() : '—');
export const fmtBytes = (b: number | null | undefined) =>
  b == null ? '—' : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} kB`;

/** CIELAB -> sRGB hex for colour swatches. */
export function labToHex(lab: number[] | undefined | null): string {
  if (!lab || lab.length < 3) return '#808080';
  const [L, a, b] = lab;
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const inv = (t: number) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));
  const X = inv(fx) * 0.95047;
  const Y = inv(fy);
  const Z = inv(fz) * 1.08883;
  const lin = [3.2406 * X - 1.5372 * Y - 0.4986 * Z, -0.9689 * X + 1.8758 * Y + 0.0415 * Z, 0.0557 * X - 0.204 * Y + 1.057 * Z];
  const g = (c: number) => Math.round(255 * Math.min(1, Math.max(0, c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)));
  return `#${lin.map((c) => g(c).toString(16).padStart(2, '0')).join('')}`;
}

// ---- theme ------------------------------------------------------------------
type Theme = 'light' | 'dark';
const THEME_KEY = 'silkgrade.theme';
function initialTheme(): Theme {
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t === 'light' || t === 'dark') return t;
  } catch {
    /* ignore */
  }
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
export const useTheme = create<{ theme: Theme; toggle: () => void }>((set, get) => ({
  theme: initialTheme(),
  toggle: () => {
    const theme = get().theme === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
    set({ theme });
  },
}));

// ---- toasts -----------------------------------------------------------------
export interface Toast { id: number; kind: 'ok' | 'error' | 'info'; text: string }
export const useToasts = create<{ toasts: Toast[]; push: (kind: Toast['kind'], text: string) => void; dismiss: (id: number) => void }>((set) => ({
  toasts: [],
  push: (kind, text) => {
    const id = Date.now() + Math.random();
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 5000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
export const toast = {
  ok: (t: string) => useToasts.getState().push('ok', t),
  error: (t: unknown) => useToasts.getState().push('error', t instanceof Error ? t.message : String(t)),
  info: (t: string) => useToasts.getState().push('info', t),
};
