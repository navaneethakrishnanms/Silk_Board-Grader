import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { hasRole, type Role } from '@silkgrade/shared';
import { Toaster } from '@/components/ui';
import { DatasetPage } from '@/features/dataset/DatasetPage';
import { HistoryPage } from '@/features/history/HistoryPage';
import { ReviewQueuePage } from '@/features/review/ReviewQueuePage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { NewTestPage } from '@/features/tests/NewTestPage';
import { TestWorkspace } from '@/features/tests/TestWorkspace';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/utils';
import { DashboardPage } from '@/pages/DashboardPage';
import { LoginPage } from '@/pages/LoginPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { PendingWashPage } from '@/pages/PendingWashPage';
import { ReportPreviewPage } from '@/pages/ReportPreviewPage';
import { Layout } from './Layout';

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
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
      <Toaster />
    </QueryClientProvider>
  );
}
