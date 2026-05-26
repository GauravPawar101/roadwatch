import { useEffect, useState } from 'react';

export type AnalyticsData = {
  totalComplaints: number;
  openComplaints: number;
  inProgressComplaints: number;
  resolvedComplaints: number;
  averageResolutionTime: number;
  slaBreaches: number;
  complaintsByType: Array<{
    type: string;
    count: number;
  }>;
  complaintsBySeverity: Array<{
    severity: number;
    count: number;
  }>;
  trendsData: Array<{
    date: string;
    complaints: number;
    resolved: number;
  }>;
};

export type BudgetData = {
  totalBudget: number;
  allocatedBudget: number;
  spentBudget: number;
  pendingBudget: number;
  budgetByCategory: Array<{
    category: string;
    allocated: number;
    spent: number;
  }>;
};

export type PerformanceData = {
  overallScore: number;
  resolutionRate: number;
  averageResponseTime: number;
  citizenSatisfaction: number;
  contractorPerformance: Array<{
    contractorId: string;
    name: string;
    completedTasks: number;
    averageRating: number;
    onTimeDelivery: number;
  }>;
};

export function useAuthorityAnalytics() {
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAnalytics = async () => {
    setLoading(true);
    setError(null);

    try {
      const apiBase = (import.meta as any).env?.VITE_API_BASE || 'http://localhost:3100';
      const token = localStorage.getItem('roadwatch_token');

      if (!token) {
        throw new Error('Authentication required');
      }

      const response = await fetch(`${apiBase}/authority/analytics`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch analytics: ${response.status}`);
      }

      const data = await response.json();
      setAnalytics(data);
    } catch (err) {
      console.error('Failed to fetch analytics:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch analytics');
      
      // Fallback to mock data for development
      setAnalytics({
        totalComplaints: 1247,
        openComplaints: 89,
        inProgressComplaints: 156,
        resolvedComplaints: 1002,
        averageResolutionTime: 4.2,
        slaBreaches: 23,
        complaintsByType: [
          { type: 'Potholes & Roads', count: 456 },
          { type: 'Street Lighting', count: 234 },
          { type: 'Water & Sewage', count: 189 },
          { type: 'Waste Management', count: 167 },
          { type: 'Signage', count: 201 }
        ],
        complaintsBySeverity: [
          { severity: 1, count: 123 },
          { severity: 2, count: 234 },
          { severity: 3, count: 456 },
          { severity: 4, count: 289 },
          { severity: 5, count: 145 }
        ],
        trendsData: [
          { date: '2024-01-01', complaints: 45, resolved: 38 },
          { date: '2024-01-02', complaints: 52, resolved: 41 },
          { date: '2024-01-03', complaints: 38, resolved: 45 },
          { date: '2024-01-04', complaints: 61, resolved: 52 },
          { date: '2024-01-05', complaints: 43, resolved: 39 }
        ]
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, []);

  return {
    analytics,
    loading,
    error,
    refetch: fetchAnalytics
  };
}

export function useBudgetData() {
  const [budget, setBudget] = useState<BudgetData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchBudget = async () => {
    setLoading(true);
    setError(null);

    try {
      const apiBase = (import.meta as any).env?.VITE_API_BASE || 'http://localhost:3100';
      const token = localStorage.getItem('roadwatch_token');

      if (!token) {
        throw new Error('Authentication required');
      }

      const response = await fetch(`${apiBase}/authority/budget`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch budget: ${response.status}`);
      }

      const data = await response.json();
      setBudget(data);
    } catch (err) {
      console.error('Failed to fetch budget:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch budget');
      
      // Fallback to mock data
      setBudget({
        totalBudget: 50000000,
        allocatedBudget: 35000000,
        spentBudget: 28000000,
        pendingBudget: 7000000,
        budgetByCategory: [
          { category: 'Road Repairs', allocated: 20000000, spent: 16000000 },
          { category: 'Street Lighting', allocated: 8000000, spent: 6500000 },
          { category: 'Drainage', allocated: 5000000, spent: 4200000 },
          { category: 'Signage', allocated: 2000000, spent: 1300000 }
        ]
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBudget();
  }, []);

  return {
    budget,
    loading,
    error,
    refetch: fetchBudget
  };
}

export function usePerformanceData() {
  const [performance, setPerformance] = useState<PerformanceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPerformance = async () => {
    setLoading(true);
    setError(null);

    try {
      const apiBase = (import.meta as any).env?.VITE_API_BASE || 'http://localhost:3100';
      const token = localStorage.getItem('roadwatch_token');

      if (!token) {
        throw new Error('Authentication required');
      }

      const response = await fetch(`${apiBase}/authority/performance/evaluation`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch performance: ${response.status}`);
      }

      const data = await response.json();
      setPerformance(data);
    } catch (err) {
      console.error('Failed to fetch performance:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch performance');
      
      // Fallback to mock data
      setPerformance({
        overallScore: 87.5,
        resolutionRate: 89.2,
        averageResponseTime: 2.4,
        citizenSatisfaction: 4.2,
        contractorPerformance: [
          { contractorId: 'c1', name: 'ABC Construction', completedTasks: 45, averageRating: 4.5, onTimeDelivery: 92 },
          { contractorId: 'c2', name: 'XYZ Infrastructure', completedTasks: 38, averageRating: 4.2, onTimeDelivery: 88 },
          { contractorId: 'c3', name: 'Road Masters Ltd', completedTasks: 52, averageRating: 4.7, onTimeDelivery: 95 }
        ]
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPerformance();
  }, []);

  return {
    performance,
    loading,
    error,
    refetch: fetchPerformance
  };
}