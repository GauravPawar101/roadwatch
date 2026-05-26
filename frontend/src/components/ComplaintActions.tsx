import { motion } from 'framer-motion';
import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useComplaintActions } from '../hooks/useComplaintActions';

type Props = {
  complaintId: string;
  currentStatus: string;
  onActionComplete?: () => void;
};

export default function ComplaintActions({ complaintId, currentStatus, onActionComplete }: Props) {
  const { user } = useAuth();
  const { escalateComplaint, sendSLAWarning, resolveComplaint, updateComplaintStatus, isLoading, error } = useComplaintActions();
  
  const [showEscalateModal, setShowEscalateModal] = useState(false);
  const [showResolveModal, setShowResolveModal] = useState(false);
  const [escalationReason, setEscalationReason] = useState('');
  const [resolutionNotes, setResolutionNotes] = useState('');

  const canEscalate = user?.role === 'CE' || user?.role === 'EE';
  const canResolve = user?.role === 'CE' || user?.role === 'EE' || user?.role === 'CONTRACTOR';
  const canSendSLA = user?.role === 'CE' || user?.role === 'EE';

  const handleEscalate = async () => {
    const success = await escalateComplaint(complaintId, escalationReason);
    if (success) {
      setShowEscalateModal(false);
      setEscalationReason('');
      onActionComplete?.();
    }
  };

  const handleResolve = async () => {
    const success = await resolveComplaint(complaintId, resolutionNotes);
    if (success) {
      setShowResolveModal(false);
      setResolutionNotes('');
      onActionComplete?.();
    }
  };

  const handleSLAWarning = async () => {
    const success = await sendSLAWarning(complaintId);
    if (success) {
      onActionComplete?.();
    }
  };

  const handleStatusUpdate = async (newStatus: string) => {
    const success = await updateComplaintStatus(complaintId, newStatus);
    if (success) {
      onActionComplete?.();
    }
  };

  if (!canEscalate && !canResolve && !canSendSLA) {
    return null; // No actions available for this user
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Complaint Actions</h3>
      
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Status Updates */}
        {currentStatus === 'Open' && canResolve && (
          <button
            onClick={() => handleStatusUpdate('InProgress')}
            disabled={isLoading(complaintId, 'status-update')}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
          >
            {isLoading(complaintId, 'status-update') ? 'Updating...' : 'Start Work'}
          </button>
        )}

        {/* Escalate */}
        {canEscalate && currentStatus !== 'Resolved' && (
          <button
            onClick={() => setShowEscalateModal(true)}
            disabled={isLoading(complaintId, 'escalate')}
            className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
          >
            {isLoading(complaintId, 'escalate') ? 'Escalating...' : 'Escalate'}
          </button>
        )}

        {/* SLA Warning */}
        {canSendSLA && currentStatus !== 'Resolved' && (
          <button
            onClick={handleSLAWarning}
            disabled={isLoading(complaintId, 'sla-warning')}
            className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
          >
            {isLoading(complaintId, 'sla-warning') ? 'Sending...' : 'SLA Warning'}
          </button>
        )}

        {/* Resolve */}
        {canResolve && currentStatus !== 'Resolved' && (
          <button
            onClick={() => setShowResolveModal(true)}
            disabled={isLoading(complaintId, 'resolve')}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
          >
            {isLoading(complaintId, 'resolve') ? 'Resolving...' : 'Mark Resolved'}
          </button>
        )}
      </div>

      {/* Escalate Modal */}
      {showEscalateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-lg p-6 w-full max-w-md mx-4"
          >
            <h4 className="text-lg font-semibold text-gray-900 mb-4">Escalate Complaint</h4>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Escalation Reason
                </label>
                <textarea
                  value={escalationReason}
                  onChange={(e) => setEscalationReason(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={3}
                  placeholder="Explain why this complaint needs escalation..."
                />
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleEscalate}
                  disabled={!escalationReason.trim() || isLoading(complaintId, 'escalate')}
                  className="flex-1 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isLoading(complaintId, 'escalate') ? 'Escalating...' : 'Escalate'}
                </button>
                <button
                  onClick={() => setShowEscalateModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Resolve Modal */}
      {showResolveModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-lg p-6 w-full max-w-md mx-4"
          >
            <h4 className="text-lg font-semibold text-gray-900 mb-4">Resolve Complaint</h4>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Resolution Notes
                </label>
                <textarea
                  value={resolutionNotes}
                  onChange={(e) => setResolutionNotes(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                  rows={3}
                  placeholder="Describe how the issue was resolved..."
                />
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleResolve}
                  disabled={!resolutionNotes.trim() || isLoading(complaintId, 'resolve')}
                  className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isLoading(complaintId, 'resolve') ? 'Resolving...' : 'Mark Resolved'}
                </button>
                <button
                  onClick={() => setShowResolveModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}