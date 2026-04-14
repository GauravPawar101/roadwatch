import type { Complaint } from '@roadwatch/core/src/domain/Entities';
import type { UserContext } from '@roadwatch/core/src/engines/AccessControl';
import { PermissionGatekeeper, UserRole } from '@roadwatch/core/src/engines/AccessControl';
import { ComplaintEngine } from '@roadwatch/core/src/engines/ComplaintEngine';
import type { IBlockchainStore, ILocalStore } from '@roadwatch/core/src/interfaces/storage/StorageInterfaces';
import React, { useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

// ==========================================
// USE CASES
// ==========================================
export class GetJurisdictionComplaints {
  constructor(private localStore: ILocalStore) {}
  async execute(zoneId: string): Promise<Complaint[]> {
    const raw = await this.localStore.queryComplaints(); // Typically bounds check here
    return raw.filter(c => c.roadId.includes(zoneId)); // Stub
  }
}

export class GetSLABreaches {
  constructor(private engine: ComplaintEngine) {}
  execute(complaints: Complaint[]): Complaint[] {
    const now = Date.now();
    return complaints.filter(c => this.engine.calculateSLAStatus(c, now).breached);
  }
}

export class AssignInspector {
  constructor(private localStore: ILocalStore) {}
  async execute(complaintId: string, inspectorId: string): Promise<void> {
     // Generates local assignment patch
  }
}

export class AnchorRepairToChain {
  constructor(private blockStore: IBlockchainStore) {}
  async execute(complaintId: string, hash: string): Promise<void> {
     await this.blockStore.anchorComplaintHash(complaintId, hash);
  }
}

// ==========================================
// VIEW MODEL (State & RBAC Binding)
// ==========================================
export function useDashboardViewModel(
  currentUser: UserContext,
  gatekeeper: PermissionGatekeeper,
  jurisdictionUC: GetJurisdictionComplaints,
  slaUC: GetSLABreaches,
  assignUC: AssignInspector,
  anchorUC: AnchorRepairToChain
) {
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [slaBreaches, setSlaBreaches] = useState<Complaint[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // 1. RBAC JURISDICTION CHECK 
    // Fails structurally before fetching memory blocks if user context maps incorrectly.
    if (currentUser.role === UserRole.CITIZEN) {
      setError('This view is for authority users. Please sign in with your official account.');
      return;
    }

    if (!currentUser.zone_id) {
       setError('Your account is missing a jurisdiction assignment. Please contact your administrator.');
       return;
    }

    // 2. Fetch and evaluate explicitly bounded variables safely.
    jurisdictionUC.execute(currentUser.zone_id).then(data => {
      setComplaints(data);
      setSlaBreaches(slaUC.execute(data));
    });

  }, [currentUser, jurisdictionUC, slaUC]);

  const higherLevelMessage = () => {
    if (currentUser.role === UserRole.FIELD_INSPECTOR) {
      return 'That information is managed at a higher level. Your Executive Engineer can access that.';
    }
    if (currentUser.role === UserRole.EXECUTIVE_ENGINEER) {
      return 'That information is managed at a higher level. Your Superintendent Engineer can access that.';
    }
    if (currentUser.role === UserRole.SUPERINTENDENT_ENG) {
      return 'That information is managed at a higher level. Your Chief Engineer can access that.';
    }
    return 'That information is managed at a higher level.';
  };

  const handleAssign = async (cid: string) => {
    if (!gatekeeper.canAssignInspector(currentUser.role)) {
       setError(higherLevelMessage());
       return;
    }
    await assignUC.execute(cid, 'agent_99');
  };

  const handleAnchor = async (cid: string) => {
    if (!gatekeeper.canModifyChain(currentUser.role)) {
       setError(higherLevelMessage());
       return;
    }
    await anchorUC.execute(cid, 'chain_hash_payload');
  };

  return { complaints, slaBreaches, error, handleAssign, handleAnchor, currentUser };
}

