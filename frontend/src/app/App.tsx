import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { hasRole, type Role } from '@silkgrade/shared';
import { Toaster } from '@/components/ui';
import { DemoBanner } from '@/components/ui/DemoBanner';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/utils';
import { LoginPage } from '@/pages/LoginPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { Layout } from './Layout';

// Route-level code splitting: each screen (and its heavy libraries: Konva, charts, scanner) loads on demand.
const named = <K extends string>(load: () => Promise<Record<K, React.ComponentType>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })));
const DashboardPage = named(() => import('@/pages/DashboardPage'), 'DashboardPage');
const PendingWashPage = named(() => import('@/pages/PendingWashPage'), 'PendingWashPage');
const ReportPreviewPage = named(() => import('@/pages/ReportPreviewPage'), 'ReportPreviewPage');
const NewTestPage = named(() => import('@/features/tests/NewTestPage'), 'NewTestPage');
const TestWorkspace = named(() => import('@/features/tests/TestWorkspace'), 'TestWorkspace');
const ReviewQueuePage = named(() => import('@/features/review/ReviewQueuePage'), 'ReviewQueuePage');
const HistoryPage = named(() => import('@/features/history/HistoryPage'), 'HistoryPage');
const DatasetPage = named(() => import('@/features/dataset/DatasetPage'), 'DatasetPage');
const SettingsPage = named(() => import('@/features/settings/SettingsPage'), 'SettingsPage');
const PilotPage = named(() => import('@/features/pilot/PilotPage'), 'PilotPage');

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: (n, err) => !(err instanceof ApiError && err.status < 500) && n < 2,
      refetchOnWindowFocus: false,
    },
  },
});

function RequireAuth({ children, min }: { children: ReactNode; min?: Role }) {
  const { accessToken, user } = useAuth();
  const loc = useLocation();
  if (!accessToken) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (min && !hasRole(user?.role, min)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function ThemeSync() {
  const theme = useTheme((s) => s.theme);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);
  return null;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeSync />
      <DemoBanner />
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<RequireAuth><Layout /></RequireAuth>}>
            <Route index element={<DashboardPage />} />
            <Route path="tests/new" element={<RequireAuth min="TESTER"><NewTestPage /></RequireAuth>} />
            <Route path="tests/:id/report" element={<ReportPreviewPage />} />
            <Route path="tests/:id/*" element={<TestWorkspace />} />
            <Route path="pending" element={<PendingWashPage />} />
            <Route path="review" element={<RequireAuth min="EXPERT"><ReviewQueuePage /></RequireAuth>} />
            <Route path="history" element={<HistoryPage />} />
            <Route path="dataset" element={<RequireAuth min="EXPERT"><DatasetPage /></RequireAuth>} />
            <Route path="settings" element={<RequireAuth min="ADMIN"><SettingsPage /></RequireAuth>} />
            <Route path="pilot" element={<RequireAuth min="EXPERT"><PilotPage /></RequireAuth>} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
      <Toaster />
    </QueryClientProvider>
  );
}
