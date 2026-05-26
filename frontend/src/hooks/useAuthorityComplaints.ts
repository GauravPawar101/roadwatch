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
      
      // Fallback to mock data
      const mockComplaints: ComplaintData[] = [
        {
          id: 'auth-c1',
          roadId: 'r1',
          title: 'Critical pothole cluster requiring immediate attention',
          description: 'Multiple deep potholes causing vehicle damage on NH-48',
          damageType: 'Potholes & Roads',
          severity: 5,
          status: 'Open',
          lat: 18.5204,
          lng: 73.8567,
          district: 'Pune',
          zone: 'Zone-A',
          reportCount: 8,
          createdAt: '2024-01-15T10:30:00Z',
          updatedAt: '2024-01-15T10:30:00Z',
          attachments: []
        },
        {
          id: 'auth-c2',
          roadId: 'r2',
          title: 'Street lighting failure on SH-27',
          description: 'Multiple street lights not working near junction',
          damageType: 'Street Lighting',
          severity: 3,
          status: 'InProgress',
          lat: 19.076,
          lng: 72.8777,
          district: 'Mumbai',
          zone: 'Zone-B',
          reportCount: 3,
          createdAt: '2024-01-14T15:45:00Z',
          updatedAt: '2024-01-16T09:20:00Z',
          attachments: []
        },
        {
          id: 'auth-c3',
          roadId: 'r1',
          title: 'Waterlogged road section during monsoon',
          description: 'Road floods during rain causing traffic disruption',
          damageType: 'Water & Sewage',
          severity: 4,
          status: 'Open',
          lat: 18.520,
          lng: 73.856,
          district: 'Pune',
          zone: 'Zone-A',
          reportCount: 5,
          createdAt: '2024-01-13T09:20:00Z',
          updatedAt: '2024-01-13T09:20:00Z',
          attachments: []
        }
      ];

      // Apply filters to mock data
      let filteredComplaints = mockComplaints;
      
      if (filters.status) {
        const statusList = filters.status.split(',');
        filteredComplaints = filteredComplaints.filter(c => statusList.includes(c.status));
      }
      
      if (filters.severity) {
        const severityList = filters.severity.split(',').map(Number);
        filteredComplaints = filteredComplaints.filter(c => severityList.includes(c.severity));
      }
      
      if (filters.district) {
        filteredComplaints = filteredComplaints.filter(c => c.district === filters.district);
      }

      setComplaints(filteredComplaints);
      setTotalCount(filteredComplaints.length);
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