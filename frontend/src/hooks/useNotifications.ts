import { useEffect, useState } from 'react';

export type NotificationItem = {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'warning' | 'error' | 'success';
  read: boolean;
  createdAt: string;
  metadata?: Record<string, any>;
};

export type NotificationPreferences = {
  email: boolean;
  sms: boolean;
  push: boolean;
  topics: string[];
};

export function useNotifications() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchNotifications = async () => {
    setLoading(true);
    setError(null);

    try {
      const apiBase = (import.meta as any).env?.VITE_API_BASE || 'http://localhost:3100';
      const token = localStorage.getItem('roadwatch_token');

      if (!token) {
        throw new Error('Authentication required');
      }

      const response = await fetch(`${apiBase}/notifications/inbox`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch notifications: ${response.status}`);
      }

      const data = await response.json();
      setNotifications(data.notifications || []);
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch notifications');
    } finally {
      setLoading(false);
    }
  };

  const markAsRead = async (notificationId: string) => {
    try {
      const apiBase = (import.meta as any).env?.VITE_API_BASE || 'http://localhost:3100';
      const token = localStorage.getItem('roadwatch_token');

      if (!token) return;

      const response = await fetch(`${apiBase}/notifications/inbox/${notificationId}/read`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        setNotifications(prev => 
          prev.map(n => n.id === notificationId ? { ...n, read: true } : n)
        );
      }
    } catch (error) {
      console.error('Failed to mark notification as read:', error);
    }
  };

  useEffect(() => {
    fetchNotifications();
  }, []);

  const unreadCount = notifications.filter(n => !n.read).length;

  return {
    notifications,
    loading,
    error,
    unreadCount,
    refetch: fetchNotifications,
    markAsRead
  };
}

export function useNotificationPreferences() {
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPreferences = async () => {
    setLoading(true);
    setError(null);

    try {
      const apiBase = (import.meta as any).env?.VITE_API_BASE || 'http://localhost:3100';
      const token = localStorage.getItem('roadwatch_token');

      if (!token) {
        throw new Error('Authentication required');
      }

      const response = await fetch(`${apiBase}/notifications/preferences`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch preferences: ${response.status}`);
      }

      const data = await response.json();
      setPreferences(data);
    } catch (err) {
      console.error('Failed to fetch notification preferences:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch preferences');
    } finally {
      setLoading(false);
    }
  };

  const updatePreferences = async (newPreferences: Partial<NotificationPreferences>) => {
    try {
      const apiBase = (import.meta as any).env?.VITE_API_BASE || 'http://localhost:3100';
      const token = localStorage.getItem('roadwatch_token');

      if (!token) return;

      const response = await fetch(`${apiBase}/notifications/preferences`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(newPreferences)
      });

      if (response.ok) {
        const data = await response.json();
        setPreferences(data);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to update notification preferences:', error);
      return false;
    }
  };

  useEffect(() => {
    fetchPreferences();
  }, []);

  return {
    preferences,
    loading,
    error,
    updatePreferences,
    refetch: fetchPreferences
  };
}