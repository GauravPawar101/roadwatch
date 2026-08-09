import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

type PublicDashboard = {
  generatedAt: string;
  roadHealthIndex: number;
  totals: { total: number };
  byStatus: Record<string, number>;
  hotspots: Array<{ lat: number; lng: number; count: number; label?: string }>;
};

export function usePublicDashboard(district?: string) {
  const [data, setData] = useState<PublicDashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);

    const params = district ? `?district=${encodeURIComponent(district)}` : '';
    apiFetch<PublicDashboard>(`/public/dashboard${params}`)
      .then((result) => {
        if (mounted) setData(result);
      })
      .catch((err) => {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to load dashboard');
          setData(null);
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [district]);

  return { data, loading, error };
}
