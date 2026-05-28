import { useEffect, useState } from 'react';

export type ComplaintData = {
  id: string;
  roadId: string;
  title: string;
  description: string;
  damageType: string;
  severity: number;
  status: 'Open' | 'InProgress' | 'Resolved' | 'Dismissed';
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
  bounds?: string; // "lat1,lng1,lat2,lng2"
  severity?: string; // "1,2,3,4,5"
  status?: string; // "Open,InProgress,Resolved"
  damageType?: string;
  limit?: number;
  offset?: number;
};

export function useComplaints(filters: ComplaintFilters = {}) {
  const [complaints, setComplaints] = useState<ComplaintData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchComplaints = async () => {
    setLoading(true);
    setError(null);

    try {
      const apiBase = (import.meta as any).env?.VITE_API_BASE || 'http://localhost:3100';
      const token = localStorage.getItem('roadwatch_token');

      if (!token) {
        throw new Error('Authentication required');
      }

      // Build query string
      const queryParams = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          queryParams.append(key, value.toString());
        }
      });

      const url = `${apiBase}/complaints?${queryParams.toString()}`;
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch complaints: ${response.status}`);
      }

      const data = await response.json();
      setComplaints(data.complaints || []);
    } catch (err) {
      console.error('Failed to fetch complaints:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch complaints');
      
      // Fallback to mock data for development
      setComplaints([
        { id: 'c1', roadId: 'r1', title: 'Critical pothole cluster on SH-27', description: 'Multiple deep potholes causing vehicle damage', damageType: 'Potholes & Roads', severity: 5, status: 'Open', lat: 19.076, lng: 72.8777, reportCount: 3, createdAt: '2024-01-15T10:30:00Z', updatedAt: '2024-01-15T10:30:00Z', attachments: [] },
        { id: 'c2', roadId: 'r2', title: 'Street light outage near junction', description: 'Multiple street lights not working', damageType: 'Street Lighting', severity: 3, status: 'InProgress', lat: 19.080, lng: 72.880, reportCount: 1, createdAt: '2024-01-14T15:45:00Z', updatedAt: '2024-01-14T15:45:00Z', attachments: [] },
        { id: 'c3', roadId: 'r1', title: 'Waterlogged road section', description: 'Road floods during rain', damageType: 'Water & Sewage', severity: 4, status: 'Open', lat: 19.070, lng: 72.875, reportCount: 2, createdAt: '2024-01-13T09:20:00Z', updatedAt: '2024-01-13T09:20:00Z', attachments: [] },
        { id: 'c4', roadId: 'r3', title: 'Faded lane markings', description: 'Lane markings barely visible', damageType: 'Signage', severity: 2, status: 'Resolved', lat: 18.520, lng: 73.856, reportCount: 1, createdAt: '2024-01-12T14:10:00Z', updatedAt: '2024-01-12T14:10:00Z', attachments: [] },
        { id: 'c5', roadId: 'r1', title: 'Deep potholes on NH-48', description: 'Dangerous potholes on highway', damageType: 'Potholes & Roads', severity: 4, status: 'Open', lat: 18.525, lng: 73.860, reportCount: 1, createdAt: '2024-01-11T11:30:00Z', updatedAt: '2024-01-11T11:30:00Z', attachments: [] },
        { id: 'c6', roadId: 'r3', title: 'Road debris obstruction', description: 'Construction debris blocking lane', damageType: 'Waste Management', severity: 3, status: 'InProgress', lat: 15.478, lng: 73.827, reportCount: 1, createdAt: '2024-01-10T16:20:00Z', updatedAt: '2024-01-10T16:20:00Z', attachments: [] },
        { id: 'c7', roadId: 'r2', title: 'Severe road damage after rain', description: 'Road surface deteriorated after heavy rain', damageType: 'Potholes & Roads', severity: 5, status: 'Open', lat: 19.085, lng: 72.885, reportCount: 4, createdAt: '2024-01-09T08:45:00Z', updatedAt: '2024-01-09T08:45:00Z', attachments: [] },
        { id: 'c8', roadId: 'r1', title: 'Minor sign wear', description: 'Road sign showing wear but still readable', damageType: 'Signage', severity: 1, status: 'Dismissed', lat: 18.515, lng: 73.850, reportCount: 1, createdAt: '2024-01-08T12:15:00Z', updatedAt: '2024-01-08T12:15:00Z', attachments: [] },
      ]);
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
    refetch: fetchComplaints
  };
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
      const apiBase = (import.meta as any).env?.VITE_API_BASE || 'http://localhost:3100';
      const token = localStorage.getItem('roadwatch_token');

      if (!token) {
        throw new Error('Authentication required');
      }

      const response = await fetch(`${apiBase}/complaints/${id}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch complaint: ${response.status}`);
      }

      const data = await response.json();
      setComplaint(data);
    } catch (err) {
      console.error('Failed to fetch complaint:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch complaint');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchComplaint();
  }, [id]);

  return {
    complaint,
    loading,
    error,
    refetch: fetchComplaint
  };
}