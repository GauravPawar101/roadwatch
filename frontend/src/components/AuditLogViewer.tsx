import { motion } from 'framer-motion';
import { useState } from 'react';
import { useAuditLogs, type AuditLogFilters } from '../hooks/useAuditLogs';

type Props = {
  targetId?: string;
  targetType?: string;
  className?: string;
};

export default function AuditLogViewer({ targetId, targetType, className = '' }: Props) {
  const [filters, setFilters] = useState<AuditLogFilters>({
    targetId,
    targetType,
    limit: 50,
    offset: 0
  });
  
  const [showFilters, setShowFilters] = useState(false);
  const { logs, loading, error, totalCount } = useAuditLogs(filters);

  const getActionIcon = (action: string) => {
    if (action.includes('created')) return 'add_circle';
    if (action.includes('updated') || action.includes('modified')) return 'edit';
    if (action.includes('deleted')) return 'delete';
    if (action.includes('uploaded')) return 'upload';
    if (action.includes('assigned')) return 'assignment';
    if (action.includes('escalated')) return 'trending_up';
    if (action.includes('resolved')) return 'check_circle';
    return 'history';
  };

  const getActionColor = (action: string) => {
    if (action.includes('created') || action.includes('uploaded')) return 'text-green-600 bg-green-50';
    if (action.includes('updated') || action.includes('modified')) return 'text-blue-600 bg-blue-50';
    if (action.includes('deleted')) return 'text-red-600 bg-red-50';
    if (action.includes('escalated')) return 'text-orange-600 bg-orange-50';
    if (action.includes('resolved')) return 'text-green-600 bg-green-50';
    return 'text-gray-600 bg-gray-50';
  };

  const formatActionLabel = (action: string) => {
    return action
      .split('.')
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  };

  return (
    <div className={`bg-white rounded-lg border border-gray-200 ${className}`}>
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Audit Log</h3>
            <p className="text-sm text-gray-600 mt-1">
              {totalCount} entries found
            </p>
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="px-3 py-1 text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-[16px]">filter_list</span>
            {showFilters ? 'Hide Filters' : 'Show Filters'}
          </button>
        </div>
      </div>

      {/* Filters */}
      {showFilters && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="px-6 py-4 border-b border-gray-200 bg-gray-50"
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Action</label>
              <select
                value={filters.action || ''}
                onChange={(e) => setFilters({ ...filters, action: e.target.value || undefined })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              >
                <option value="">All Actions</option>
                <option value="complaint">Complaint Actions</option>
                <option value="image">Image Actions</option>
                <option value="user">User Actions</option>
                <option value="created">Created</option>
                <option value="updated">Updated</option>
                <option value="deleted">Deleted</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Target Type</label>
              <select
                value={filters.targetType || ''}
                onChange={(e) => setFilters({ ...filters, targetType: e.target.value || undefined })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              >
                <option value="">All Types</option>
                <option value="complaint">Complaints</option>
                <option value="image_submission">Image Submissions</option>
                <option value="user">Users</option>
                <option value="contractor">Contractors</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date Range</label>
              <input
                type="date"
                value={filters.startDate || ''}
                onChange={(e) => setFilters({ ...filters, startDate: e.target.value || undefined })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>
          </div>
        </motion.div>
      )}

      {/* Error State */}
      {error && (
        <div className="px-6 py-4 bg-red-50 border-b border-red-200">
          <div className="flex items-center gap-2 text-red-700">
            <span className="material-symbols-outlined text-[20px]">error</span>
            <span className="text-sm">{error}</span>
          </div>
        </div>
      )}

      {/* Loading State */}
      {loading ? (
        <div className="p-8 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          <p className="text-gray-500 mt-2 text-sm">Loading audit logs...</p>
        </div>
      ) : logs.length === 0 ? (
        <div className="p-8 text-center">
          <span className="material-symbols-outlined text-gray-400 text-[48px] mb-2">history</span>
          <p className="text-gray-500">No audit logs found.</p>
        </div>
      ) : (
        /* Audit Log Entries */
        <div className="divide-y divide-gray-200 max-h-96 overflow-y-auto">
          {logs.map((log) => (
            <div key={log.id} className="px-6 py-4 hover:bg-gray-50">
              <div className="flex items-start gap-4">
                {/* Action Icon */}
                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${getActionColor(log.action)}`}>
                  <span className="material-symbols-outlined text-[16px]">
                    {getActionIcon(log.action)}
                  </span>
                </div>

                {/* Log Details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <h4 className="text-sm font-medium text-gray-900">
                      {formatActionLabel(log.action)}
                    </h4>
                    <time className="text-xs text-gray-500">
                      {new Date(log.createdAt).toLocaleString()}
                    </time>
                  </div>

                  <div className="text-sm text-gray-600 mb-2">
                    <span className="font-medium">{log.targetType}</span>
                    {' '}
                    <code className="px-1 py-0.5 bg-gray-100 rounded text-xs font-mono">
                      {log.targetId}
                    </code>
                    {log.actorPhoneMasked && (
                      <>
                        {' by '}
                        <span className="font-medium">{log.actorPhoneMasked}</span>
                      </>
                    )}
                  </div>

                  {/* Details */}
                  {Object.keys(log.details).length > 0 && (
                    <div className="text-xs text-gray-500">
                      <details className="cursor-pointer">
                        <summary className="hover:text-gray-700">View details</summary>
                        <div className="mt-2 p-2 bg-gray-50 rounded border">
                          <pre className="whitespace-pre-wrap font-mono text-xs">
                            {JSON.stringify(log.details, null, 2)}
                          </pre>
                        </div>
                      </details>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalCount > (filters.limit || 50) && (
        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
          <div className="text-sm text-gray-600">
            Showing {(filters.offset || 0) + 1} to {Math.min((filters.offset || 0) + (filters.limit || 50), totalCount)} of {totalCount} entries
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setFilters({ ...filters, offset: Math.max(0, (filters.offset || 0) - (filters.limit || 50)) })}
              disabled={!filters.offset}
              className="px-3 py-1 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <button
              onClick={() => setFilters({ ...filters, offset: (filters.offset || 0) + (filters.limit || 50) })}
              disabled={(filters.offset || 0) + (filters.limit || 50) >= totalCount}
              className="px-3 py-1 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}