import { useState } from 'react';

export type OTPPurpose = 'CITIZEN' | 'AUTHORITY' | 'CONTRACTOR';

export type OTPSession = {
  sessionId: string;
  expiresAt: string;
  attemptsRemaining: number;
};

export function useOTP() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<OTPSession | null>(null);

  const requestOTP = async (
    identifier: string, 
    purpose: OTPPurpose
  ): Promise<OTPSession | null> => {
    setLoading(true);
    setError(null);

    try {
      const apiBase = (import.meta as any).env?.VITE_API_BASE || 'http://localhost:3100';
      
      let endpoint = '';
      switch (purpose) {
        case 'CITIZEN':
          endpoint = '/auth/citizen/otp/request';
          break;
        case 'AUTHORITY':
          endpoint = '/auth/authority/otp/request';
          break;
        case 'CONTRACTOR':
          endpoint = '/auth/contractor/otp/request';
          break;
      }

      const response = await fetch(`${apiBase}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ identifier })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to request OTP');
      }

      const data = await response.json();
      const otpSession: OTPSession = {
        sessionId: data.sessionId,
        expiresAt: data.expiresAt,
        attemptsRemaining: data.attemptsRemaining || 3
      };

      setSession(otpSession);
      return otpSession;
    } catch (err) {
      console.error('Failed to request OTP:', err);
      setError(err instanceof Error ? err.message : 'Failed to request OTP');
      return null;
    } finally {
      setLoading(false);
    }
  };

  const verifyOTP = async (
    identifier: string,
    code: string,
    sessionId: string,
    purpose: OTPPurpose
  ): Promise<{ token: string; user: any } | null> => {
    setLoading(true);
    setError(null);

    try {
      const apiBase = (import.meta as any).env?.VITE_API_BASE || 'http://localhost:3100';
      
      let endpoint = '';
      switch (purpose) {
        case 'CITIZEN':
          endpoint = '/auth/citizen/otp/verify';
          break;
        case 'AUTHORITY':
          endpoint = '/auth/authority/otp/verify';
          break;
        case 'CONTRACTOR':
          endpoint = '/auth/contractor/otp/verify';
          break;
      }

      const response = await fetch(`${apiBase}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ identifier, code, sessionId })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Invalid OTP code');
      }

      const data = await response.json();
      setSession(null); // Clear session on successful verification
      return data;
    } catch (err) {
      console.error('Failed to verify OTP:', err);
      setError(err instanceof Error ? err.message : 'Failed to verify OTP');
      
      // Update attempts remaining
      if (session) {
        setSession({
          ...session,
          attemptsRemaining: Math.max(0, session.attemptsRemaining - 1)
        });
      }
      
      return null;
    } finally {
      setLoading(false);
    }
  };

  const clearSession = () => {
    setSession(null);
    setError(null);
  };

  return {
    requestOTP,
    verifyOTP,
    clearSession,
    session,
    loading,
    error
  };
}