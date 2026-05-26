import { useState } from 'react';

export type ReportType = 'district' | 'ministry';

export function useReports() {
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const generateReport = async (type: ReportType, districtId?: string): Promise<boolean> => {
    const reportKey = type === 'district' ? `district-${districtId}` : 'ministry';
    setLoading(prev => ({ ...prev, [reportKey]: true }));
    setError(null);

    try {
      const apiBase = (import.meta as any).env?.VITE_API_BASE || 'http://localhost:3100';
      const token = localStorage.getItem('roadwatch_token');

      if (!token) {
        throw new Error('Authentication required');
      }

      let endpoint = '';
      if (type === 'district' && districtId) {
        endpoint = `/reports/district/${districtId}.pdf`;
      } else if (type === 'ministry') {
        endpoint = `/reports/ministry.pdf`;
      } else {
        throw new Error('Invalid report type or missing district ID');
      }

      const response = await fetch(`${apiBase}${endpoint}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to generate ${type} report: ${response.status}`);
      }

      // Download the PDF
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${type}-report-${new Date().toISOString().split('T')[0]}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      return true;
    } catch (err) {
      console.error(`Failed to generate ${type} report:`, err);
      setError(err instanceof Error ? err.message : `Failed to generate ${type} report`);
      return false;
    } finally {
      setLoading(prev => ({ ...prev, [reportKey]: false }));
    }
  };

  const generateDistrictReport = (districtId: string) => {
    return generateReport('district', districtId);
  };

  const generateMinistryReport = () => {
    return generateReport('ministry');
  };

  const isLoading = (type: ReportType, districtId?: string) => {
    const reportKey = type === 'district' ? `district-${districtId}` : 'ministry';
    return loading[reportKey] || false;
  };

  return {
    generateDistrictReport,
    generateMinistryReport,
    isLoading,
    error
  };
}