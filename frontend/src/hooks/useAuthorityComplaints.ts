import { useEffect, useState } from 'react';
import { ComplaintData } from './useComplaints';

export type AuthorityComplaintFilters = {
  status?: string;
  district?: string;
  zone?: string;
  severity?: string;
  assignedTo?: string;
  slaStatus?: 'within' | 'approaching' | 'breached';
  limit?: number;
  offset?: number;
};

export function useAuthorityComplaints(filters: AuthorityComplaintFilters = {}) {
  const [complaints, setComplaints] = useState<ComplaintData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);

  const fetchComplaints = async () => {
    setLoading(true);
    setError(null);

    try {
      const apiBase = (import.meta as any).env?.VITE_API_BASE || 'http://localhost:3100';
      const token = localStorage.getItem('roadwatch_token');

      if (!token) {
        throw new Error('Authentication required');
      }

      const queryParams = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          queryParams.append(key, value.toString());
        }
      });

      const response = await fetch(`${apiBase}/authority/complaints?${queryParams.toString()}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch authority complaints: ${response.status}`);
      }

      const data = await response.json();
      setComplaints(data.complaints || []);
      setTotalCount(data.totalCount || 0);
    } catch (err) {
      console.error('Failed to fetch authority complaints:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch complaints');
      setComplaints([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchComplaints();
  }, [JSON.stringify(filters)]);

  return {
    complaints,
    loading,
    error,
    totalCount,
    refetch: fetchComplaints
  };
}