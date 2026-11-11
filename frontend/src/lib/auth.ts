import { create } from 'zustand';
import type { AuthTokens, UserDTO } from '@silkgrade/shared';

const KEY = 'silkgrade.auth';

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: UserDTO | null;
  setSession: (t: AuthTokens) => void;
  setUser: (u: UserDTO) => void;
  logout: () => void;
}

function load(): Pick<AuthState, 'accessToken' | 'refreshToken' | 'user'> {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* storage unavailable */
  }
  return { accessToken: null, refreshToken: null, user: null };
}

function save(s: Pick<AuthState, 'accessToken' | 'refreshToken' | 'user'>) {
  try {
    if (s.accessToken) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export const useAuth = create<AuthState>((set, get) => ({
  ...load(),
  setSession: (t) => {
    const next = { accessToken: t.accessToken, refreshToken: t.refreshToken, user: t.user };
    save(next);
    set(next);
  },
  setUser: (user) => {
    const next = { accessToken: get().accessToken, refreshToken: get().refreshToken, user };
    save(next);
    set({ user });
  },
  logout: () => {
    const rt = get().refreshToken;
    if (rt) {
      // best effort: revoke the refresh token on the server
      fetch(`${(import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '')}/api/v1/auth/logout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: rt }),
      }).catch(() => undefined);
    }
    save({ accessToken: null, refreshToken: null, user: null });
    set({ accessToken: null, refreshToken: null, user: null });
  },
}));
