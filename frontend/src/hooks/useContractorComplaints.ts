import { useEffect, useState } from 'react';
import { apiFetch, getAuthToken } from '../lib/api';

export type ContractorComplaint = {
  id: string;
  district: string;
  zone: string;
  status: string;
  description: string;
  lat: number | null;
  lng: number | null;
  updatedAt: string;
  assignmentStatus: string | null;
  progressPct: number | null;
  progressNote: string | null;
  completedAt: string | null;
};

export function useContractorComplaints() {
  const [complaints, setComplaints] = useState<ContractorComplaint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchComplaints = async () => {
    setLoading(true);
    setError(null);

    try {
      if (!getAuthToken()) {
        throw new Error('Authentication required');
      }

      const data = await apiFetch<{ complaints: ContractorComplaint[] }>('/contractor/complaints');
      setComplaints(data.complaints || []);
    } catch (err) {
      console.error('Failed to fetch contractor complaints:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch complaints');
      setComplaints([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchComplaints();
  }, []);

  return { complaints, loading, error, refetch: fetchComplaints };
}
