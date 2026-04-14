import type { Complaint } from '@roadwatch/core/src/domain/Entities';
import type { IBlockchainStore, ILocalStore } from '@roadwatch/core/src/interfaces/storage/StorageInterfaces';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

// ==========================================
// USE CASES
// ==========================================
export class VerifyComplaintProof {
  constructor(private blockStore: IBlockchainStore) {}
  
  /**
   * Hits the pure mathematical proof engine safely.
   */
  async execute(complaintId: string, proofHash: string): Promise<boolean> {
    // Verifies a stored receipt/proof against the configured verification backend.
    return await this.blockStore.verifyComplaintHash(complaintId, proofHash);
  }
}

// ==========================================
// VIEW MODEL
// ==========================================
export function useComplaintTrackerViewModel(
  complaintId: string,
  localStore: ILocalStore,
  verifyUC: VerifyComplaintProof
) {
  const [complaint, setComplaint] = useState<Complaint | null>(null);
  const [isVerified, setIsVerified] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  useEffect(() => {
     let mounted = true;
     setLoading(true);
     setError(null);

     localStore
       .getComplaint(complaintId)
       .then(async (data) => {
         if (!mounted) return;
         if (!data) {
           setComplaint(null);
           setError('Complaint not found on this device.');
           return;
         }

         setComplaint(data);

         // Simulates passing the physical hash offline logic to evaluate verification arrays natively
         const verified = await verifyUC.execute(data.id, data.mediaIds?.[0] || 'mock_hash');
         if (!mounted) return;
         setIsVerified(verified);
       })
       .catch((e: unknown) => {
         if (!mounted) return;
         const msg = e instanceof Error ? e.message : 'Failed to load complaint.';
         setError(msg);
       })
       .finally(() => {
         if (!mounted) return;
         setLoading(false);
       });
     
     return () => { mounted = false; };
  }, [complaintId, localStore, verifyUC]);

  return { complaint, isVerified, loading, error };
}

// ==========================================
// PURE UI COMPONENTS
// ==========================================
export const TrustBadge: React.FC<{ isVerified: boolean }> = ({ isVerified }) => {
  if (isVerified) {
    return (
      <View style={[styles.badge, styles.badgeVerified]}>
        <Text style={[styles.badgeText, styles.badgeTextVerified]}>Receipt verified</Text>
      </View>
    );
  }
  return (
    <View style={[styles.badge, styles.badgeLocal]}>
      <Text style={[styles.badgeText, styles.badgeTextLocal]}>Saved on device (not yet verified)</Text>
    </View>
  );
};

export const ComplaintTrackerScreen: React.FC<{ viewModel: ReturnType<typeof useComplaintTrackerViewModel> }> = ({ viewModel }) => {
  if (viewModel.loading) {
    return (
      <View style={styles.centerScreen}>
        <ActivityIndicator />
        <Text style={styles.loadingText}>Loading complaint…</Text>
      </View>
    );
  }

  if (viewModel.error || !viewModel.complaint) {
    return (
      <View style={styles.centerScreen}>
        <Text style={styles.title}>Complaint tracking</Text>
        <Text style={styles.errorText}>{viewModel.error ?? 'Unable to load complaint.'}</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent}>
      <Text style={styles.title}>Complaint tracking</Text>
      <TrustBadge isVerified={viewModel.isVerified} />

      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.label}>Complaint ID</Text>
          <Text style={styles.value} numberOfLines={2}>
            {viewModel.complaint.id}
          </Text>
        </View>

        <View style={styles.divider} />

        <View style={styles.row}>
          <Text style={styles.label}>Status</Text>
          <Text style={styles.value}>{viewModel.complaint.status}</Text>
        </View>

        <View style={styles.row}>
          <Text style={styles.label}>Severity</Text>
          <Text style={styles.value}>Level {viewModel.complaint.severity}</Text>
        </View>

        {viewModel.isVerified ? (
          <View style={styles.callout}>
            <Text style={styles.calloutText}>Proof verified. Keep this receipt for your records.</Text>
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
};

const palette = {
  bg: '#F7FAFC',
  card: '#FFFFFF',
  text: '#1F2937',
  muted: '#6B7280',
  border: '#E5E7EB',
  verifiedBg: '#D1FAE5',
  verifiedFg: '#047857',
  localBg: '#FEF3C7',
  localFg: '#B45309',
  error: '#B91C1C'
} as const;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  screenContent: { padding: 20, paddingBottom: 28 },

  centerScreen: {
    flex: 1,
    padding: 20,
    backgroundColor: palette.bg,
    justifyContent: 'center',
    alignItems: 'center'
  },
  loadingText: { marginTop: 10, fontSize: 14, color: palette.muted },
  errorText: { marginTop: 8, fontSize: 14, color: palette.error, textAlign: 'center' },

  title: { fontSize: 22, fontWeight: '800', color: palette.text, marginBottom: 12 },

  badge: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    alignSelf: 'flex-start',
    marginBottom: 16,
    borderWidth: 1
  },
  badgeVerified: { backgroundColor: palette.verifiedBg, borderColor: palette.verifiedFg },
  badgeLocal: { backgroundColor: palette.localBg, borderColor: palette.localFg },
  badgeText: { fontSize: 12, fontWeight: '700' },
  badgeTextVerified: { color: palette.verifiedFg },
  badgeTextLocal: { color: palette.localFg },

  card: {
    backgroundColor: palette.card,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border
  },
  divider: { height: 1, backgroundColor: palette.border, marginVertical: 12 },
  row: { marginTop: 8 },
  label: { fontSize: 12, color: palette.muted, fontWeight: '600' },
  value: { fontSize: 16, fontWeight: '700', color: palette.text, marginTop: 4 },

  callout: {
    marginTop: 14,
    padding: 12,
    borderRadius: 10,
    backgroundColor: palette.bg,
    borderWidth: 1,
    borderColor: palette.border
  },
  calloutText: { fontSize: 13, color: palette.text }
});
