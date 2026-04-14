import type { BudgetAnomaly, BudgetUtilization, DefectLiabilityRule } from '@roadwatch/core/src/engines/BudgetEngine';
import { BudgetEngine } from '@roadwatch/core/src/engines/BudgetEngine';
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { TrustBadge } from '../complaint-tracking/ComplaintTrackingModule'; // Resuses purely structural transparent badge

// ==========================================
// USE CASES
// ==========================================
export class GetBudgetTimeline {
  constructor(private budgetEngine: BudgetEngine) {}
  execute(rawBudgets: Array<{ amount: number, timestamp: number, note: string }>) {
    return this.budgetEngine.buildTimeline(rawBudgets);
  }
}

export class DetectBudgetAnomalies {
  constructor(private budgetEngine: BudgetEngine) {}
  execute(currentSpend: BudgetUtilization, repairs: Array<{ roadId: string, timestamp: number }>, dlpContracts: DefectLiabilityRule[]) {
    // Pure functional abstraction logic hitting local mathematics arrays
    return this.budgetEngine.detectAnomalies(currentSpend, repairs, dlpContracts);
  }
}

// ==========================================
// VIEW MODEL
// ==========================================
export function useBudgetHistoryViewModel(
  timelineUC: GetBudgetTimeline,
  anomaliesUC: DetectBudgetAnomalies
) {
  const [timeline, setTimeline] = useState<any[]>([]);
  const [anomalies, setAnomalies] = useState<BudgetAnomaly[]>([]);

  useEffect(() => {
    // 1. Simulates chronological injection parsing timelines automatically
    const rawTimeline = [
       { amount: 5000000, timestamp: Date.now() - (60 * 24 * 60 * 60 * 1000), note: "Primary Contractor Deposit Dispatched" },
       { amount: 4800000, timestamp: Date.now() - (10 * 24 * 60 * 60 * 1000), note: "Patching Phase Complete - Unverified." } 
    ];
    setTimeline(timelineUC.execute(rawTimeline));

    // 2. Runs strict integrity auditing over local inputs without server confirmation natively
    const utilRules: BudgetUtilization = { sanctioned: 4500000, released: 4500000, spent: 4800000 };
    const dlpRules: DefectLiabilityRule[] = [{ roadId: 'R-8419', contractorId: 'ABC Infra', liabilityEndDateUnix: Date.now() + 10000000 }];
    const anomalyFlags = anomaliesUC.execute(utilRules, [{ roadId: 'R-8419', timestamp: Date.now() }], dlpRules);
    
    setAnomalies(anomalyFlags);
  }, [timelineUC, anomaliesUC]);

  return { timeline, anomalies };
}

// ==========================================
// PURE UI COMPONENTS
// ==========================================
export const BudgetHistoryScreen: React.FC<{ viewModel: ReturnType<typeof useBudgetHistoryViewModel> }> = ({ viewModel }) => {
  return (
    <ScrollView style={styles.screen}>
      <View style={styles.headerBox}>
         <Text style={styles.title}>Capital Public File</Text>
         <TrustBadge isVerified={true} /> {/* Typically implies state Gov Data endpoints */}
      </View>
      
      {/* Dynamic structural anomaly engine mapping */}
      {viewModel.anomalies.length > 0 && (
        <View style={styles.anomalyBox}>
          <Text style={styles.anomalyHeader}>🚨 Integrity Flags Active</Text>
          {viewModel.anomalies.map((anomaly, i) => (
             <Text key={i} style={styles.anomalyText}>• {anomaly.description}</Text>
          ))}
        </View>
      )}

      <Text style={styles.sectionTitle}>Expenditure Ledger</Text>
      
      {viewModel.timeline.map((item, index) => (
        <View key={index} style={styles.timelineCard}>
           <Text style={styles.time}>{new Date(item.date).toLocaleDateString()}</Text>
           <Text style={styles.amt}>₹{Number(item.expenditure).toLocaleString('en-IN')}</Text>
           <Text style={styles.note}>{item.context}</Text>
        </View>
      ))}

    </ScrollView>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FAFAFA' },
  headerBox: { padding: 20, paddingBottom: 10 },
  title: { fontSize: 24, fontWeight: '800', color: '#1A202C', marginBottom: 12 },
  anomalyBox: { marginHorizontal: 20, marginBottom: 20, backgroundColor: '#FED7D7', padding: 16, borderRadius: 8, borderWidth: 1, borderColor: '#FEB2B2' },
  anomalyHeader: { color: '#C53030', fontWeight: '800', fontSize: 16, marginBottom: 8 },
  anomalyText: { color: '#9B2C2C', fontSize: 13, fontWeight: '600', marginBottom: 6 },
  sectionTitle: { fontSize: 18, fontWeight: '700', marginHorizontal: 20, marginVertical: 10, color: '#4A5568' },
  timelineCard: { marginHorizontal: 20, marginBottom: 16, backgroundColor: '#FFFFFF', padding: 16, borderRadius: 8, elevation: 1, shadowOpacity: 0.05 },
  time: { fontSize: 12, color: '#A0AEC0', fontWeight: '600', marginBottom: 4 },
  amt: { fontSize: 20, color: '#2C5282', fontWeight: '800' },
  note: { marginTop: 8, color: '#4A5568', fontSize: 14 }
});
