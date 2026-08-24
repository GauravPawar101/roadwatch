import { useEffect, useState } from 'react';

export type AuditLogEntry = {
  id: string;
  actorUserId: string;
  actorPhoneHash?: string;
  actorPhoneMasked?: string;
  action: string;
  targetType: string;
  targetId: string;
  details: Record<string, any>;
  createdAt: string;
};

export type AuditLogFilters = {
  action?: string;
  targetType?: string;
  targetId?: string;
  actorUserId?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
};

export function useAuditLogs(filters: AuditLogFilters = {}) {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);

  const fetchAuditLogs = async () => {
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

      const response = await fetch(`${apiBase}/authority/audit?${queryParams.toString()}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch audit logs: ${response.status}`);
      }

      const data = await response.json();
      setLogs(data.logs || []);
      setTotalCount(data.totalCount || 0);
    } catch (err) {
      console.error('Failed to fetch audit logs:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch audit logs');
      
      // Fallback to mock data
      const mockLogs: AuditLogEntry[] = [
        {
          id: 'audit-1',
          actorUserId: 'user-123',
          actorPhoneMasked: '+91****1234',
          action: 'complaint.created',
          targetType: 'complaint',
          targetId: 'comp-456',
          details: {
            title: 'Pothole on NH-48',
            severity: 4,
            location: { lat: 28.6139, lng: 77.209 }
          },
          createdAt: '2024-01-15T10:30:00Z'
        },
        {
          id: 'audit-2',
          actorUserId: 'auth-789',
          actorPhoneMasked: '+91****5678',
          action: 'complaint.status_updated',
          targetType: 'complaint',
          targetId: 'comp-456',
          details: {
            oldStatus: 'Open',
            newStatus: 'InProgress',
            assignedTo: 'contractor-101'
          },
          createdAt: '2024-01-15T14:20:00Z'
        },
        {
          id: 'audit-3',
          actorUserId: 'user-234',
          actorPhoneMasked: '+91****9012',
          action: 'image.uploaded',
          targetType: 'image_submission',
          targetId: 'img-789',
          details: {
            complaintId: 'comp-456',
            fileSize: 2048576,
            verified: true
          },
          createdAt: '2024-01-15T11:45:00Z'
        }
      ];

      // Apply filters to mock data
      let filteredLogs = mockLogs;
      
      if (filters.action) {
        filteredLogs = filteredLogs.filter(log => log.action.includes(filters.action!));
      }
      
      if (filters.targetType) {
        filteredLogs = filteredLogs.filter(log => log.targetType === filters.targetType);
      }
      
      if (filters.targetId) {
        filteredLogs = filteredLogs.filter(log => log.targetId === filters.targetId);
      }

      setLogs(filteredLogs);
      setTotalCount(filteredLogs.length);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAuditLogs();
  }, [JSON.stringify(filters)]);

  return {
    logs,
    loading,
    error,
    totalCount,
    refetch: fetchAuditLogs
  };
}