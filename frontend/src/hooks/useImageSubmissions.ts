import { useEffect, useState } from 'react';

export type ImageSubmission = {
  id: string;
  requestId: string;
  uploaderIdEncrypted: string;
  lat: number;
  lng: number;
  capturedAt: string;
  phash: string;
  verifiedStatus: 'pending' | 'verified' | 'flagged' | 'rejected';
  duplicateOf?: string;
  flagReason?: string;
  createdAt: string;
  metadata?: Record<string, any>;
};

export type KarmaRecord = {
  userId: string;
  score: number;
  tier: string;
  penaltyCount: number;
  lastUpdated: string;
};

export type LeaderboardEntry = {
  userId: string;
  username?: string;
  score: number;
  tier: string;
  rank: number;
  submissionCount: number;
};

export function useImageSubmissions(filters: {
  status?: string;
  limit?: number;
  offset?: number;
} = {}) {
  const [submissions, setSubmissions] = useState<ImageSubmission[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSubmissions = async () => {
    setLoading(true);
    setError(null);

    try {
      const apiBase = (import.meta as any).env?.VITE_API_BASE || 'http://localhost:3100';
      const imageApiBase = `${apiBase}/image-submissions`;
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

      const response = await fetch(`${imageApiBase}/submissions?${queryParams.toString()}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch submissions: ${response.status}`);
      }

      const data = await response.json();
      setSubmissions(data.data || data.submissions || []);
    } catch (err) {
      console.error('Failed to fetch image submissions:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch submissions');
      
      // Fallback to mock data
      setSubmissions([
        {
          id: 'sub1',
          requestId: 'req1',
          uploaderIdEncrypted: 'enc_user1',
          lat: 19.076,
          lng: 72.8777,
          capturedAt: '2024-01-15T10:30:00Z',
          phash: 'abc123def456',
          verifiedStatus: 'verified',
          createdAt: '2024-01-15T10:35:00Z',
          metadata: { roadId: 'r1', damageType: 'pothole' }
        },
        {
          id: 'sub2',
          requestId: 'req2',
          uploaderIdEncrypted: 'enc_user2',
          lat: 19.080,
          lng: 72.880,
          capturedAt: '2024-01-14T15:45:00Z',
          phash: 'def456ghi789',
          verifiedStatus: 'pending',
          createdAt: '2024-01-14T15:50:00Z',
          metadata: { roadId: 'r2', damageType: 'lighting' }
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSubmissions();
  }, [JSON.stringify(filters)]);

  return {
    submissions,
    loading,
    error,
    refetch: fetchSubmissions
  };
}

export function useImageSubmission(id: string) {
  const [submission, setSubmission] = useState<ImageSubmission | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSubmission = async () => {
    if (!id) return;

    setLoading(true);
    setError(null);

    try {
      const apiBase = (import.meta as any).env?.VITE_API_BASE || 'http://localhost:3100';
      const imageApiBase = `${apiBase}/image-submissions`;
      const token = localStorage.getItem('roadwatch_token');

      if (!token) {
        throw new Error('Authentication required');
      }

      const response = await fetch(`${imageApiBase}/submissions/${id}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch submission: ${response.status}`);
      }

      const data = await response.json();
      setSubmission(data.submission || data);
    } catch (err) {
      console.error('Failed to fetch image submission:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch submission');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSubmission();
  }, [id]);

  return {
    submission,
    loading,
    error,
    refetch: fetchSubmission
  };
}

export function useKarma(userId?: string) {
  const [karma, setKarma] = useState<KarmaRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchKarma = async () => {
    if (!userId) return;

    setLoading(true);
    setError(null);

    try {
      const apiBase = (import.meta as any).env?.VITE_API_BASE || 'http://localhost:3100';
      const imageApiBase = `${apiBase}/image-submissions`;
      const token = localStorage.getItem('roadwatch_token');

      if (!token) {
        throw new Error('Authentication required');
      }

      const response = await fetch(`${imageApiBase}/karma/${userId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch karma: ${response.status}`);
      }

      const data = await response.json();
      setKarma(data);
    } catch (err) {
      console.error('Failed to fetch karma:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch karma');
      
      // Fallback to mock data
      setKarma({
        userId: userId!,
        score: 150,
        tier: 'Bronze',
        penaltyCount: 0,
        lastUpdated: new Date().toISOString()
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchKarma();
  }, [userId]);

  return {
    karma,
    loading,
    error,
    refetch: fetchKarma
  };
}

export function useLeaderboard() {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLeaderboard = async () => {
    setLoading(true);
    setError(null);

    try {
      const apiBase = (import.meta as any).env?.VITE_API_BASE || 'http://localhost:3100';
      const imageApiBase = `${apiBase}/image-submissions`;
      const token = localStorage.getItem('roadwatch_token');

      if (!token) {
        throw new Error('Authentication required');
      }

      const response = await fetch(`${imageApiBase}/karma/leaderboard`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch leaderboard: ${response.status}`);
      }

      const data = await response.json();
      setLeaderboard(data.data || data.leaderboard || []);
    } catch (err) {
      console.error('Failed to fetch leaderboard:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch leaderboard');
      
      // Fallback to mock data
      setLeaderboard([
        { userId: 'user1', username: 'RoadWatcher1', score: 450, tier: 'Gold', rank: 1, submissionCount: 45 },
        { userId: 'user2', username: 'CitizenReporter', score: 320, tier: 'Silver', rank: 2, submissionCount: 32 },
        { userId: 'user3', username: 'SafetyFirst', score: 280, tier: 'Silver', rank: 3, submissionCount: 28 },
        { userId: 'user4', username: 'CommunityHelper', score: 150, tier: 'Bronze', rank: 4, submissionCount: 15 },
        { userId: 'user5', username: 'AlertCitizen', score: 120, tier: 'Bronze', rank: 5, submissionCount: 12 }
      ]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLeaderboard();
  }, []);

  return {
    leaderboard,
    loading,
    error,
    refetch: fetchLeaderboard
  };
}