import { useEffect, useState } from 'react';

export type User = {
  id: string;
  email?: string;
  phone?: string;
  username?: string;
  role: 'CITIZEN' | 'CE' | 'EE' | 'CONTRACTOR' | 'SUPER_ADMIN';
  fabricVerified: boolean;
  districts?: string[];
  zones?: string[];
  createdAt: string;
  updatedAt: string;
};

export type Contractor = {
  id: string;
  name: string;
  contactInfo: string;
  metadata: Record<string, any>;
  createdAt: string;
};

export type Region = {
  id: string;
  name: string;
  parentId?: string;
  type: 'country' | 'state' | 'district';
  metadata?: Record<string, any>;
};

export type Road = {
  id: string;
  name: string;
  districtId: string;
  authorityId: string;
  roadType: string;
  geometry?: any;
  metadata?: Record<string, any>;
};

export function useAdminUsers() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchUsers = async () => {
    setLoading(true);
    setError(null);

    try {
      const apiBase = (import.meta as any).env?.VITE_API_BASE || 'http://localhost:3100';
      const token = localStorage.getItem('roadwatch_token');

      if (!token) {
        throw new Error('Authentication required');
      }

      const response = await fetch(`${apiBase}/admin/users`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch users: ${response.status}`);
      }

      const data = await response.json();
      setUsers(data.users || []);
    } catch (err) {
      console.error('Failed to fetch users:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch users');
    } finally {
      setLoading(false);
    }
  };

  const createUser = async (userData: Partial<User>): Promise<boolean> => {
    try {
      const apiBase = (import.meta as any).env?.VITE_API_BASE || 'http://localhost:3100';
      const token = localStorage.getItem('roadwatch_token');

      if (!token) {
        throw new Error('Authentication required');
      }

      const response = await fetch(`${apiBase}/admin/users`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(userData)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to create user');
      }

      await fetchUsers(); // Refresh the list
      return true;
    } catch (err) {
      console.error('Failed to create user:', err);
      setError(err instanceof Error ? err.message : 'Failed to create user');
      return false;
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  return {
    users,
    loading,
    error,
    createUser,
    refetch: fetchUsers
  };
}

export function useAdminContractors() {
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchContractors = async () => {
    setLoading(true);
    setError(null);

    try {
      // Since there's no GET endpoint, we'll simulate with empty array
      // In a real implementation, you'd add a GET /admin/contractors endpoint
      setContractors([]);
    } catch (err) {
      console.error('Failed to fetch contractors:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch contractors');
    } finally {
      setLoading(false);
    }
  };

  const createContractor = async (contractorData: Partial<Contractor>): Promise<boolean> => {
    try {
      const apiBase = (import.meta as any).env?.VITE_API_BASE || 'http://localhost:3100';
      const token = localStorage.getItem('roadwatch_token');

      if (!token) {
        throw new Error('Authentication required');
      }

      const response = await fetch(`${apiBase}/admin/contractors`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(contractorData)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to create contractor');
      }

      await fetchContractors(); // Refresh the list
      return true;
    } catch (err) {
      console.error('Failed to create contractor:', err);
      setError(err instanceof Error ? err.message : 'Failed to create contractor');
      return false;
    }
  };

  useEffect(() => {
    fetchContractors();
  }, []);

  return {
    contractors,
    loading,
    error,
    createContractor,
    refetch: fetchContractors
  };
}

export function useAdminRegions() {
  const [regions, setRegions] = useState<Region[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createCountry = async (countryData: { name: string; metadata?: Record<string, any> }): Promise<boolean> => {
    try {
      const apiBase = (import.meta as any).env?.VITE_API_BASE || 'http://localhost:3100';
      const token = localStorage.getItem('roadwatch_token');

      if (!token) {
        throw new Error('Authentication required');
      }

      const response = await fetch(`${apiBase}/admin/regions/countries`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(countryData)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to create country');
      }

      return true;
    } catch (err) {
      console.error('Failed to create country:', err);
      setError(err instanceof Error ? err.message : 'Failed to create country');
      return false;
    }
  };

  const createState = async (stateData: { name: string; countryId: string; metadata?: Record<string, any> }): Promise<boolean> => {
    try {
      const apiBase = (import.meta as any).env?.VITE_API_BASE || 'http://localhost:3100';
      const token = localStorage.getItem('roadwatch_token');

      if (!token) {
        throw new Error('Authentication required');
      }

      const response = await fetch(`${apiBase}/admin/regions/states`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(stateData)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to create state');
      }

      return true;
    } catch (err) {
      console.error('Failed to create state:', err);
      setError(err instanceof Error ? err.message : 'Failed to create state');
      return false;
    }
  };

  const createDistrict = async (districtData: { name: string; stateId: string; metadata?: Record<string, any> }): Promise<boolean> => {
    try {
      const apiBase = (import.meta as any).env?.VITE_API_BASE || 'http://localhost:3100';
      const token = localStorage.getItem('roadwatch_token');

      if (!token) {
        throw new Error('Authentication required');
      }

      const response = await fetch(`${apiBase}/admin/regions/districts`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(districtData)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to create district');
      }

      return true;
    } catch (err) {
      console.error('Failed to create district:', err);
      setError(err instanceof Error ? err.message : 'Failed to create district');
      return false;
    }
  };

  return {
    regions,
    loading,
    error,
    createCountry,
    createState,
    createDistrict
  };
}

export function useAdminRoads() {
  const [roads, setRoads] = useState<Road[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bulkUpsertRoads = async (districtId: string, roadsData: Partial<Road>[]): Promise<boolean> => {
    try {
      const apiBase = (import.meta as any).env?.VITE_API_BASE || 'http://localhost:3100';
      const token = localStorage.getItem('roadwatch_token');

      if (!token) {
        throw new Error('Authentication required');
      }

      const response = await fetch(`${apiBase}/admin/regions/districts/${districtId}/roads`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ roads: roadsData })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to upsert roads');
      }

      return true;
    } catch (err) {
      console.error('Failed to upsert roads:', err);
      setError(err instanceof Error ? err.message : 'Failed to upsert roads');
      return false;
    }
  };

  const createRoadAssignment = async (roadId: string, assignmentData: { contractorId: string; metadata?: Record<string, any> }): Promise<boolean> => {
    try {
      const apiBase = (import.meta as any).env?.VITE_API_BASE || 'http://localhost:3100';
      const token = localStorage.getItem('roadwatch_token');

      if (!token) {
        throw new Error('Authentication required');
      }

      const response = await fetch(`${apiBase}/admin/roads/${roadId}/assignments`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(assignmentData)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to create road assignment');
      }

      return true;
    } catch (err) {
      console.error('Failed to create road assignment:', err);
      setError(err instanceof Error ? err.message : 'Failed to create road assignment');
      return false;
    }
  };

  return {
    roads,
    loading,
    error,
    bulkUpsertRoads,
    createRoadAssignment
  };
}