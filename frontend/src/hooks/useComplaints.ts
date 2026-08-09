import { useEffect, useState } from 'react';
import { apiFetch, getAuthToken } from '../lib/api';

export type ComplaintData = {
  id: string;
  roadId: string;
  title: string;
  description: string;
  damageType: string;
  severity: number;
  status: 'Open' | 'InProgress' | 'Resolved' | 'Dismissed' | string;
  lat: number;
  lng: number;
  district?: string;
  zone?: string;
  reportCount: number;
  createdAt: string;
  updatedAt: string;
  attachments: Array<{
    id: string;
    kind: string;
    file_path: string;
    file_mime: string;
  }>;
};

export type ComplaintFilters = {
  bounds?: string;
  severity?: string;
  status?: string;
  damageType?: string;
  limit?: number;
  offset?: number;
};

type ComplaintsResponse = {
  complaints: ComplaintData[];
  pagination?: { limit: number; offset: number; total: number };
};

export function useComplaints(filters: ComplaintFilters = {}) {
  const [complaints, setComplaints] = useState<ComplaintData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);

  const fetchComplaints = async () => {
    if (!getAuthToken()) {
      setComplaints([]);
      setTotal(0);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const queryParams = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          queryParams.append(key, value.toString());
        }
      });

      const data = await apiFetch<ComplaintsResponse>(`/complaints?${queryParams.toString()}`);
      setComplaints(data.complaints || []);
      setTotal(data.pagination?.total ?? data.complaints?.length ?? 0);
    } catch (err) {
      console.error('Failed to fetch complaints:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch complaints');
      setComplaints([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchComplaints();
  }, [JSON.stringify(filters)]);

  return { complaints, loading, error, total, refetch: fetchComplaints };
}

export function useComplaint(id: string) {
  const [complaint, setComplaint] = useState<ComplaintData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchComplaint = async () => {
    if (!id) return;

    setLoading(true);
    setError(null);

    try {
      if (!getAuthToken()) {
        throw new Error('Authentication required');
      }

      const data = await apiFetch<ComplaintData>(`/complaints/${encodeURIComponent(id)}`);
      setComplaint(data);
    } catch (err) {
      console.error('Failed to fetch complaint:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch complaint');
      setComplaint(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchComplaint();
  }, [id]);

  return { complaint, loading, error, refetch: fetchComplaint };
}
