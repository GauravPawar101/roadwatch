export const SEVERITY_COLORS: Record<number, string> = {
  1: '#4CAF50',
  2: '#8BC34A',
  3: '#FF9800',
  4: '#FF5722',
  5: '#F44336',
};

export const SEVERITY_LABELS: Record<number, string> = {
  1: 'Low',
  2: 'Low-Medium',
  3: 'Medium',
  4: 'High',
  5: 'Critical',
};

export function getSeverityColor(severity: number): string {
  return SEVERITY_COLORS[severity] ?? '#666';
}

export function getSeverityLabel(severity: number): string {
  return SEVERITY_LABELS[severity] ?? 'Unknown';
}
