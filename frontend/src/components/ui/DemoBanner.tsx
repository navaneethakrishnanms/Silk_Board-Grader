import { useQuery } from '@tanstack/react-query';
import { API } from '@/lib/api';

/** Yellow bar shown when the API runs with DATA_MODE=memory. */
export function DemoBanner() {
  const q = useQuery({
    queryKey: ['api-health'],
    queryFn: async () => (await fetch(`${API}/health`)).json() as Promise<{ dataMode?: string }>,
    staleTime: 60_000,
  });
  if (q.data?.dataMode !== 'memory') return null;
  return (
    <div role="status" className="sticky top-0 z-50 bg-yellow-300 px-4 py-1.5 text-center text-xs font-semibold text-yellow-950">
      DEMO MODE — data is not saved (it resets when the server restarts)
    </div>
  );
}
