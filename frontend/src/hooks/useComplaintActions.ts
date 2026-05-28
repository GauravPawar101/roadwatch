import { useState } from 'react';

export type ComplaintAction = 'escalate' | 'sla-warning' | 'resolve' | 'assign' | 'status-update';

export function useComplaintActions() {
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const performAction = async (
    complaintId: string, 
    action: ComplaintAction, 
    payload?: any
  ): Promise<boolean> => {
    const actionKey = `${complaintId}-${action}`;
    setLoading(prev => ({ ...prev, [actionKey]: true }));
    setError(null);

    try {
      const apiBase = (import.meta as any).env?.VITE_API_BASE || 'http://localhost:3100';
      const token = localStorage.getItem('roadwatch_token');

      if (!token) {
        throw new Error('Authentication required');
      }

      let endpoint = '';
      let method = 'POST';
      let body = payload;

      switch (action) {
        case 'escalate':
          endpoint = `/authority/complaints/${complaintId}/escalate`;
          body = { reason: payload?.reason || 'Manual escalation', escalatedTo: payload?.escalatedTo };
          break;
        case 'sla-warning':
          endpoint = `/authority/complaints/${complaintId}/sla-warning`;
          body = { message: payload?.message || 'SLA deadline approaching' };
          break;
        case 'resolve':
          endpoint = `/authority/complaints/${complaintId}/resolve`;
          body = { resolution: payload?.resolution, verificationImages: payload?.verificationImages };
          break;
        case 'assign':
          endpoint = `/authority/complaints/${complaintId}/assign`;
          body = { contractorId: payload?.contractorId, expectedCompletionDays: payload?.expectedCompletionDays };
          break;
        case 'status-update':
          endpoint = `/authority/complaints/${complaintId}/status`;
          body = { status: payload?.status, notes: payload?.notes };
          break;
        default:
          throw new Error(`Unknown action: ${action}`);
      }

      const response = await fetch(`${apiBase}${endpoint}`, {
        method,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to ${action} complaint`);
      }

      return true;
    } catch (err) {
      console.error(`Failed to ${action} complaint:`, err);
      setError(err instanceof Error ? err.message : `Failed to ${action} complaint`);
      return false;
    } finally {
      setLoading(prev => ({ ...prev, [actionKey]: false }));
    }
  };

  const escalateComplaint = (complaintId: string, reason?: string, escalatedTo?: string) => {
    return performAction(complaintId, 'escalate', { reason, escalatedTo });
  };

  const sendSLAWarning = (complaintId: string, message?: string) => {
    return performAction(complaintId, 'sla-warning', { message });
  };

  const resolveComplaint = (complaintId: string, resolution: string, verificationImages?: string[]) => {
    return performAction(complaintId, 'resolve', { resolution, verificationImages });
  };

  const assignComplaint = (complaintId: string, contractorId: string, expectedCompletionDays?: number) => {
    return performAction(complaintId, 'assign', { contractorId, expectedCompletionDays });
  };

  const updateComplaintStatus = (complaintId: string, status: string, notes?: string) => {
    return performAction(complaintId, 'status-update', { status, notes });
  };

  const isLoading = (complaintId: string, action: ComplaintAction) => {
    return loading[`${complaintId}-${action}`] || false;
  };

  return {
    escalateComplaint,
    sendSLAWarning,
    resolveComplaint,
    assignComplaint,
    updateComplaintStatus,
    isLoading,
    error
  };
}