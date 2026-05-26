import { motion } from 'framer-motion';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ComplaintActions from '../../components/ComplaintActions';
import { useAuth } from '../../contexts/AuthContext';
import { useAuthorityAnalytics } from '../../hooks/useAuthorityAnalytics';
import { useAuthorityComplaints } from '../../hooks/useAuthorityComplaints';

export default function AuthorityDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'overview' | 'complaints' | 'analytics'>('overview');
  const [complaintFilters, setComplaintFilters] = useState({
    status: 'Open,InProgress',
    limit: 20
  });

  const { complaints, loading: complaintsLoading, totalCount, refetch } = useAuthorityComplaints(complaintFilters);
  const { analytics, loading: analyticsLoading } = useAuthorityAnalytics();

  // Check if user has authority permissions
  if (user?.role !== 'CE' && user?.role !== 'EE') {
    return (
      <div className="page-radial-bg min-h-screen text-on-surface flex items-center justify-center">
        <div className="text-center glass-panel rounded-2xl p-8">
          <div className="w-16 h-16 bg-error-container rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="material-symbols-outlined text-error text-[32px]">block</span>
          </div>
          <h1 className="text-2xl font-bold text-on-surface mb-2">Access Denied</h1>
          <p className="text-on-surface-variant">You don't have authority permissions to access this dashboard.</p>
        </div>
      </div>
    );
  }

  const tabs = [
    { id: 'overview' as const, label: 'Overview', icon: 'dashboard' },
    { id: 'complaints' as const, label: 'Complaints', icon: 'report_problem' },
    { id: 'analytics' as const, label: 'Analytics', icon: 'analytics' }
  ];

  return (
    <div className="page-radial-bg min-h-screen text-on-surface">
      {/* Header */}
      <div className="glass-panel rounded-none border-x-0 border-t-0">
        <div className="container-max">
          <div className="py-6">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold text-on-surface">Authority Dashboard</h1>
                <p className="text-on-surface-variant mt-1">
                  Manage complaints and infrastructure issues in your jurisdiction
                </p>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 px-3 py-1 bg-secondary-container rounded-full">
                  <span className="material-symbols-outlined text-secondary text-[20px]">badge</span>
                  <span className="text-sm font-medium text-on-secondary-container">{user.role}</span>
                </div>
                {user.districts && user.districts.length > 0 && (
                  <div className="text-sm text-on-surface-variant">
                    <span className="font-medium">Districts:</span> {user.districts.join(', ')}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="glass-panel rounded-none border-x-0 border-t-0">
        <div className="container-max">
          <nav className="flex space-x-8">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-secondary text-secondary'
                    : 'border-transparent text-on-surface-variant hover:text-on-surface hover:border-outline-variant'
                }`}
              >
                <span className="material-symbols-outlined text-[20px]">{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Content */}
      <div className="container-max py-8">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          {activeTab === 'overview' && (
            <OverviewTab 
              analytics={analytics} 
              complaints={complaints.slice(0, 5)} 
              loading={analyticsLoading || complaintsLoading}
            />
          )}
          {activeTab === 'complaints' && (
            <ComplaintsTab 
              complaints={complaints}
              loading={complaintsLoading}
              totalCount={totalCount}
              filters={complaintFilters}
              onFiltersChange={setComplaintFilters}
              onComplaintUpdate={refetch}
            />
          )}
          {activeTab === 'analytics' && (
            <AnalyticsTab analytics={analytics} loading={analyticsLoading} />
          )}
        </motion.div>
      </div>
    </div>
  );
}

function OverviewTab({ analytics, complaints, loading }: any) {
  if (loading) {
    return (
      <div className="space-y-6">
        {/* Loading skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="glass-panel rounded-2xl p-6 animate-pulse">
              <div className="h-4 bg-surface-container-low rounded w-3/4 mb-2"></div>
              <div className="h-8 bg-surface-container-low rounded w-1/2"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <MetricCard
          title="Total Complaints"
          value={analytics?.totalComplaints || 0}
          icon="report_problem"
          color="blue"
        />
        <MetricCard
          title="Open Issues"
          value={analytics?.openComplaints || 0}
          icon="error"
          color="red"
        />
        <MetricCard
          title="In Progress"
          value={analytics?.inProgressComplaints || 0}
          icon="pending"
          color="yellow"
        />
        <MetricCard
          title="Resolved"
          value={analytics?.resolvedComplaints || 0}
          icon="check_circle"
          color="green"
        />
      </div>

      {/* Recent Complaints */}
      <div className="glass-panel rounded-2xl">
        <div className="px-6 py-4 border-b border-outline-variant">
          <h3 className="text-lg font-semibold text-on-surface">Recent Complaints</h3>
        </div>
        <div className="divide-y divide-outline-variant">
          {complaints.map((complaint: any) => (
            <div key={complaint.id} className="p-6 hover:bg-surface-container-low">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <h4 className="text-sm font-medium text-on-surface">{complaint.title}</h4>
                  <p className="text-sm text-on-surface-variant mt-1">{complaint.description}</p>
                  <div className="flex items-center gap-4 mt-2 text-xs text-on-surface-variant">
                    <span>Severity: {complaint.severity}/5</span>
                    <span>Reports: {complaint.reportCount}</span>
                    <span>{new Date(complaint.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                    complaint.status === 'Open' ? 'bg-error-container text-error' :
                    complaint.status === 'InProgress' ? 'bg-secondary-container text-secondary' :
                    'bg-tertiary-container text-on-tertiary-container'
                  }`}>
                    {complaint.status}
                  </span>
                  <button
                    onClick={() => window.location.href = `/complaints/${complaint.id}`}
                    className="text-secondary hover:text-primary text-sm font-medium"
                  >
                    View Details
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ComplaintsTab({ complaints, loading, totalCount, filters, onFiltersChange, onComplaintUpdate }: any) {
  const [selectedComplaint, setSelectedComplaint] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="glass-panel rounded-2xl p-6">
        <h3 className="text-lg font-semibold text-on-surface mb-4">Filter Complaints</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-on-surface-variant mb-1">Status</label>
            <select
              value={filters.status}
              onChange={(e) => onFiltersChange({ ...filters, status: e.target.value })}
              className="w-full px-3 py-2 border border-outline-variant rounded-lg focus:outline-none focus:ring-2 focus:ring-secondary"
            >
              <option value="Open,InProgress">Active Issues</option>
              <option value="Open">Open Only</option>
              <option value="InProgress">In Progress Only</option>
              <option value="Resolved">Resolved</option>
              <option value="">All Statuses</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-on-surface-variant mb-1">Severity</label>
            <select
              value={filters.severity || ''}
              onChange={(e) => onFiltersChange({ ...filters, severity: e.target.value })}
              className="w-full px-3 py-2 border border-outline-variant rounded-lg focus:outline-none focus:ring-2 focus:ring-secondary"
            >
              <option value="">All Severities</option>
              <option value="5">Critical (5)</option>
              <option value="4">High (4)</option>
              <option value="3">Medium (3)</option>
              <option value="2">Low (2)</option>
              <option value="1">Minor (1)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-on-surface-variant mb-1">District</label>
            <select
              value={filters.district || ''}
              onChange={(e) => onFiltersChange({ ...filters, district: e.target.value })}
              className="w-full px-3 py-2 border border-outline-variant rounded-lg focus:outline-none focus:ring-2 focus:ring-secondary"
            >
              <option value="">All Districts</option>
              <option value="Pune">Pune</option>
              <option value="Mumbai">Mumbai</option>
              <option value="Nashik">Nashik</option>
            </select>
          </div>
        </div>
      </div>

      {/* Complaints List */}
      <div className="glass-panel rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-outline-variant">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-on-surface">
              Complaints ({totalCount})
            </h3>
          </div>
        </div>

        {loading ? (
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-secondary mx-auto"></div>
            <p className="text-on-surface-variant mt-2">Loading complaints...</p>
          </div>
        ) : complaints.length === 0 ? (
          <div className="p-8 text-center">
            <span className="material-symbols-outlined text-on-surface-variant text-[48px] mb-2">inbox</span>
            <p className="text-on-surface-variant">No complaints found matching your filters.</p>
          </div>
        ) : (
          <div className="divide-y divide-outline-variant">
            {complaints.map((complaint: any) => (
              <div key={complaint.id} className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h4 className="text-lg font-medium text-on-surface">{complaint.title}</h4>
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                        complaint.severity >= 4 ? 'bg-red-100 text-red-800' :
                        complaint.severity === 3 ? 'bg-yellow-100 text-yellow-800' :
                        'bg-green-100 text-green-800'
                      }`}>
                        Severity {complaint.severity}
                      </span>
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                        complaint.status === 'Open' ? 'bg-red-100 text-red-800' :
                        complaint.status === 'InProgress' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-green-100 text-green-800'
                      }`}>
                        {complaint.status}
                      </span>
                    </div>
                    <p className="text-on-surface-variant mb-3">{complaint.description}</p>
                    <div className="flex items-center gap-6 text-sm text-on-surface-variant">
                      <span>📍 {complaint.district} - {complaint.zone}</span>
                      <span>📊 {complaint.reportCount} reports</span>
                      <span>📅 {new Date(complaint.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    <button
                      onClick={() => setSelectedComplaint(
                        selectedComplaint === complaint.id ? null : complaint.id
                      )}
                      className="px-3 py-1 text-sm text-secondary hover:text-primary font-medium"
                    >
                      {selectedComplaint === complaint.id ? 'Hide Actions' : 'Show Actions'}
                    </button>
                  </div>
                </div>

                {/* Complaint Actions */}
                {selectedComplaint === complaint.id && (
                  <div className="mt-4 pt-4 border-t border-outline-variant">
                    <ComplaintActions
                      complaintId={complaint.id}
                      currentStatus={complaint.status}
                      onActionComplete={() => {
                        onComplaintUpdate();
                        setSelectedComplaint(null);
                      }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AnalyticsTab({ analytics, loading }: any) {
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[1, 2].map(i => (
            <div key={i} className="glass-panel rounded-2xl p-6 animate-pulse">
              <div className="h-4 bg-surface-container-low rounded w-1/2 mb-4"></div>
              <div className="h-32 bg-surface-container-low rounded"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Complaints by Type */}
        <div className="glass-panel rounded-2xl p-6">
          <h3 className="text-lg font-semibold text-on-surface mb-4">Complaints by Type</h3>
          <div className="space-y-3">
            {analytics?.complaintsByType?.map((item: any) => (
              <div key={item.type} className="flex items-center justify-between">
                <span className="text-sm text-on-surface-variant">{item.type}</span>
                <div className="flex items-center gap-2">
                  <div className="w-24 bg-surface-container-low rounded-full h-2">
                    <div
                      className="bg-secondary h-2 rounded-full"
                      style={{ width: `${(item.count / analytics.totalComplaints) * 100}%` }}
                    />
                  </div>
                  <span className="text-sm font-medium text-on-surface">{item.count}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Complaints by Severity */}
        <div className="glass-panel rounded-2xl p-6">
          <h3 className="text-lg font-semibold text-on-surface mb-4">Complaints by Severity</h3>
          <div className="space-y-3">
            {analytics?.complaintsBySeverity?.map((item: any) => (
              <div key={item.severity} className="flex items-center justify-between">
                <span className="text-sm text-on-surface-variant">Severity {item.severity}</span>
                <div className="flex items-center gap-2">
                  <div className="w-24 bg-surface-container-low rounded-full h-2">
                    <div
                      className={`h-2 rounded-full ${
                        item.severity >= 4 ? 'bg-error' :
                        item.severity === 3 ? 'bg-secondary' :
                        'bg-tertiary'
                      }`}
                      style={{ width: `${(item.count / analytics.totalComplaints) * 100}%` }}
                    />
                  </div>
                  <span className="text-sm font-medium text-on-surface">{item.count}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Performance Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <MetricCard
          title="Avg Resolution Time"
          value={`${analytics?.averageResolutionTime || 0} days`}
          icon="schedule"
          color="blue"
        />
        <MetricCard
          title="SLA Breaches"
          value={analytics?.slaBreaches || 0}
          icon="warning"
          color="red"
        />
        <MetricCard
          title="Resolution Rate"
          value={`${Math.round(((analytics?.resolvedComplaints || 0) / (analytics?.totalComplaints || 1)) * 100)}%`}
          icon="trending_up"
          color="green"
        />
      </div>
    </div>
  );
}

function MetricCard({ title, value, icon, color }: { title: string; value: string | number; icon: string; color: 'blue' | 'red' | 'yellow' | 'green' }) {
  const colorClasses = {
    blue: 'text-blue-600 bg-blue-50',
    red: 'text-red-600 bg-red-50',
    yellow: 'text-yellow-600 bg-yellow-50',
    green: 'text-green-600 bg-green-50'
  };

  return (
    <div className="glass-panel rounded-2xl p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-on-surface-variant">{title}</p>
          <p className="text-2xl font-bold text-on-surface mt-1">{value}</p>
        </div>
        <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${colorClasses[color]}`}>
          <span className="material-symbols-outlined text-[24px]">{icon}</span>
        </div>
      </div>
    </div>
  );
}