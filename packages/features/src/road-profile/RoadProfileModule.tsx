import { RoadEngine } from '@roadwatch/core/src/engines/RoadEngine';
import type { IBlockchainStore, ILocalStore } from '@roadwatch/core/src/interfaces/storage/StorageInterfaces';
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

// ==========================================
// USE CASES
// Orchestrates local memory queries safely
// ==========================================
export class GetRoadProfile {
  constructor(private localStore: ILocalStore, private roadEngine: RoadEngine) {}
  
  async execute(roadId: string): Promise<Array<Record<string, unknown>>> {
    // Bypasses React Native JS bridge constraints by fetching raw offline structured formats
    return this.roadEngine.buildHistory(roadId, [], []); // Stubs lists for brevity
  }
}

export class VerifyChainRecord {
  constructor(private blockStore: IBlockchainStore) {}
  
  async execute(complaintId: string, payloadHash: string): Promise<boolean> {
    // Proof of existence validation without mutable cloud edits
    return await this.blockStore.verifyComplaintHash(complaintId, payloadHash);
  }
}

// ==========================================
// VIEW MODEL (State Management)
// ==========================================
export function useRoadProfileViewModel(roadId: string, getRoadProfileUC: GetRoadProfile) {
  const [history, setHistory] = useState<Array<Record<string, unknown>>>([]);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    let active = true;
    getRoadProfileUC.execute(roadId).then(data => {
      if(active) setHistory(data);
    });
    return () => { active = false; };
  }, [roadId, getRoadProfileUC]);

  return { history, verifying };
}

// ==========================================
// PURE FUNCTIONAL UI COMPONENTS
// ==========================================
export const BudgetSummaryBar: React.FC<{ totalReleased: number, totalSpent: number }> = ({ totalReleased, totalSpent }) => {
  const utilPct = totalReleased > 0 ? (totalSpent / totalReleased) * 100 : 0;
  
  return (
    <View style={styles.budgetCard}>
      <Text style={styles.budgetTitle}>Fiscal Allocation Status</Text>
      <View style={styles.budgetBarTrack}>
        <View style={[styles.budgetBarFill, { width: `${Math.min(utilPct, 100)}%` }]} />
      </View>
      <View style={styles.budgetLabelRow}>
        <Text style={styles.budgetText}>Released: ₹{totalReleased}</Text>
        <Text style={[styles.budgetText, { color: utilPct > 100 ? 'red' : '#2ecc71' }]}>
          Spent: ₹{totalSpent}
        </Text>
      </View>
    </View>
  );
};

export const RoadProfileSheet: React.FC<{ viewModel: ReturnType<typeof useRoadProfileViewModel> }> = ({ viewModel }) => {
  return (
    <ScrollView style={styles.sheetContainer}>
      <View style={styles.sheetHeader}>
        <Text style={styles.title}>Asset Profile</Text>
      </View>
      
      <BudgetSummaryBar totalReleased={4500000} totalSpent={1200000} />
      
      <View style={styles.timelineSection}>
        <Text style={styles.timelineTitle}>Immutable Structural History</Text>
        {viewModel.history.length === 0 ? (
          <Text style={styles.emptyText}>No verified anomalies active on network.</Text>
        ) : (
          viewModel.history.map((item, idx) => (
             <Text key={idx}>{JSON.stringify(item)}</Text> 
          ))
        )}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  sheetContainer: { flex: 1, backgroundColor: '#FFFFFF' },
  sheetHeader: { padding: 16, borderBottomWidth: 1, borderColor: '#EDF2F7' },
  title: { fontSize: 20, fontWeight: '800', color: '#2D3748' },
  budgetCard: { margin: 16, padding: 16, backgroundColor: '#F7FAFC', borderRadius: 8, borderWidth: 1, borderColor: '#EDF2F7' },
  budgetTitle: { fontSize: 14, fontWeight: '600', color: '#4A5568', marginBottom: 12 },
  budgetBarTrack: { height: 8, backgroundColor: '#E2E8F0', borderRadius: 4, overflow: 'hidden' },
  budgetBarFill: { height: 8, backgroundColor: '#4299E1' },
  budgetLabelRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  budgetText: { fontSize: 12, fontWeight: '500', color: '#718096' },
  timelineSection: { padding: 16 },
  timelineTitle: { fontSize: 16, fontWeight: '700', color: '#2D3748', marginBottom: 16 },
  emptyText: { color: '#A0AEC0', fontStyle: 'italic', fontSize: 13 }
});