// ==========================================
// UI COMPONENTS
// ==========================================
export const DashboardScreen: React.FC<{ viewModel: ReturnType<typeof useDashboardViewModel> }> = ({ viewModel }) => {
  if (viewModel.error) {
    return (
      <View style={styles.errorScreen}>
        <Text style={styles.errorText}>⛔ {viewModel.error}</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
       <View style={styles.header}>
         <Text style={styles.title}>Jurisdiction Control Panel</Text>
         <Text style={styles.subtitle}>Active Authority: [ {viewModel.currentUser.role} ]</Text>
         <Text style={styles.zoneText}>Zone Access: {viewModel.currentUser.zone_id}</Text>
       </View>
       
       <View style={styles.statsRow}>
          <View style={styles.statBox}>
             <Text style={styles.statLabel}>Active Queues</Text>
             <Text style={styles.statNum}>{viewModel.complaints.length}</Text>
          </View>
          <View style={[styles.statBox, { backgroundColor: '#FED7D7' }]}>
             <Text style={[styles.statLabel, { color: '#9B2C2C' }]}>SLA Breaches</Text>
             <Text style={[styles.statNum, { color: '#C53030' }]}>{viewModel.slaBreaches.length}</Text>
          </View>
       </View>

       <Text style={styles.listHeader}>Action Items (Role Scoped)</Text>

       <FlatList 
         data={viewModel.complaints.slice(0,5)}
         keyExtractor={i => i.id}
         renderItem={({item}) => (
           <View style={styles.listItem}>
              <Text style={styles.itemId}>{item.id}</Text>
              <Text style={styles.itemMeta}>Severity: {item.severity}</Text>
              
              <View style={styles.actionRow}>
                <TouchableOpacity onPress={() => viewModel.handleAssign(item.id)} style={styles.btnAction}>
                   <Text style={styles.btnText}>Assign Field Inspector</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => viewModel.handleAnchor(item.id)} style={[styles.btnAction, { backgroundColor: '#047857' }]}>
                   <Text style={styles.btnText}>Close & Chain Anchor</Text>
                </TouchableOpacity>
              </View>
           </View>
         )}
       />
    </View>
  );
};

const styles = StyleSheet.create({
  errorScreen: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FFF5F5', padding: 20 },
  errorText: { color: '#E53E3E', fontSize: 16, fontWeight: 'bold', textAlign: 'center' },
  screen: { flex: 1, backgroundColor: '#EDF2F7' },
  header: { backgroundColor: '#2B6CB0', padding: 20, paddingTop: 40 },
  title: { color: '#FFF', fontSize: 22, fontWeight: '800' },
  subtitle: { color: '#BEE3F8', fontSize: 13, marginTop: 4, fontWeight: 'bold' },
  zoneText: { color: '#FFF', fontSize: 12, marginTop: 4 },
  statsRow: { flexDirection: 'row', padding: 16, gap: 16 },
  statBox: { flex: 1, backgroundColor: '#FFF', padding: 20, borderRadius: 8, alignItems: 'center', shadowRadius: 3, shadowOpacity: 0.1 },
  statLabel: { fontSize: 12, color: '#718096', fontWeight: 'bold', marginBottom: 4 },
  statNum: { fontSize: 24, fontWeight: '900', color: '#2D3748' },
  listHeader: { marginHorizontal: 20, marginTop: 10, marginBottom: 10, fontSize: 16, fontWeight: 'bold', color: '#4A5568' },
  listItem: { backgroundColor: '#FFF', marginHorizontal: 20, marginBottom: 10, padding: 16, borderRadius: 8 },
  itemId: { fontSize: 14, fontWeight: 'bold', color: '#1A202C' },
  itemMeta: { fontSize: 13, color: '#718096', marginBottom: 12 },
  actionRow: { flexDirection: 'row', gap: 10 },
  btnAction: { backgroundColor: '#3182CE', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 6, flex: 1, alignItems: 'center' },
  btnText: { color: '#FFF', fontSize: 11, fontWeight: 'bold' }
});
